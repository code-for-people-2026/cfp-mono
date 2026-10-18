import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { mock } from "node:test";
import Database from "libsql";
import sharp from "sharp";
import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-sqlite";
import { AppError, ContentReviewError, type Mode } from "../src/domain/contracts";
import type { ImageProvider } from "../src/images/wan";

const worker = process.argv[2] === "--worker";
const dir = worker ? process.argv[3] : await mkdtemp(path.join(tmpdir(), "hello-image-quota-"));
assert.ok(dir && path.basename(dir).startsWith("hello-image-quota-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${dir}/test.db`, PAYLOAD_SECRET: "image-quota-isolated-test-only",
  HELLO_DEPLOYED: "true", HELLO_MEDIA_STORAGE: "database", DASHSCOPE_API_KEY: "", NODE_ENV: "test",
  HELLO_IMAGE_REVIEW_OWNER_DAILY_LIMIT: "1000", HELLO_IMAGE_REVIEW_GLOBAL_DAILY_LIMIT: "10000",
});
const { cms } = await import("../src/cms/client");
const { migrations } = await import("../src/cms/migrations");
const { Repository } = await import("../src/cms/repository");
const { MediaService } = await import("../src/domain/media");
const { ImageGenerationService, readImageState } = await import("../src/images/service");
const { reserveImageTask } = await import("../src/images/quota");
const payload = await cms();
const clearQuota = () => payload.db.drizzle.run(sql`DELETE FROM platform_model_quotas WHERE day LIKE 'image:%'`);
const ledger = () => payload.db.drizzle.all<{ day: string; reserved_calls: number }>(sql`SELECT day, reserved_calls FROM platform_model_quotas WHERE day LIKE 'image:%' ORDER BY day`);
const workerRun = async (owner: string, attempts = 3) => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/image-quota-check.ts", "--worker", dir, owner, String(attempts)], { env: process.env, timeout: 120_000 });
  const match = stdout.match(/RESERVED=(\d+)/);
  assert.ok(match, "worker must finish its assertions");
  return Number(match[1]);
};
try {
  if (worker) {
    let accepted = 0;
    for (let i = 0; i < Number(process.argv[5]); i++) {
      try { await reserveImageTask(payload, process.argv[4]); accepted++; }
      catch (error) { assert.ok(error instanceof AppError); assert.equal(error.status, 429); }
    }
    console.log(`RESERVED=${accepted}`);
  } else {
    await payload.db.migrate({ migrations: migrations.map((migration) => ({ name: migration.name, up: (args: unknown) => migration.up(args as MigrateUpArgs), down: (args: unknown) => migration.down(args as MigrateDownArgs) })) });
    Object.assign(process.env, { HELLO_IMAGE_OWNER_DAILY_LIMIT: "2", HELLO_IMAGE_GLOBAL_DAILY_LIMIT: "3" });
    const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#559977" } }).png().toBuffer();
    const input = { prompt: "合成测试的小树插画", title: "小树", alt: "合成绿色小树", aspectRatio: "square" as const };
    let submitted = 0, downloaded = 0, failResult = false, failSubmit = false;
    const provider: ImageProvider = {
      async submit() { submitted++; if (failSubmit) throw new AppError(502, "合成提交回执丢失"); return `synthetic-${submitted}`; },
      async result() { downloaded++; if (failResult) throw new AppError(502, "合成下载中断"); return png; },
    };
    const allowText = async () => {};
    const allowImage = async () => ({ decision: "allow" as const, version: "synthetic-quota-review", category: "test" });
    const fixture = async () => {
      const repo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
      const media = new MediaService(repo, () => undefined);
      const service = new ImageGenerationService(repo, media, allowText, allowImage, () => provider);
      const turn = async (mode: Mode) => {
        const session = await repo.create("sessions", { title: "合成生图额度验证" });
        return repo.create("greetings", { sessionId: session.id, requestKey: randomUUID(), fingerprint: "synthetic", status: "running", mode, input: { text: "生成合成测试插画", mediaIds: [] } });
      };
      const generate = (id: number) => service.generate(id, input, AbortSignal.timeout(15_000), "synthetic-text-byok-never-sent");
      return { repo, media, service, turn, generate };
    };
    const a = await fixture(), b = await fixture(), c = await fixture();
    const byok = await a.turn("byok");
    const firstImage = await a.generate(byok.id);
    failResult = true;
    const platform = await a.turn("platform");
    await assert.rejects(a.generate(platform.id), /合成下载中断/);
    failResult = false;
    const overOwner = await a.turn("byok");
    await assert.rejects(a.generate(overOwner.id), { status: 429 });
    assert.equal(submitted, 2, "BYOK and platform share one owner's budget across sessions");
    assert.equal(readImageState(await a.repo.get("greetings", overOwner.id)), undefined, "quota refusal is not an uncertain submit");
    const other = await b.turn("platform"); await b.generate(other.id);
    const beforeGlobalRejection = await ledger();
    const overGlobal = await c.turn("byok");
    await assert.rejects(c.generate(overGlobal.id), { status: 429 });
    assert.equal(submitted, 3, "global quota prevents any provider submission by a fresh owner");
    assert.deepEqual(await ledger(), beforeGlobalRejection, "global refusal rolls back the new owner's row");
    assert.equal((await ledger()).find((row) => row.day.endsWith(":global"))?.reserved_calls, 3);
    console.log("✓ real image service shares owner/global task budgets across BYOK and platform; exhaustion makes zero provider calls");

    Object.assign(process.env, { HELLO_IMAGE_OWNER_DAILY_LIMIT: "0", HELLO_IMAGE_GLOBAL_DAILY_LIMIT: "0" });
    // Move the existing charge to a prior UTC day without changing the task.
    const today = new Date().toISOString().slice(0, 10);
    await payload.db.drizzle.run(sql`UPDATE platform_model_quotas SET day = replace(day, ${`image:${today}:`}, 'image:2000-01-02:') WHERE day LIKE 'image:%'`);
    const beforeResume = await ledger();
    const resumed = await a.generate(platform.id);
    const downloadsBeforeStored = downloaded;
    assert.equal((await a.generate(platform.id)).mediaId, resumed.mediaId);
    assert.equal((await a.generate(byok.id)).mediaId, firstImage.mediaId);
    assert.equal(downloaded, downloadsBeforeStored, "stored images do not poll again");
    assert.equal(submitted, 3, "pending/stored never resubmit when new tasks are paused");
    assert.deepEqual(await ledger(), beforeResume, "pending/stored do not reserve quota");
    console.log("✓ pending/stored recovery crosses UTC days with both budgets set to zero, without new charges or submissions");

    await clearQuota();
    Object.assign(process.env, { HELLO_IMAGE_OWNER_DAILY_LIMIT: "1", HELLO_IMAGE_GLOBAL_DAILY_LIMIT: "2" });
    const rejected = await c.turn("byok");
    const blocked = new ImageGenerationService(c.repo, c.media, async () => { throw new ContentReviewError(422, "合成描述审核拒绝"); }, allowImage, () => provider);
    await assert.rejects(blocked.generate(rejected.id, input, AbortSignal.timeout(15_000)), /合成描述审核拒绝/);
    assert.deepEqual(await ledger(), []);
    assert.equal(submitted, 3);
    failSubmit = true;
    const unknown = await c.turn("byok");
    await assert.rejects(c.generate(unknown.id), /合成提交回执丢失/);
    const afterUnknown = await ledger();
    assert.deepEqual(afterUnknown.map((row) => row.reserved_calls), [1, 1]);
    await assert.rejects(c.generate(unknown.id), /避免重复扣费/);
    const retry = await c.turn("platform");
    await assert.rejects(c.generate(retry.id), { status: 429 });
    assert.equal(submitted, 4, "unknown submit is charged once and never retried or refunded");
    assert.deepEqual(await ledger(), afterUnknown);
    failSubmit = false;
    console.log("✓ description rejection consumes no quota; unknown submission retains its charge and cannot be retried");

    await clearQuota();
    await payload.db.drizzle.run(sql`INSERT INTO platform_model_quotas (day, reserved_calls) VALUES ('image:2000-01-01:owner:expired', 1), ('admission:2000-01-01:safety:global', 3), ('image-review:2000-01-01:global', 9), ('2000-01-01', 77)`);
    await reserveImageTask(payload, "synthetic-cleanup");
    assert.equal((await ledger()).some((row) => row.day.startsWith("image:2000")), false);
    assert.deepEqual(await payload.db.drizzle.all<{ reserved_calls: number }>(sql`SELECT reserved_calls FROM platform_model_quotas WHERE day IN ('2000-01-01', 'admission:2000-01-01:safety:global') ORDER BY day`), [{ reserved_calls: 77 }, { reserved_calls: 3 }]);
    assert.equal((await payload.db.drizzle.get<{ reserved_calls: number }>(sql`SELECT reserved_calls FROM platform_model_quotas WHERE day = 'image-review:2000-01-01:global'`))?.reserved_calls, 9);
    console.log("✓ UTC image cleanup preserves text-model and public-admission counters");

    await clearQuota();
    const competingWriter = new Database(path.join(dir, "test.db"));
    competingWriter.exec("BEGIN IMMEDIATE");
    const utcDate = mock.method(Date.prototype, "toISOString", () => "2000-01-01T23:59:59.999Z");
    try {
      // The first reservation attempt is synchronously blocked at BEGIN. The
      // next attempt runs after midnight and must use that day's counters.
      const waiting = reserveImageTask(payload, "synthetic-midnight");
      utcDate.mock.mockImplementation(() => "2000-01-02T00:00:00.001Z");
      competingWriter.exec("ROLLBACK");
      await waiting;
      assert.ok((await ledger()).every((row) => row.day.startsWith("image:2000-01-02:")), "write-lock retries must not recreate a stale UTC bucket");
      assert.deepEqual((await ledger()).map((row) => row.reserved_calls), [1, 1]);
    } finally {
      utcDate.mock.restore();
      if (competingWriter.inTransaction) competingWriter.exec("ROLLBACK");
      competingWriter.close();
    }
    console.log("✓ a real writer crossing UTC midnight reserves the new day, without recreating the old bucket");

    await clearQuota();
    Object.assign(process.env, { HELLO_IMAGE_OWNER_DAILY_LIMIT: "2", HELLO_IMAGE_GLOBAL_DAILY_LIMIT: "100" });
    assert.equal((await Promise.all([workerRun("same-owner"), workerRun("same-owner"), workerRun("same-owner")])).reduce((a, b) => a + b, 0), 2);
    assert.equal(await workerRun("same-owner", 1), 0, "fresh process cannot reset owner budget");
    await clearQuota();
    process.env.HELLO_IMAGE_GLOBAL_DAILY_LIMIT = "5";
    assert.equal((await Promise.all([1, 2, 3, 4].map((index) => workerRun(`owner-${index}`)))).reduce((a, b) => a + b, 0), 5);
    const concurrent = await ledger();
    assert.equal(concurrent.find((row) => row.day.endsWith(":global"))?.reserved_calls, 5);
    assert.equal(concurrent.filter((row) => row.day.includes(":owner:")).reduce((total, row) => total + row.reserved_calls, 0), 5);
    assert.equal(await workerRun("fresh-owner", 1), 0, "fresh process and owner cannot reset global budget");
    assert.deepEqual(await ledger(), concurrent, "rejected concurrent reservations do not allocate or increment owner rows");
    console.log("✓ multi-process owner/global reservations are atomic, exact, and survive restart without accumulating rejected keys");

    await payload.db.drizzle.run(sql`ALTER TABLE platform_model_quotas RENAME TO unavailable_quota`);
    const unavailable = await a.turn("byok");
    await assert.rejects(a.generate(unavailable.id), { status: 503 });
    assert.equal(submitted, 4, "storage failure makes no provider call");
    await payload.db.drizzle.run(sql`ALTER TABLE unavailable_quota RENAME TO platform_model_quotas`);
    console.log("✓ unavailable durable quota fails closed before provider submission");
  }
} finally {
  await payload.destroy();
  if (!worker) await rm(dir, { recursive: true, force: true });
}
