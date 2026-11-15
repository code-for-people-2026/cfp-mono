import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "libsql";

const dir = await mkdtemp(join(tmpdir(), "hello-transactions-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${dir}/test.db`, PAYLOAD_SECRET: randomUUID(), HELLO_DEPLOYED: "false",
  HELLO_ORIGIN: "https://example.invalid", HELLO_FEISHU_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/synthetic-only",
  HELLO_FEISHU_SIGNING_SECRET: "synthetic-only-signing-secret", HELLO_FEISHU_ALERTS_ENABLED: "true",
});
globalThis.fetch = async () => { throw new Error("network prohibited"); };
// Keep the legacy DELETE-journal failed-COMMIT regression. Normal WAL operation
// and reader/writer concurrency are covered by sqlite-contention-check.ts.
const config = await (await import("../payload.config")).default;
const initialize = config.db.init;
config.db.init = (args) => Object.assign(initialize(args), { wal: false });
const { cms } = await import("../src/cms/client");
const { transaction, OperationsService } = await import("../src/operations/service");
const { FeishuAlerts } = await import("../src/operations/alerts");
const { feishuConfig } = await import("../src/operations/feishu");
const payload = await cms();
try {
  const db = payload.db.drizzle;
  const original = db.transaction.bind(db);
  let failCommit = 0;
  db.transaction = ((action, ...rest) => original(async (tx) => {
    const value = await action(tx);
    if (failCommit > 0 && --failCommit === 0) throw new Error("injected commit failure");
    return value;
  }, ...rest)) as typeof db.transaction;
  const exists = async (key: string) => (await payload.find({ collection: "safety-alert-state", overrideAccess: true, where: { key: { equals: key } } })).docs.length;
  failCommit = 1;
  await assert.rejects(transaction(payload, (req) => payload.create({ collection: "safety-alert-state", overrideAccess: true, req, data: { key: "commit-failure" } })), /injected commit failure/);
  assert.equal(await exists("commit-failure"), 0);
  await assert.rejects(transaction(payload, async (req) => {
    await payload.create({ collection: "safety-alert-state", overrideAccess: true, req, data: { key: "explicit-rollback" } });
    throw new Error("original action error");
  }), /original action error/);
  assert.equal(await exists("explicit-rollback"), 0);
  const wrapped = db.transaction;
  db.transaction = (async () => { throw new Error("begin failure"); }) as typeof db.transaction;
  await assert.rejects(transaction(payload, async () => assert.fail("must not enter transaction")), /begin failure/);
  db.transaction = wrapped;
  await transaction(payload, (req) => payload.create({ collection: "safety-alert-state", overrideAccess: true, req, data: { key: "recovered" } }));
  assert.equal(await exists("recovered"), 1);
  // Real DELETE-journal read contention, like the separate app and worker.
  const reader = new Database(join(dir, "test.db"));
  try {
    reader.exec("BEGIN");
    reader.prepare("SELECT * FROM safety_alert_state").all();
    await assert.rejects(transaction(payload, (req) => payload.create({ collection: "safety-alert-state", overrideAccess: true, req, data: { key: "locked-commit" } })), /SQLITE_BUSY/);
  } finally { reader.exec("ROLLBACK"); reader.close(); }
  assert.equal(await exists("locked-commit"), 0);

  let now = Date.now(), sends = 0;
  const config = feishuConfig()!;
  const sender = async (_: typeof config, target: { caseId: number; receipt: string } | { testId: string }) => {
    if ("caseId" in target) sends++;
    return { ok: true as const };
  };
  let alerts = new FeishuAlerts(payload, config, sender, () => now);
  const test = await alerts.test();
  await alerts.confirmTest(test.testId);
  const row = await transaction(payload, (req) => new OperationsService(payload).createCase({ owner: "synthetic", source: "moderation", category: "self_harm", stage: "interaction_crisis", severity: "urgent" }, "synthetic drill", req));
  now = Date.now() + 1000;
  failCommit = 1;
  await assert.rejects(alerts.tick(), /injected commit failure/);
  assert.equal(sends, 0, "an uncommitted claim must never send");
  failCommit = 2;
  await assert.rejects(alerts.tick(), /injected commit failure/);
  assert.equal(sends, 1);
  assert.equal((await payload.findByID({ collection: "safety-cases", id: row.id, overrideAccess: true })).alertStatus, "sending");
  now += 31_000;
  alerts = new FeishuAlerts(payload, config, sender, () => now);
  await alerts.tick();
  assert.equal(sends, 1, "an uncertain external delivery must not be resent after restart");
  const uncertain = await payload.findByID({ collection: "safety-cases", id: row.id, overrideAccess: true });
  assert.equal(uncertain.alertStatus, "failed");
  assert.equal((uncertain.alertDetails as { code: string }).code, "delivery_uncertain");
  console.log("PASS commit/begin failures propagate; rollback/recovery; no send on failed claim; uncertain delivery stops across restart");
} finally {
  await payload.destroy();
  await rm(dir, { recursive: true, force: true });
}
