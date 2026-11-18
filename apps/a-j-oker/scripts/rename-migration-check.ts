import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql, sqliteAdapter, type MigrateUpArgs } from "@payloadcms/db-sqlite";
import { BasePayload, buildConfig, createLocalReq, type Payload } from "payload";
import { zh } from "payload/i18n/zh";
import { collections } from "../src/cms/collections";
import { migrations } from "../src/cms/migrations";
import { installSqliteContentionWait } from "../src/cms/sqlite-contention";
import { Repository } from "../src/cms/repository";
import { PrivacyService } from "../src/privacy/service";

const directory = await mkdtemp(path.join(tmpdir(), "a-j-oker-rename-"));
const database = (name: string) => `file:${path.join(directory, name)}`;

const makeConfig = (uri: string, deployed: boolean) =>
  buildConfig({
    secret: "isolated-rename-migration-only",
    onInit: async (payload) => {
      installSqliteContentionWait(payload);
    },
    db: sqliteAdapter({
      client: { url: uri },
      push: !deployed,
      prodMigrations: deployed ? migrations : undefined,
      transactionOptions: {},
      wal: { synchronous: "FULL" },
    }),
    collections: [...collections],
    i18n: { supportedLanguages: { zh }, fallbackLanguage: "zh" },
    admin: { user: "admins", importMap: { autoGenerate: false } },
  });

const oldPayload = await new BasePayload().init({ config: makeConfig(database("old.db"), true) });
const freshPayload = await new BasePayload().init({ config: makeConfig(database("fresh.db"), false) });

try {
  const db = oldPayload.db.drizzle;
  const req = await createLocalReq({}, oldPayload);
  const renameIndex = migrations.findIndex(
    (migration) => migration.name === "20261118_100000_rename_a_j_oker",
  );
  assert.ok(renameIndex > 0);

  // This is both the fresh pre-rename chain and the old-seed fixture used by
  // the migration assertions below.
  for (const migration of migrations.slice(0, renameIndex))
    await migration.up({ db, payload: oldPayload, req } as MigrateUpArgs);

  await db.run(sql`INSERT INTO sessions (id, owner, title) VALUES (1, 'synthetic-owner', '保留会话')`);
  await db.run(sql`INSERT INTO agent_configs
    (id, name, key, enabled, prompt, updated_at, created_at)
    VALUES (1, '合成协调器', 'synthetic-coordinator', true,
      '调用 hello_save_greeting 或 save_greeting，并从 greeting 响应字段读取结果。始终保持语气温和。',
      '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z')`);
  await db.run(sql`INSERT INTO greetings
    (id, owner, session_id, request_key, fingerprint, mode, status, input, greeting,
     specialist, duration_ms, updated_at, created_at)
    VALUES (1, 'synthetic-owner', 1, 'synthetic-owner:rename-1', 'synthetic', 'platform', 'completed',
      '{"text":"用户原话保留 save_greeting / greeting_agent / hello_greeting","mediaIds":[]}',
      '回应保留 save_greeting / greeting_agent / hello_greeting',
      ${JSON.stringify({
        taskId: "legacy-specialist",
        expertId: "cbt",
        name: "认知行为心理专家（AI）",
        method: "认知行为",
        configurationRevision: "legacy",
        theme: "blue",
        layout: "step_by_step",
        status: "completed",
        sources: [],
        currentTask: "任务正文保留 save_greeting / greeting_agent",
        prompt: "提示词正文保留 save_greeting / greeting_agent，并保持表单字段 greeting_agent。",
        allowedComponents: ["form"],
        preferredComponents: ["form"],
      })}, 7, '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z')`);

  const adkSnapshot = {
    id: "rename-1",
    appName: "hello_agent",
    userId: "synthetic-owner",
    state: { userText: "save_greeting / greeting_agent", greeting_agent: "field-id" },
    events: [
      {
        author: "user",
        content: { parts: [{ text: "用户文本保留 save_greeting / greeting_agent" }] },
      },
      {
        author: "greeting_agent",
        content: {
          parts: [{
            functionCall: {
              id: "call-1",
              name: "save_greeting",
              args: {
                greeting: "旧保存调用中的真实回复",
                association: "旧保存调用中的联想",
                note: "调用参数保留 save_greeting / greeting_agent",
                number: 7,
                off: false,
                empty: null,
                literal: "save_greeting",
                form: {
                  fields: [{ id: "greeting", label: "嵌套表单字段保留 greeting" }],
                  values: { greeting: "嵌套表单值保留 greeting" },
                },
              },
            },
          }],
        },
      },
      {
        author: "greeting_agent",
        content: {
          parts: [{
            functionResponse: {
              id: "call-1",
              name: "save_greeting",
              response: {
                id: 1,
                greeting: "旧保存结果中的真实回复",
                note: "工具结果保留 save_greeting / greeting_agent",
                number: 8,
                off: false,
                empty: null,
                literal: "save_greeting",
                form: {
                  fields: [{ id: "greeting", label: "结果嵌套字段保留 greeting" }],
                  values: { greeting: "结果嵌套表单值保留 greeting" },
                },
              },
            },
          }],
        },
      },
    ],
    lastUpdateTime: 1,
  };
  await db.run(sql`INSERT INTO adk_sessions (owner, key, snapshot, updated_at, created_at)
    VALUES ('synthetic-owner', 'rename-1', ${JSON.stringify(adkSnapshot)}, '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z')`);
  await db.run(sql`INSERT INTO adk_sessions (owner, key, snapshot, updated_at, created_at)
    VALUES ('synthetic-owner', 'invalid-json', '{not-json', '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z')`);

  const formArtifact = {
    id: "legacy_form",
    title: "保留用户表单",
    kind: "form",
    fields: [
      { id: "save_greeting", label: "字段 ID 保留 save_greeting" },
      { id: "greeting_agent", label: "字段 ID 保留 greeting_agent" },
    ],
    values: { score: 9, skipped: false, note: null, literal: "save_greeting / greeting_agent" },
  };
  const a2aSnapshot = {
    id: "rename-1",
    contextId: "rename-context",
    status: { state: 3, timestamp: "2026-11-18T00:00:00Z" },
    artifacts: [
      {
        artifactId: "psychology-plan",
        parts: [{
          content: {
            $case: "data",
            value: {
              reply: {
                greeting: "专家回应保留 save_greeting / greeting_agent",
                association: "联想保留",
                artifacts: [formArtifact],
              },
              unrelatedGreetingKey: { greeting: "非响应 schema 不改" },
            },
          },
        }],
      },
      {
        artifactId: "user-note",
        parts: [{ content: { $case: "data", value: { reply: { greeting: "非 psychology-plan 不改" } } } }],
      },
    ],
  };
  await db.run(sql`INSERT INTO a2a_execution_tasks
    (owner, tenant, agent_id, key, task_id, context_id, state, revision, snapshot, updated_at, created_at)
    VALUES ('synthetic-owner', 'synthetic', 'cbt', 'rename-1', 'rename-1', 'rename-context', 3, 1,
      ${JSON.stringify(a2aSnapshot)}, '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z')`);
  await db.run(sql`INSERT INTO a2a_execution_tasks
    (owner, tenant, agent_id, key, task_id, context_id, state, revision, snapshot, updated_at, created_at)
    VALUES ('synthetic-owner', 'synthetic', 'cbt', 'invalid-json', 'invalid-json', 'rename-context', 3, 1,
      '{not-json', '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z')`);

  const evaluationOutput = {
    greeting: "评测回应保留 save_greeting / greeting_agent",
    score: 11,
    skipped: false,
    empty: null,
    literal: "save_greeting / greeting_agent",
    form: {
      fields: [{ id: "greeting", label: "评测嵌套表单字段保留 greeting" }],
      values: { greeting: "评测嵌套表单值保留 greeting" },
    },
  };
  await db.run(sql`INSERT INTO safety_evaluations (item_id, state, input, output, owner, updated_at, created_at)
    VALUES (1, 'completed', '合成输入', ${JSON.stringify(evaluationOutput)}, 'synthetic-owner',
      '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z')`);
  await db.run(sql`INSERT INTO safety_evaluations (item_id, state, input, output, owner, updated_at, created_at)
    VALUES (2, 'completed', '合成输入', '{not-json', 'synthetic-owner',
      '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z')`);
  await db.run(sql`INSERT INTO payload_locked_documents (id, global_slug) VALUES (1, 'a-j-oker-lock')`);
  await db.run(sql`INSERT INTO payload_locked_documents_rels (parent_id, path, greetings_id)
    VALUES (1, 'rename-relation', 1)`);

  const rename = migrations[renameIndex]!;
  await db.run(sql`CREATE TRIGGER block_adk_rename BEFORE UPDATE ON adk_sessions
    WHEN NEW.snapshot LIKE '%save_a_j_oker%'
    BEGIN SELECT RAISE(ABORT, 'synthetic SQL failure must abort'); END`);
  await assert.rejects(
    () => oldPayload.db.drizzle.transaction(async (tx) => {
      await rename.up({ db: tx, payload: oldPayload, req } as unknown as MigrateUpArgs);
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error, "the drizzle query error must reject");
      assert.match(error.message, /Failed query: UPDATE adk_sessions/);
      const cause = (error as { cause?: unknown }).cause;
      assert.ok(cause instanceof Error, "the underlying SQLite error must be preserved");
      assert.match(cause.message, /synthetic SQL failure must abort/);
      return true;
    },
  );
  const failedSchema = await db.all<{ name: string }>(sql`PRAGMA table_info(greetings)`);
  assert.ok(
    failedSchema.some((column) => column.name === "greeting"),
    "a SQL failure must leave the pre-rename schema available for retry",
  );
  await db.run(sql`DROP TRIGGER block_adk_rename`);

  await rename.up({ db, payload: oldPayload, req } as MigrateUpArgs);

  const physical = async (payload: Payload) => ({
    tables: (await payload.db.drizzle.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('greetings', 'a_j_oker') ORDER BY name`,
    )).map((row) => row.name).sort(),
    turnColumns: (await payload.db.drizzle.all<{ name: string }>(
      sql`PRAGMA table_info(a_j_oker)`,
    )).map((row) => row.name).sort(),
    relationColumns: (await payload.db.drizzle.all<{ name: string }>(
      sql`PRAGMA table_info(payload_locked_documents_rels)`,
    )).map((row) => row.name).sort(),
    turnIndexes: (await payload.db.drizzle.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='a_j_oker' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )).map((row) => row.name).sort(),
  });
  const migratedSchema = await physical(oldPayload);
  const freshSchema = await physical(freshPayload);
  assert.deepEqual(migratedSchema, freshSchema);
  assert.deepEqual(freshSchema.tables, ["a_j_oker"]);
  assert.ok(freshSchema.turnColumns.includes("a_joker"));
  assert.ok(!freshSchema.turnColumns.includes("greeting"));
  assert.ok(freshSchema.relationColumns.includes("a_j_oker_id"));

  const row = await db.all<{ id: number; owner: string; a_joker: string; specialist: string; duration_ms: number }>(
    sql`SELECT id, owner, a_joker, specialist, duration_ms FROM a_j_oker WHERE id = 1`,
  );
  assert.equal(row[0]!.a_joker, "回应保留 save_greeting / greeting_agent / hello_greeting");
  assert.equal(row[0]!.duration_ms, 7);
  const specialist = JSON.parse(row[0]!.specialist) as Record<string, unknown>;
  assert.match(String(specialist.currentTask), /save_greeting \/ greeting_agent/);
  assert.match(String(specialist.prompt), /表单字段 greeting_agent/);

  const coordinatorConfigs = await db.all<{ prompt: string; updated_at: string }>(sql`
    SELECT prompt, updated_at FROM agent_configs WHERE key = 'synthetic-coordinator'
  `);
  assert.equal(
    coordinatorConfigs[0]!.prompt,
    "调用 hello_save_a_j_oker 或 save_a_j_oker，并从 aJoker 响应字段读取结果。始终保持语气温和。",
  );
  assert.notEqual(coordinatorConfigs[0]!.updated_at, "2026-11-18T00:00:00Z");

  const adkRows = await db.all<{ key: string; snapshot: string }>(
    sql`SELECT key, snapshot FROM adk_sessions ORDER BY key`,
  );
  assert.equal(adkRows.find((item) => item.key === "invalid-json")!.snapshot, "{not-json");
  const migratedAdk = JSON.parse(adkRows.find((item) => item.key === "rename-1")!.snapshot) as {
    state: typeof adkSnapshot.state;
    events: Array<{ author: string; content: { parts: unknown[] } }>;
  };
  assert.equal(migratedAdk.state.userText, "save_greeting / greeting_agent");
  assert.deepEqual(migratedAdk.state.greeting_agent, "field-id");
  assert.equal(migratedAdk.events[1]!.author, "a_j_oker_agent");
  assert.equal(migratedAdk.events[2]!.author, "a_j_oker_agent");
  const migratedCall = migratedAdk.events[1]!.content.parts[0] as {
    functionCall: { name: string; args: Record<string, unknown> };
  };
  const migratedToolResponse = migratedAdk.events[2]!.content.parts[0] as {
    functionResponse: { name: string; response: Record<string, unknown> };
  };
  assert.equal(migratedCall.functionCall.name, "save_a_j_oker");
  assert.equal(migratedToolResponse.functionResponse.name, "save_a_j_oker");
  assert.equal(migratedCall.functionCall.args.aJoker, "旧保存调用中的真实回复");
  assert.equal(migratedCall.functionCall.args.greeting, undefined);
  assert.equal(migratedCall.functionCall.args.note, "调用参数保留 save_greeting / greeting_agent");
  assert.equal(migratedCall.functionCall.args.number, 7);
  assert.equal(migratedCall.functionCall.args.off, false);
  assert.equal(migratedCall.functionCall.args.empty, null);
  assert.equal(migratedCall.functionCall.args.literal, "save_greeting");
  assert.deepEqual(
    migratedCall.functionCall.args.form,
    { fields: [{ id: "greeting", label: "嵌套表单字段保留 greeting" }], values: { greeting: "嵌套表单值保留 greeting" } },
  );
  assert.equal(migratedToolResponse.functionResponse.response.aJoker, "旧保存结果中的真实回复");
  assert.equal(migratedToolResponse.functionResponse.response.greeting, undefined);
  assert.equal(migratedToolResponse.functionResponse.response.literal, "save_greeting");
  assert.deepEqual(
    migratedToolResponse.functionResponse.response.form,
    { fields: [{ id: "greeting", label: "结果嵌套字段保留 greeting" }], values: { greeting: "结果嵌套表单值保留 greeting" } },
  );

  const a2aRows = await db.all<{ key: string; snapshot: string }>(
    sql`SELECT key, snapshot FROM a2a_execution_tasks ORDER BY key`,
  );
  assert.equal(a2aRows.find((item) => item.key === "invalid-json")!.snapshot, "{not-json");
  const migratedA2a = JSON.parse(a2aRows.find((item) => item.key === "rename-1")!.snapshot) as typeof a2aSnapshot;
  const plan = migratedA2a.artifacts[0]!.parts[0]!.content.value as {
    reply: { aJoker?: string; greeting?: string; artifacts?: unknown[] };
    unrelatedGreetingKey: { greeting: string };
  };
  assert.equal(plan.reply.aJoker, "专家回应保留 save_greeting / greeting_agent");
  assert.equal(plan.reply.greeting, undefined);
  assert.deepEqual(plan.reply.artifacts, [formArtifact]);
  assert.equal(plan.unrelatedGreetingKey.greeting, "非响应 schema 不改");
  const unrelatedArtifact = migratedA2a.artifacts[1]!.parts[0]!.content.value as { reply: { greeting: string } };
  assert.equal(unrelatedArtifact.reply.greeting, "非 psychology-plan 不改");

  const evaluationRows = await db.all<{ item_id: number; output: string }>(
    sql`SELECT item_id, output FROM safety_evaluations ORDER BY item_id`,
  );
  assert.equal(evaluationRows.find((item) => item.item_id === 2)!.output, "{not-json");
  const migratedEvaluation = JSON.parse(evaluationRows.find((item) => item.item_id === 1)!.output) as {
    aJoker?: string;
    greeting?: string;
    score: number;
    skipped: boolean;
    empty: null;
    literal: string;
    form: { fields: Array<{ id: string; label: string }>; values: { greeting: string } };
  };
  assert.equal(migratedEvaluation.aJoker, "评测回应保留 save_greeting / greeting_agent");
  assert.equal(migratedEvaluation.greeting, undefined);
  assert.equal(migratedEvaluation.score, 11);
  assert.equal(migratedEvaluation.skipped, false);
  assert.equal(migratedEvaluation.empty, null);
  assert.equal(migratedEvaluation.literal, "save_greeting / greeting_agent");
  assert.deepEqual(
    migratedEvaluation.form,
    {
      fields: [{ id: "greeting", label: "评测嵌套表单字段保留 greeting" }],
      values: { greeting: "评测嵌套表单值保留 greeting" },
    },
  );

  const migratedEvaluationRecord = await oldPayload.findByID({
    collection: "safety-evaluations",
    id: 1,
    overrideAccess: true,
    depth: 0,
  });
  assert.equal(
    (migratedEvaluationRecord.output as { aJoker?: string }).aJoker,
    "评测回应保留 save_greeting / greeting_agent",
  );

  const legacy = await oldPayload.findByID({
    collection: "a-j-oker",
    id: 1,
    overrideAccess: true,
    depth: 0,
  });
  assert.equal(legacy.aJoker, "回应保留 save_greeting / greeting_agent / hello_greeting");

  const repo = new Repository(oldPayload, { id: "crud-owner", auth: "cookie" });
  const session = await repo.create("sessions", { title: "当前 schema CRUD" });
  let turn = await repo.create("a-j-oker", {
    sessionId: session.id,
    requestKey: "crud-owner:rename-current",
    fingerprint: "crud",
    mode: "platform",
    status: "completed",
    input: { text: "当前输入", mediaIds: [] },
    aJoker: "当前回应",
    association: "当前联想",
    artifacts: [],
  });
  assert.equal(turn.aJoker, "当前回应");
  turn = await repo.update("a-j-oker", turn.id, { aJoker: "更新后的当前回应" });
  assert.equal(turn.aJoker, "更新后的当前回应");
  const exported = await new PrivacyService(repo).exportData();
  assert.equal(exported.records["a-j-oker"].length, 1);
  await repo.remove("a-j-oker", turn.id);
  await repo.remove("sessions", session.id);

  assert.equal((await db.all(sql`PRAGMA foreign_key_check`)).length, 0);
  assert.equal((await db.all<{ integrity_check: string }>(sql`PRAGMA integrity_check`))[0]!.integrity_check, "ok");

  console.log("✓ rename migration: fresh-chain schema parity, old seed/data preservation, protocol-only JSON rewrites, SQL failure rollback, Payload CRUD and privacy export passed");
} finally {
  await oldPayload.destroy();
  await freshPayload.destroy();
  await rm(directory, { recursive: true, force: true });
}
