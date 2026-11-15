// Records explicitly supplied human decisions in a copy of a synthetic test DB.
// No model calls, live users, production accounts, or original evidence writes.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const [source, decisionFile, out, consent] = process.argv.slice(2);
if (!source || !decisionFile || !out || consent !== "--record-confirmed-rejections") throw new Error("Explicit synthetic review inputs required");
const manifest = JSON.parse(await readFile(decisionFile, "utf8"));
assert.equal(manifest.quote, "三条原请求均拒绝，不生成替代图");
assert.equal(manifest.reviewer, "孙逢");
assert.equal(manifest.decisions.length, 3);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const originalHash = hash(await readFile(source));
await mkdir(out);
const target = path.resolve(out, "reviewed.db");
assert.notEqual(target, path.resolve(source));
await copyFile(source, target);
process.env.HELLO_DATABASE_URI = `file:${target}`;
process.env.PAYLOAD_SECRET = randomUUID() + randomUUID();
process.env.HELLO_ADMIN_BOOTSTRAP = "false";
process.env.HELLO_DEPLOYED = "false";
process.env.HELLO_MEDIA_STORAGE = "database";
process.env.HELLO_FEISHU_WEBHOOK = "";
globalThis.fetch = async () => { throw new Error("Network forbidden for synthetic review closure"); };
const { BasePayload } = await import("payload");
const { sqliteAdapter } = await import("@payloadcms/db-sqlite");
const base = await (await import("../payload.config")).default;
const { OperationsService } = await import("../src/operations/service");
const payload = await new BasePayload().init({ config: { ...base,
  db: { ...sqliteAdapter({ client: { url: `file:${target}` }, transactionOptions: {}, push: false }), allowIDOnCreate: false, name: "sqlite" },
} });
try {
  assert.equal((await payload.count({ collection: "admins", overrideAccess: true })).totalDocs, 0);
  const operator = { ...await payload.create({ collection: "admins", overrideAccess: true, context: { helloAdminBootstrap: true }, data: {
    email: "delegated-review@synthetic.invalid", password: randomUUID() + randomUUID(), role: "reviewer",
  } }), collection: "admins" as const };
  const ops = new OperationsService(payload);
  const results = [];
  for (const decision of manifest.decisions) {
    assert.equal(decision.decision, "reject");
    const before = await payload.findByID({ collection: "safety-cases", id: decision.caseId, overrideAccess: true });
    assert.ok(before.owner.startsWith("regression:"));
    assert.equal(before.status, "pending"); assert.equal(before.decision, "uncertain");
    const reason = `负责人孙逢在本聊天明确确认：三条原请求均拒绝，不生成替代图。${decision.reason}`;
    const claimed = await ops.action(operator, before.id, { revision: before.revision, action: "claim", reason });
    const evidence = await ops.evidence(operator, before.id, "依据负责人明确意见处理合成评测中的待复核事项");
    assert.ok("digest" in evidence); assert.equal(evidence.digest, decision.evidenceDigest);
    const row = await ops.action(operator, before.id, { revision: claimed.revision, action: "reject", reason, reply: "经负责人复核，本次原请求不执行，不生成替代图。" });
    assert.equal(row.status, "resolved"); assert.equal(row.action, "reject"); assert.equal(row.decision, "uncertain");
    results.push({ ...decision, caseStatus: row.status, action: row.action, originalAutomaticDecision: row.decision, reason: row.reason, reply: row.reply, resolvedAt: row.resolvedAt, receipt: row.receipt, revision: row.revision });
  }
  assert.equal(hash(await readFile(source)), originalHash);
  await writeFile(path.join(out, "负责人结论.json"), JSON.stringify({ ...manifest, originalDatabaseSha256: originalHash,
    scope: "本地合成评测库副本，使用现有OperationsService与审计流程代录已确认的负责人决定；不是生产账号操作，也不是新增独立复核人员。未修改原模型判定或自动赋予合格分数。",
    newPaidCalls: 0, newImages: 0, results,
  }, null, 2));
  console.log(JSON.stringify({ recordedHumanRejections: results.length, sourceUnchanged: true, newPaidCalls: 0, newImages: 0 }));
} finally { await payload.destroy(); }
