import { syntheticTextReview } from "./synthetic-text-review";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "libsql";
import {
  sql,
  type MigrateUpArgs,
  type MigrateDownArgs,
} from "@payloadcms/db-sqlite";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { ScriptedModel } from "./scripted-model";
import { AJOKER_MAX_CALLS } from "../src/agent/limits";

const worker = process.argv[2] === "--worker";
const dir = worker
  ? process.argv[3]
  : await mkdtemp(path.join(tmpdir(), "hello-platform-quota-"));
assert.ok(dir && path.basename(dir).startsWith("hello-platform-quota-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/test.db`;
process.env.PAYLOAD_SECRET = "quota-test-only-not-for-deployment";
process.env.HELLO_DEPLOYED = "true";
process.env.DEEPSEEK_API_KEY = "platform-test-only";
process.env.HELLO_MEMORY_RECOVERY = "preview";
// Synthetic deployment prerequisites, isolated from real operations and data.
Object.assign(process.env, {
  HELLO_PRIVACY_CONTACT: "quota-test@example.invalid",
  HELLO_PRIVACY_RESPONSE_DAYS: "7",
  HELLO_PRIVACY_STORAGE_LOCATION: "isolated quota test",
  HELLO_PRIVACY_RETENTION_DAYS: "30",
  HELLO_PRIVACY_BACKUP_DAYS: "7",
  HELLO_PRIVACY_DELETION_LEDGER: path.join(dir, "deletions.ndjson"),
  HELLO_PRIVACY_OPERATIONS_APPROVED: "true",
});
// Use the real deployment schema, with migrations explicitly controlled below.
Object.assign(process.env, { NODE_ENV: "test" });
const { cms } = await import("../src/cms/client");
const { reservePlatformCalls } = await import("../src/cms/platform-quota");
const { migrations } = await import("../src/cms/migrations");
const { Repository } = await import("../src/cms/repository");
const { AJokerService } = await import("../src/domain/a-j-oker");
const { ContextService } = await import("../src/domain/context");
const { runAJoker } = await import("../src/agent/runtime");
const { GET: readiness } = await import("../src/app/api/ready/route");
const payload = await cms();
const db = payload.db.drizzle;
// Payload's generic migration API erases the adapter-specific argument type.
const schemaMigrations = migrations.map((migration) => ({
  name: migration.name,
  up: (args: unknown) => migration.up(args as MigrateUpArgs),
  down: (args: unknown) => migration.down(args as MigrateDownArgs),
}));
const used = async () =>
  (await payload.find({ collection: "platform-model-quotas" })).docs[0]
    ?.reservedCalls ?? 0;
const spawnWorker = async (attempts: number) => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/platform-quota-check.ts",
      "--worker",
      dir,
      String(attempts),
    ],
    { env: process.env, timeout: 120_000 },
  );
  const result = stdout.match(/RESERVED=(\d+)/);
  assert.ok(result, "worker must finish its assertions");
  return Number(result[1]);
};

try {
  if (worker) {
    let accepted = 0;
    for (let i = 0; i < Number(process.argv[4]); i++) {
      try {
        await reservePlatformCalls(payload, AJOKER_MAX_CALLS);
        accepted++;
      } catch (error) {
        if (!(error instanceof Error && "status" in error)) throw error;
        assert.equal(error.status, 429);
      }
    }
    console.log(`RESERVED=${accepted}`);
  } else {
    // Upgrade an existing database and prove that an old record survives.
    const quotaMigration = schemaMigrations.findIndex((migration) => migration.name === "20261013_125923_platform_model_quota");
    assert.ok(quotaMigration >= 0, "platform quota migration must be registered");
    await payload.db.migrate({ migrations: schemaMigrations.slice(0, quotaMigration) });
    await db.run(
      sql`INSERT INTO sessions (owner, title) VALUES ('old-owner', 'preserved')`,
    );
    const oldSession = await db.get(
      sql`SELECT * FROM sessions WHERE owner = 'old-owner'`,
    );
    await payload.db.migrate({ migrations: schemaMigrations });
    await payload.db.migrate({ migrations: schemaMigrations });
    assert.deepEqual(
      await db.get(sql`SELECT * FROM sessions WHERE owner = 'old-owner'`),
      oldSession,
    );
    await (await import("../src/cms/seed")).seedAgents(payload);
    const twoAJokersBudget = AJOKER_MAX_CALLS * 2;
    const compactionBudget = twoAJokersBudget + 1;
    const defaultProbeBudget = compactionBudget + 1;
    const busyRetryBudget = defaultProbeBudget + 1;
    const concurrentRunCount = 4;
    const concurrentBudget = AJOKER_MAX_CALLS * concurrentRunCount;
    const concurrentAttemptsPerWorker = concurrentRunCount + 1;
    process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = String(twoAJokersBudget);
    delete process.env.HELLO_PRIVACY_CONTACT;
    assert.equal((await readiness()).status, 503, "missing privacy configuration must block readiness");
    process.env.HELLO_PRIVACY_CONTACT = "quota-test@example.invalid";
    for (let i = 0; i < 3; i++) assert.equal((await readiness()).status, 200);
    assert.equal(
      (await payload.count({ collection: "platform-model-quotas" })).totalDocs,
      0,
      "readiness must not create or charge a ledger entry",
    );

    const makeRepo = () =>
      new Repository(payload, { id: randomUUID(), auth: "cookie" });
    const request = (sessionId: number) => ({
      sessionId,
      requestId: randomUUID(),
      mode: "platform",
      input: { text: "已经更正会议记录，但仍然自责。" },
    });
    class ObservedModel extends ScriptedModel {
      override async *generateContentAsync(
        input: LlmRequest,
      ): AsyncGenerator<LlmResponse> {
        // Includes coordinator and expert-direct-reply calls before model work.
        assert.equal(await used(), AJOKER_MAX_CALLS);
        yield* super.generateContentAsync(input);
      }
    }
    const model = new ObservedModel({
      aJoker: "先区分事实与猜测。",
      association: "测试",
      approach: "cbt",
    });
    const firstRepo = makeRepo();
    const service = new AJokerService(firstRepo, (args) =>
      runAJoker(args, model), undefined, undefined, { moderate: syntheticTextReview }
    );
    const session = await service.createSession();
    const first = request(session.id);
    const aJoker = await service.generateAJoker(first);
    assert.equal(model.requests.length, 2);
    assert.equal((await service.generateAJoker(first)).id, aJoker.id);
    assert.equal(model.requests.length, 2);
    assert.equal(await used(), AJOKER_MAX_CALLS);

    const failing = new AJokerService(makeRepo(), async () => {
      throw new Error("provider timeout");
    }, undefined, undefined, { moderate: syntheticTextReview });
    await assert.rejects(
      failing.generateAJoker(request((await failing.createSession()).id)),
      { status: 502 },
    );
    assert.equal(
      await used(),
      twoAJokersBudget,
      "failures must not refund possibly billed work",
    );
    assert.equal(
      (await readiness()).status,
      200,
      "exhaustion is not a deployment failure",
    );
    assert.equal(await used(), twoAJokersBudget);
    const byokModel = new ScriptedModel();
    const third = new AJokerService(makeRepo(), (args) =>
      runAJoker(args, byokModel), undefined, undefined, { moderate: syntheticTextReview }
    );
    const thirdSession = await third.createSession();
    await assert.rejects(third.generateAJoker(request(thirdSession.id)), {
      status: 429,
    });
    assert.equal(
      byokModel.requests.length,
      0,
      "fresh identity must be stopped before generation",
    );
    await third.generateAJoker({
      ...request(thirdSession.id),
      mode: "byok",
      apiKey: "private-test-only",
    });
    assert.equal(byokModel.requests.length, 1);
    const external = async () =>
      service.acceptExternal({
        ...request(session.id),
        input: { text: "历史资料。".repeat(100) },
        output: {
          aJoker: "保存的外部回复。".repeat(30),
          association: "测试",
        },
        model: "external-test-only",
      });
    await external();
    await external();
    assert.equal(
      await used(),
      twoAJokersBudget,
      "BYOK and external artifacts do not use platform quota",
    );

    let summaryCalls = 0;
    const context = new ContextService(firstRepo, async () => {
      summaryCalls++;
      return "正在练习区分事实与猜测。";
    });
    const compactionId = randomUUID();
    await assert.rejects(context.compactPreview(session.id, compactionId, 0), {
      status: 429,
    });
    assert.equal(summaryCalls, 0);
    assert.equal((await context.view(session.id)).revision, 0);
    process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = String(compactionBudget);
    await context.compactPreview(session.id, compactionId, 0);
    await context.compactPreview(session.id, compactionId, 0);
    assert.equal(summaryCalls, 1);
    assert.equal(
      await used(),
      compactionBudget,
      "compaction and aJoker share quota; retry is free",
    );
    await external();
    process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = "0";
    assert.equal(
      (await readiness()).status,
      200,
      "explicit platform pause remains healthy",
    );
    await context.compactPreview(
      session.id,
      randomUUID(),
      1,
      "private-test-only",
    );
    assert.equal(summaryCalls, 2);
    assert.equal(
      await used(),
      compactionBudget,
      "BYOK compaction still works when platform is disabled",
    );
    await assert.rejects(reservePlatformCalls(payload, 1), { status: 429 });
    for (const invalid of [
      "",
      "-1",
      "Infinity",
      "1.5",
      "9000000000000000000",
    ]) {
      process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = invalid;
      await assert.rejects(reservePlatformCalls(payload, 1), { status: 503 });
      const response = await readiness();
      assert.equal(
        response.status,
        503,
        "malformed quota must make readiness fail",
      );
      assert.deepEqual(await response.json(), {
        ok: false,
        service: "a-j-oker",
      });
    }
    delete process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT;
    assert.equal((await readiness()).status, 200);
    assert.equal(
      await used(),
      compactionBudget,
      "health probes must not consume quota",
    );
    await reservePlatformCalls(payload, 1);
    assert.equal(
      await used(),
      defaultProbeBudget,
      "missing configuration uses a finite default",
    );
    await assert.rejects(
      payload.find({
        collection: "platform-model-quotas",
        overrideAccess: false,
      }),
    );
    await assert.rejects(
      payload.create({
        collection: "platform-model-quotas",
        overrideAccess: false,
        data: { day: "reset", reservedCalls: 0 },
      }),
    );
    const ledger = (await payload.find({ collection: "platform-model-quotas" }))
      .docs[0];
    await assert.rejects(
      payload.update({
        collection: "platform-model-quotas",
        id: ledger.id,
        overrideAccess: false,
        data: { reservedCalls: 0 },
      }),
    );
    await assert.rejects(
      payload.delete({
        collection: "platform-model-quotas",
        id: ledger.id,
        overrideAccess: false,
      }),
    );
    console.log(
      "✓ migrated ledger; prepaid specialist run; fresh identities, failure, retry, BYOK, external, compaction and access checks",
    );

    // A real business writer can hold SQLite for longer than the old 375 ms
    // retry window. It must release before reservation succeeds, exactly once.
    const writer = new Database(path.join(dir, "test.db"));
    writer.prepare("BEGIN IMMEDIATE").run();
    const release = setTimeout(() => writer.prepare("COMMIT").run(), 700);
    try {
      await reservePlatformCalls(payload, 1);
      assert.equal(writer.inTransaction, false);
      assert.equal(
        await used(),
        busyRetryBudget,
        "busy retries must not charge multiple times",
      );
      // A retry must not leave a failed statement holding the shared database.
      // Actually write: BEGIN/COMMIT alone would miss a retained reader lock.
      writer.transaction(() => {
        writer.prepare("UPDATE platform_model_quotas SET reserved_calls = reserved_calls").run();
      }).immediate();
    } finally {
      clearTimeout(release);
      if (writer.inTransaction) writer.prepare("ROLLBACK").run();
      writer.close();
    }
    console.log("✓ a competing 700 ms write releases before one exact reservation; no duplicate charge");

    // Model a new UTC day without modifying the trusted application clock.
    await db.run(sql`UPDATE platform_model_quotas SET day = '2000-01-01'`);
    process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = String(concurrentBudget);
    const counts = await Promise.all([
      spawnWorker(concurrentAttemptsPerWorker),
      spawnWorker(concurrentAttemptsPerWorker),
      spawnWorker(concurrentAttemptsPerWorker),
    ]);
    assert.equal(
      counts.reduce((sum, count) => sum + count, 0),
      concurrentRunCount,
      "concurrent processes must reserve exactly the shared budget",
    );
    assert.equal(
      await spawnWorker(1),
      0,
      "restarting does not reset the budget",
    );
    const rows = await payload.find({
      collection: "platform-model-quotas",
      sort: "day",
    });
    assert.deepEqual(
      rows.docs.map((row) => row.reservedCalls),
      [busyRetryBudget, concurrentBudget],
    );
    await db.run(
      sql`ALTER TABLE platform_model_quotas RENAME TO unavailable_quota`,
    );
    assert.equal(
      (await readiness()).status,
      503,
      "missing ledger must make readiness fail",
    );
    await assert.rejects(third.generateAJoker(request(thirdSession.id)), {
      status: 503,
    });
    assert.equal(
      byokModel.requests.length,
      1,
      "unavailable ledger must fail closed before the model",
    );
    await db.run(
      sql`ALTER TABLE unavailable_quota RENAME TO platform_model_quotas`,
    );
    assert.equal(
      (await readiness()).status,
      200,
      "readiness recovers with the ledger",
    );
    assert.deepEqual(
      (await payload.find({ collection: "platform-model-quotas", sort: "day" }))
        .docs,
      rows.docs,
      "health probes and failed storage access leave the ledger unchanged",
    );
    console.log(
      `✓ new UTC day; ${concurrentAttemptsPerWorker * 3} concurrent-process attempts admit only ${concurrentRunCount} runs; restart and unavailable ledger stay blocked`,
    );
  }
} finally {
  await payload.destroy();
}
