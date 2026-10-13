import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  sql,
  type MigrateUpArgs,
  type MigrateDownArgs,
} from "@payloadcms/db-sqlite";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { ScriptedModel } from "./scripted-model";

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
// Use the real deployment schema, with migrations explicitly controlled below.
Object.assign(process.env, { NODE_ENV: "test" });
const { cms } = await import("../src/cms/client");
const { reservePlatformCalls } = await import("../src/cms/platform-quota");
const { migrations } = await import("../src/cms/migrations");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { ContextService } = await import("../src/domain/context");
const { runGreeting } = await import("../src/agent/runtime");
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
        await reservePlatformCalls(payload, 9);
        accepted++;
      } catch (error) {
        if (!(error instanceof Error && "status" in error)) throw error;
        assert.equal(error.status, 429);
      }
    }
    console.log(`RESERVED=${accepted}`);
  } else {
    // Upgrade an existing database and prove that an old record survives.
    await payload.db.migrate({ migrations: schemaMigrations.slice(0, -1) });
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
    process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = "18";

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
        // Includes both coordinator and specialist calls, before any model work.
        assert.equal(await used(), 9);
        yield* super.generateContentAsync(input);
      }
    }
    const model = new ObservedModel({
      greeting: "先区分事实与猜测。",
      association: "测试",
      approach: "cbt",
    });
    const firstRepo = makeRepo();
    const service = new GreetingService(firstRepo, (args) =>
      runGreeting(args, model),
    );
    const session = await service.createSession();
    const first = request(session.id);
    const greeting = await service.generateGreeting(first);
    assert.equal(model.requests.length, 3);
    assert.equal((await service.generateGreeting(first)).id, greeting.id);
    assert.equal(model.requests.length, 3);
    assert.equal(await used(), 9);

    const failing = new GreetingService(makeRepo(), async () => {
      throw new Error("provider timeout");
    });
    await assert.rejects(
      failing.generateGreeting(request((await failing.createSession()).id)),
      { status: 502 },
    );
    assert.equal(
      await used(),
      18,
      "failures must not refund possibly billed work",
    );
    const byokModel = new ScriptedModel();
    const third = new GreetingService(makeRepo(), (args) =>
      runGreeting(args, byokModel),
    );
    const thirdSession = await third.createSession();
    await assert.rejects(third.generateGreeting(request(thirdSession.id)), {
      status: 429,
    });
    assert.equal(
      byokModel.requests.length,
      0,
      "fresh identity must be stopped before generation",
    );
    await third.generateGreeting({
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
          greeting: "保存的外部回复。".repeat(30),
          association: "测试",
        },
        model: "external-test-only",
      });
    await external();
    await external();
    assert.equal(
      await used(),
      18,
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
    process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = "19";
    await context.compactPreview(session.id, compactionId, 0);
    await context.compactPreview(session.id, compactionId, 0);
    assert.equal(summaryCalls, 1);
    assert.equal(
      await used(),
      19,
      "compaction and greeting share quota; retry is free",
    );
    await external();
    process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = "0";
    await context.compactPreview(
      session.id,
      randomUUID(),
      1,
      "private-test-only",
    );
    assert.equal(summaryCalls, 2);
    assert.equal(
      await used(),
      19,
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
    }
    delete process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT;
    await reservePlatformCalls(payload, 1);
    assert.equal(
      await used(),
      20,
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

    // Model a new UTC day without modifying the trusted application clock.
    await db.run(sql`UPDATE platform_model_quotas SET day = '2000-01-01'`);
    process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = "90";
    const counts = await Promise.all([
      spawnWorker(12),
      spawnWorker(12),
      spawnWorker(12),
    ]);
    assert.equal(
      counts.reduce((sum, count) => sum + count, 0),
      10,
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
      [20, 90],
    );
    await db.run(
      sql`ALTER TABLE platform_model_quotas RENAME TO unavailable_quota`,
    );
    await assert.rejects(third.generateGreeting(request(thirdSession.id)), {
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
    console.log(
      "✓ new UTC day; 36 concurrent-process attempts admit only 10 runs; restart and unavailable ledger stay blocked",
    );
  }
} finally {
  await payload.destroy();
}
