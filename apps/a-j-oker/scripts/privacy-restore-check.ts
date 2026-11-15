import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const stage = process.argv[2];
if (!stage) {
  const directory = await mkdtemp(path.join(tmpdir(), "privacy-restore-drill-"));
  const environment: NodeJS.ProcessEnv = { ...process.env, HELLO_DATABASE_URI: `file:${directory}/drill.db`, HELLO_PRIVACY_DELETION_LEDGER: `${directory}/independent-ledger.ndjson`, HELLO_DEPLOYED: "true", NODE_ENV: "production", PAYLOAD_SECRET: "isolated-privacy-restore-test", HELLO_PRIVACY_DRILL_OWNER: randomUUID(), HELLO_PRIVACY_DRILL_OTHER: randomUUID(), HELLO_MEDIA_STORAGE: process.env.HELLO_PRIVACY_DRILL_OSS === "true" ? "oss" : "database" };
  const child = (args: string[]) => execFileSync(process.execPath, args, { env: environment, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 2 ** 22 });
  try {
    await writeFile(`${directory}/safety-retention.ndjson`, "", { mode: 0o600 });
    for (const flag of ["--restore", "--apply-safety-retention"]) {
      const rejected = spawnSync(process.execPath, ["--import", "tsx", "scripts/privacy-maintenance.ts", flag], { env: environment, encoding: "utf8" });
      assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /must be used together|must.*--apply|--apply.*同时使用/);
      const { access } = await import("node:fs/promises");
      await assert.rejects(access(`${directory}/drill.db`), "conflicting dry-run flags must fail before cms() creates SQLite");
    }
    child(["--import", "tsx", fileURLToPath(import.meta.url), "prepare"]);
    child(["scripts/privacy-snapshot.mjs", "backup", `${directory}/drill.db`, `${directory}/before-delete.db`]);
    child(["--import", "tsx", fileURLToPath(import.meta.url), "delete"]);
    child(["scripts/privacy-snapshot.mjs", "restore", `${directory}/before-delete.db`, `${directory}/drill.db`]);
    child(["--import", "tsx", "scripts/privacy-maintenance.ts", "--apply", "--restore"]);
    child(["--import", "tsx", fileURLToPath(import.meta.url), "verify"]);
    console.log("✓ 实际 SQLite 备份→删除/案件到期清理→恢复→两份独立清单重放：已删身份与已清理案件正文未复现，其他记录保留");
  } finally {
    // Remove any remaining synthetic OSS objects even after a failed assertion.
    try { child(["--import", "tsx", fileURLToPath(import.meta.url), "cleanup"]); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
} else {
  if (!process.env.HELLO_DATABASE_URI?.includes("privacy-restore-drill-") || !process.env.HELLO_PRIVACY_DRILL_OWNER || !process.env.HELLO_PRIVACY_DRILL_OTHER) throw new Error("仅允许隔离合成恢复测试");
  const { cms } = await import("../src/cms/client");
  const { Repository } = await import("../src/cms/repository");
  const { PrivacyService } = await import("../src/privacy/service");
  const { MediaService } = await import("../src/domain/media");
  const { mintCredential } = await import("../src/server/auth");
  const { OperationsService, transaction } = await import("../src/operations/service");
  const { purgeExpiredEvidence } = await import("../src/operations/retention");
  const payload = await cms();
  const owner = new Repository(payload, { id: process.env.HELLO_PRIVACY_DRILL_OWNER, auth: "cookie" });
  const other = new Repository(payload, { id: process.env.HELLO_PRIVACY_DRILL_OTHER, auth: "cookie" });
  try {
    if (stage === "prepare") {
      const pixel = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#aabbcc" } }).jpeg().toBuffer();
      for (const repo of [owner, other]) {
        await repo.create("sessions", { title: "合成隐私恢复演练" });
        await new MediaService(repo).save(pixel);
        await mintCredential(payload, "cookie", repo.owner.id);
      }
      const operations = new OperationsService(payload);
      const safetyCase = await transaction(payload, (req) => operations.createCase({ owner: other.owner.id, source: "complaint", category: "other", stage: "restore_drill" }, "不得被备份恢复的合成案件证据", req));
      await payload.update({ collection: "safety-cases", id: safetyCase.id, overrideAccess: true, context: { safetyInternal: true }, data: { reason: "不得被恢复的合成案件理由", reply: "不得被恢复的合成反馈" } });
      await transaction(payload, (req) => operations.createCase({ owner: owner.owner.id, source: "complaint", category: "other", stage: "restore_hold_drill" }, "备份后将确认法律留存的合成证据", req));
    } else if (stage === "delete") {
      const operations = new OperationsService(payload);
      const heldCase = (await payload.find({ collection: "safety-cases", overrideAccess: true, where: { stage: { equals: "restore_hold_drill" } } })).docs[0];
      const admin = await payload.create({ collection: "admins", overrideAccess: true, context: { helloAdminBootstrap: true }, data: { email: "restore-hold@example.invalid", password: randomUUID(), role: "administrator" } });
      await operations.action({ ...admin, collection: "admins" }, heldCase.id, {
        revision: heldCase.revision, action: "hold", reason: "合成恢复演练：备份后确认的具体法律留存依据",
        holdReviewAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      });
      const deletion = await new PrivacyService(owner).deleteData();
      assert.equal(deletion.operations.held, 1, "owner deletion must preserve post-backup held evidence");
      const heldEvidence = (await payload.find({ collection: "safety-evidence", overrideAccess: true, where: { caseId: { equals: heldCase.id } } })).docs[0];
      assert.ok(heldEvidence.excerpt && !heldEvidence.purgedAt);
      const safetyCase = (await payload.find({ collection: "safety-cases", overrideAccess: true, where: { stage: { equals: "restore_drill" } } })).docs[0];
      await payload.update({ collection: "safety-cases", id: safetyCase.id, overrideAccess: true, context: { safetyInternal: true }, data: { retainUntil: "2000-01-01T00:00:00.000Z" } });
      await purgeExpiredEvidence(payload, true);
    } else if (stage === "verify") {
      for (const collection of ["sessions", "media", "credentials"] as const) assert.equal((await payload.count({ collection, overrideAccess: true, where: { owner: { equals: owner.owner.id } } })).totalDocs, 0);
      assert.equal((await other.all("sessions")).length, 1);
      const media = await other.all("media");
      assert.equal(media.length, 1);
      assert.ok((await new MediaService(other).read(media[0].id)).bytes.length > 0);
      const safetyCase = (await payload.find({ collection: "safety-cases", overrideAccess: true, where: { stage: { equals: "restore_drill" } } })).docs[0];
      const evidence = (await payload.find({ collection: "safety-evidence", overrideAccess: true, where: { caseId: { equals: safetyCase.id } } })).docs[0];
      assert.ok(safetyCase.retentionPurgedAt); assert.equal(safetyCase.reason, null); assert.equal(safetyCase.reply, null);
      assert.ok(evidence.purgedAt); assert.equal(evidence.excerpt, null);
      const heldCase = (await payload.find({ collection: "safety-cases", overrideAccess: true, where: { stage: { equals: "restore_hold_drill" } } })).docs[0];
      const heldEvidence = (await payload.find({ collection: "safety-evidence", overrideAccess: true, where: { caseId: { equals: heldCase.id } } })).docs[0];
      assert.equal(heldCase.legalHold, true); assert.ok(heldCase.holdReviewAt);
      assert.ok(!heldCase.retentionPurgedAt); assert.ok(heldEvidence.excerpt); assert.ok(!heldEvidence.purgedAt);
      const { readFile } = await import("node:fs/promises");
      const guards = (await readFile(`${path.dirname(process.env.HELLO_PRIVACY_DELETION_LEDGER!)}/safety-retention.ndjson`, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      assert.ok(!guards.some((record) => record.caseId === heldCase.id && record.event === "purge"), "restored hold must not receive an erroneous purge guard");
    } else if (stage === "cleanup") {
      for (const repo of [owner, other]) await new PrivacyService(repo).deleteData();
    } else throw new Error("Unknown drill stage");
  } finally { await payload.destroy(); }
}
