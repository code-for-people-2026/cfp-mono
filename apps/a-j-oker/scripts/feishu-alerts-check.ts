import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "@payloadcms/db-sqlite";
import { createLocalReq } from "payload";
if (process.argv.includes("--concurrent-child")) {
  if (!process.env.HELLO_FEISHU_TEST_LOG || !process.env.HELLO_DATABASE_URI?.includes("hello-feishu-")) throw new Error("isolated test configuration required");
  globalThis.fetch = async () => { throw new Error("network prohibited"); };
  const { cms } = await import("../src/cms/client");
  const { FeishuAlerts } = await import("../src/operations/alerts");
  const { feishuConfig } = await import("../src/operations/feishu");
  const childPayload = await cms();
  process.send?.("ready");
  await new Promise<void>((resolve) => process.once("message", () => resolve()));
  try {
    const worker = new FeishuAlerts(childPayload, feishuConfig()!, async (_, target) => {
      assert.ok("caseId" in target);
      await appendFile(process.env.HELLO_FEISHU_TEST_LOG!, `${target.caseId}\n`);
      return { ok: true };
    }, () => Number(process.env.HELLO_FEISHU_TEST_NOW));
    process.send?.({ result: await worker.tick() });
  } catch (error) {
    // Competing SQLite processes may receive BUSY. No other failure is expected.
    let cause: unknown = error;
    const seen = new Set<unknown>();
    let busy = false;
    while (cause instanceof Error && !seen.has(cause)) {
      seen.add(cause);
      if (String(cause).includes("SQLITE_BUSY")) { busy = true; break; }
      cause = cause.cause;
    }
    if (!busy) throw error;
    process.send?.({ result: "sqlite_busy" });
  } finally { await childPayload.destroy(); process.disconnect?.(); }
  process.exit(0);
}
const dir = await mkdtemp(join(tmpdir(), "hello-feishu-"));
Object.assign(process.env, { HELLO_DATABASE_URI: `file:${dir}/check.db`, PAYLOAD_SECRET: randomUUID(), HELLO_DEPLOYED: "true", NODE_ENV: "test",
  HELLO_ORIGIN: "https://example.invalid", HELLO_FEISHU_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/synthetic-only",
  HELLO_FEISHU_SIGNING_SECRET: "synthetic-signing-secret", HELLO_FEISHU_ALERTS_ENABLED: "true" });
// All delivery uses an injected fake; fail immediately if any code attempts real network I/O.
globalThis.fetch = async () => { throw new Error("network prohibited in isolated validation"); };
const { cms } = await import("../src/cms/client");
const { migrations } = await import("../src/cms/migrations");
const { OperationsService, transaction } = await import("../src/operations/service");
const { FeishuAlerts, feishuAlertStatus } = await import("../src/operations/alerts");
const { feishuConfig } = await import("../src/operations/feishu");
const payload = await cms();
try {
  const req = await createLocalReq({}, payload);
  for (const migration of migrations.filter((m) => !m.name.includes("feishu_alerts"))) await migration.up({ db: payload.db.drizzle, payload, req });
  await payload.db.drizzle.run(sql`INSERT INTO safety_cases (receipt, owner, source, status, severity, category, stage) VALUES ('legacy-untouched', 'legacy', 'moderation', 'pending', 'urgent', 'self_harm', 'interaction_crisis')`);
  const before = await payload.db.drizzle.all(sql`SELECT receipt, owner, status FROM safety_cases`);
  const migration = migrations.find((m) => m.name.includes("feishu_alerts"))!;
  await migration.up({ db: payload.db.drizzle, payload, req }); await migration.up({ db: payload.db.drizzle, payload, req });
  assert.deepEqual(await payload.db.drizzle.all(sql`SELECT receipt, owner, status FROM safety_cases`), before);
  assert.equal((await payload.find({ collection: "safety-cases", overrideAccess: true })).docs[0].alertStatus, null, "旧案件不得自动回填并群发");
  await assert.rejects(transaction(payload, async (request) => {
    await payload.create({ collection: "safety-alert-state", overrideAccess: true, req: request, data: { key: "rollback-probe" } });
    throw new Error("rollback probe");
  }));
  assert.equal((await payload.find({ collection: "safety-alert-state", overrideAccess: true, where: { key: { equals: "rollback-probe" } } })).docs.length, 0);
  const config = feishuConfig()!;
  let now = Date.now(), deliveries = 0, tests = 0;
  let behavior: "success" | "temporary" | "permanent" = "success";
  const send = async (_: typeof config, target: { caseId: number; receipt: string } | { testId: string }) => {
    if ("testId" in target) { tests++; return { ok: true as const }; }
    deliveries++;
    assert.deepEqual(Object.keys(target).sort(), ["caseId", "receipt"]);
    return behavior === "success" ? { ok: true as const } : { ok: false as const, code: behavior === "temporary" ? "http_429" : "provider_19021", retryable: behavior === "temporary" };
  };
  let alerts = new FeishuAlerts(payload, config, send, () => now);
  const ops = new OperationsService(payload);
  const create = (severity: "urgent" | "normal" = "urgent") => transaction(payload, (request) => ops.createCase({ owner: `synthetic:${randomUUID()}`, source: "moderation", category: "self_harm", stage: "interaction_crisis", severity }, "不得出现在飞书的合成正文", request));
  const read = (id: number) => payload.findByID({ collection: "safety-cases", id, overrideAccess: true });
  const update = (id: number, data: Record<string, unknown>) => transaction(payload, (request) => payload.update({ collection: "safety-cases", id, overrideAccess: true, req: request, data }));
  assert.equal((await feishuAlertStatus(payload)).ready, false);
  const first = await create(); now += 2000;
  assert.equal(await alerts.tick(), "not_ready_or_busy"); assert.equal(deliveries, 0);
  const tested = await alerts.test(); assert.equal(tests, 1);
  assert.equal(await alerts.tick(), "not_ready_or_busy", "平台成功不能替代本人确认");
  await assert.rejects(alerts.confirmTest(randomUUID()));
  await alerts.confirmTest(tested.testId);
  assert.equal((await feishuAlertStatus(payload)).ready, false, "未运行任务不能声称已接入");
  assert.equal(await alerts.tick(), "delivered"); assert.equal(deliveries, 1);
  assert.equal((await read(first.id)).status, "pending", "通知不能自动受理案件");
  assert.equal((await read(first.id)).alertStatus, "delivered");
  assert.equal((await feishuAlertStatus(payload)).ready, true);
  assert.equal(await alerts.tick(), "not_ready_or_busy", "全局发送间隔需跨任务持久化");
  now += 2500; assert.equal(await alerts.tick(), "idle"); assert.equal(deliveries, 1);
  const normal = await create("normal"); assert.equal(normal.alertStatus, null);
  const accepted = await create(); await update(accepted.id, { acceptedAt: new Date(now).toISOString() });
  now += 2500; await alerts.tick(); assert.equal((await read(accepted.id)).alertStatus, "cancelled"); assert.equal(deliveries, 1);
  const retry = await create(); behavior = "temporary"; now += 2500;
  await alerts.tick(); assert.equal((await read(retry.id)).alertStatus, "retry");
  assert.equal((await feishuAlertStatus(payload)).ready, false, "失败必须反映在通知可用状态");
  now += 3000; await alerts.tick(); assert.equal(deliveries, 2, "未到重试时间不得重复发送");
  alerts = new FeishuAlerts(payload, config, send, () => now); behavior = "success"; now += 15000;
  await alerts.tick(); assert.equal((await read(retry.id)).alertStatus, "delivered", "重建服务实例后从数据库恢复待重试任务");
  const permanent = await create(); behavior = "permanent"; now += 2500; await alerts.tick();
  assert.equal((await read(permanent.id)).alertStatus, "failed"); const beforePermanent = deliveries;
  now += 2500; await alerts.tick(); assert.equal(deliveries, beforePermanent);
  const exhaustion = await create(); behavior = "temporary";
  for (let i = 0; i < 5; i++) { now += 610000; await alerts.tick(); }
  assert.equal((await read(exhaustion.id)).alertStatus, "failed");
  assert.equal(((await read(exhaustion.id)).alertDetails as { attempts: number }).attempts, 5);
  const crash = await create(); await update(crash.id, { alertStatus: "sending", alertNextAt: new Date(now - 1).toISOString(), alertDetails: { attempts: 1, token: "dead-worker" } });
  behavior = "success"; now += 2500; const beforeUncertain = deliveries; await alerts.tick(); assert.equal((await read(crash.id)).alertStatus, "failed", "过期发送锁结果不确定，需人工核对"); assert.equal(deliveries, beforeUncertain);
  // Two workers sharing the SQLite adapter must not overlap transactions or lose completion writes.
  const concurrent = await create(); now += 2500; const count = deliveries;
  const race = await Promise.allSettled([alerts.tick(), new FeishuAlerts(payload, config, send, () => now).tick()]);
  assert.ok(race.every((r) => r.status === "fulfilled"));
  assert.equal(deliveries, count + 1); assert.equal((await read(concurrent.id)).alertStatus, "delivered");
  const separate = await create(); now += 2500;
  const logPath = join(dir, "transmissions.log");
  const children = Array.from({ length: 2 }, () => fork(fileURLToPath(import.meta.url), ["--concurrent-child"], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { ...process.env, HELLO_FEISHU_TEST_LOG: logPath, HELLO_FEISHU_TEST_NOW: String(now) },
  }));
  try {
    const finished = children.map((child) => new Promise<void>((resolve, reject) => {
      let errors = "";
      child.stderr?.on("data", (chunk) => { errors += String(chunk); });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`test worker ${code}: ${errors}`)));
    }));
    await Promise.all(children.map((child) => new Promise<void>((resolve, reject) => {
      child.once("message", (value) => value === "ready" ? resolve() : reject(new Error("child not ready")));
      child.once("exit", () => reject(new Error("child exited before ready")));
    })));
    for (const child of children) child.send("start");
    await Promise.all(finished);
    assert.equal(await readFile(logPath, "utf8"), `${separate.id}\n`, "separate processes must transmit exactly once");
    assert.equal((await read(separate.id)).alertStatus, "delivered", "completion survives separate-process contention");
  } finally { for (const child of children) if (child.exitCode === null) child.kill(); }
  const rotation = new FeishuAlerts(payload, { ...config, fingerprint: "changed-config" }, send, () => now);
  now += 2500; assert.equal(await rotation.tick(), "not_ready_or_busy");
  const state = (await payload.find({ collection: "safety-alert-state", overrideAccess: true })).docs[0];
  await transaction(payload, (request) => payload.update({ collection: "safety-alert-state", id: state.id, overrideAccess: true, req: request, data: { heartbeatAt: new Date(Date.now() - 60000).toISOString() } }));
  assert.equal((await feishuAlertStatus(payload)).ready, false, "失联任务不得继续显示健康");
  await assert.rejects(payload.find({ collection: "safety-alert-state", overrideAccess: false, user: null }));
  await assert.rejects(payload.update({ collection: "safety-cases", id: first.id, overrideAccess: false, user: null, data: { alertStatus: "delivered" } }));
  const publicRows = await ops.mine({ id: first.owner, auth: "cookie" });
  assert.ok(!JSON.stringify(publicRows).includes("alertDetails"));
  assert.ok(!JSON.stringify((await payload.find({ collection: "safety-audit", overrideAccess: true, limit: 100 })).docs).includes(config.secret));
  assert.equal((await payload.db.drizzle.all(sql`PRAGMA foreign_key_check`)).length, 0);
  assert.equal((await payload.db.drizzle.all<{ integrity_check: string }>(sql`PRAGMA integrity_check`))[0].integrity_check, "ok");
  console.log("PASS: no live network; idempotent migration/legacy preservation; verification gates; durable queue/retry/exhaustion/crash recovery; concurrent worker dedup; config rotation; health; permission and privacy boundaries");
} finally { await payload.destroy(); }
