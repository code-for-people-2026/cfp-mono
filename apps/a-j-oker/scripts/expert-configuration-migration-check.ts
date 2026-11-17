import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "@payloadcms/db-sqlite";
import { createLocalReq } from "payload";

const dir = await mkdtemp(path.join(tmpdir(), "aj-expert-migration-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/migration.db`;
process.env.PAYLOAD_SECRET = "isolated-expert-migration-test";
process.env.HELLO_DEPLOYED = "true";
Object.assign(process.env, { NODE_ENV: "test" });

const { cms } = await import("../src/cms/client");
const { migrations } = await import("../src/cms/migrations");
const { DEFAULT_AGENT_CONFIGS } = await import("../src/agent/default-prompts");
const { loadAgentConfiguration } = await import("../src/agent/configuration");
const { seedAgents } = await import("../src/cms/seed");
const payload = await cms();

try {
  const db = payload.db.drizzle;
  const req = await createLocalReq({}, payload);
  const expert = migrations.find((migration) =>
    migration.name.includes("expert_handoff"),
  )!;
  for (const migration of migrations) {
    if (migration !== expert) await migration.up({ db, payload, req });
  }

  for (const [index, config] of DEFAULT_AGENT_CONFIGS.entries()) {
    await db.run(sql`INSERT INTO agent_configs
      (id, name, key, enabled, prompt, updated_at, created_at)
      VALUES (${index + 1}, ${config.name}, ${config.key}, 1,
        ${config.key === "cbt" ? "管理员保留的 CBT 提示词" : config.prompt},
        '2026-11-14T00:00:00.000Z', '2026-11-14T00:00:00.000Z')`);
  }
  await db.run(sql`INSERT INTO knowledge_bases
    (id, name, enabled, provider, content, updated_at, created_at)
    VALUES (1, '迁移前绑定', 1, 'inline', '必须保留的参考资料',
      '2026-11-14T00:00:00.000Z', '2026-11-14T00:00:00.000Z')`);
  const cbtId = DEFAULT_AGENT_CONFIGS.findIndex((item) => item.key === "cbt") + 1;
  await db.run(sql`INSERT INTO agent_configs_rels
    (id, "order", parent_id, path, knowledge_bases_id)
    VALUES (1, 1, ${cbtId}, 'knowledgeBases', 1)`);
  await db.run(sql`INSERT INTO sessions (id, owner, title)
    VALUES (1, 'migration-owner', '迁移前会话')`);
  await db.run(sql`INSERT INTO greetings
    (id, owner, session_id, request_key, fingerprint, mode, status, input, greeting)
    VALUES (1, 'migration-owner', 1, 'migration-request', 'fingerprint',
      'platform', 'completed', '"迁移前输入"', '迁移前问候')`);

  await expert.up({ db, payload, req });

  const columns = await db.all<{
    name: string;
    notnull: number;
    dflt_value: string | null;
  }>(
    sql`PRAGMA table_info(agent_configs)`,
  );
  assert.equal(columns.find((column) => column.name === "theme")?.notnull, 0);
  assert.equal(
    columns.find((column) => column.name === "theme")?.dflt_value,
    null,
  );
  assert.equal(
    columns.find((column) => column.name === "preferred_layout")?.notnull,
    0,
  );
  assert.deepEqual(
    (await db.all<{ name: string }>(
      sql`PRAGMA table_info(agent_configs_allowed_components)`,
    )).map((column) => column.name),
    ["order", "parent_id", "value", "id"],
  );
  for (const table of [
    "agent_configs_allowed_components",
    "agent_configs_preferred_components",
  ]) {
    const indexes = await db.all<{ name: string }>(
      sql.raw(`PRAGMA index_list(${table})`),
    );
    assert.deepEqual(
      indexes.map((index) => index.name).sort(),
      [`${table}_order_idx`, `${table}_parent_idx`],
    );
  }
  assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
  assert.equal(
    (await db.all<{ integrity_check: string }>(sql`PRAGMA integrity_check`))[0]
      .integrity_check,
    "ok",
  );

  let loaded = await loadAgentConfiguration(payload);
  for (const specialist of loaded.specialists) {
    const expected = DEFAULT_AGENT_CONFIGS.find(
      (item) => item.key === specialist.approach,
    )!;
    assert.equal(specialist.theme, expected.theme);
    assert.equal(specialist.preferredLayout, expected.preferredLayout);
    assert.deepEqual(specialist.allowedComponents, expected.allowedComponents);
    assert.deepEqual(
      specialist.preferredComponents,
      expected.preferredComponents,
    );
  }
  const cbt = loaded.specialists.find((item) => item.approach === "cbt")!;
  assert.equal(cbt.prompt, "管理员保留的 CBT 提示词");
  assert.equal(cbt.theme, "blue");
  assert.equal(cbt.preferredLayout, "step_by_step");
  assert.deepEqual(cbt.preferredComponents, ["form"]);
  assert.equal((await cbt.knowledge!("迁移", new AbortController().signal)).sources[0].excerpt, "必须保留的参考资料");
  assert.equal(
    (await payload.findByID({ collection: "greetings", id: 1, overrideAccess: true }))
      .greeting,
    "迁移前问候",
  );
  assert.deepEqual(await seedAgents(payload), { created: 0, preserved: 9 });

  await payload.update({
    collection: "agent-configs",
    id: cbtId,
    overrideAccess: true,
    data: {
      theme: "amber",
      allowedComponents: [],
      preferredComponents: [],
    },
  });
  await assert.rejects(
    payload.update({
      collection: "agent-configs",
      id: cbtId,
      overrideAccess: true,
      data: { preferredComponents: ["form"] },
    }),
    /必须同时被允许/,
  );
  loaded = await loadAgentConfiguration(payload);
  const customized = loaded.specialists.find((item) => item.approach === "cbt")!;
  assert.equal(customized.theme, "amber");
  assert.deepEqual(customized.allowedComponents, []);
  assert.deepEqual(customized.preferredComponents, []);
  await assert.rejects(expert.down({ db, payload, req }), /不可自动回退/);
  assert.equal(
    (await payload.findByID({
      collection: "agent-configs",
      id: cbtId,
      overrideAccess: true,
    })).prompt,
    "管理员保留的 CBT 提示词",
  );

  console.log(
    "✓ 隔离临时库从专家功能前迁移链升级；配置/提示词/知识绑定/问候保留，方法默认值、空作品语义、实际 Payload 读取及 SQLite 完整性通过",
  );
} finally {
  await payload.destroy();
  await rm(dir, { recursive: true, force: true });
}
