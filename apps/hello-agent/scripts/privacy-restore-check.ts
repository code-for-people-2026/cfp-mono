import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
    child(["--import", "tsx", fileURLToPath(import.meta.url), "prepare"]);
    child(["scripts/privacy-snapshot.mjs", "backup", `${directory}/drill.db`, `${directory}/before-delete.db`]);
    child(["--import", "tsx", fileURLToPath(import.meta.url), "delete"]);
    child(["scripts/privacy-snapshot.mjs", "restore", `${directory}/before-delete.db`, `${directory}/drill.db`]);
    child(["--import", "tsx", "scripts/privacy-maintenance.ts", "--apply", "--restore"]);
    child(["--import", "tsx", fileURLToPath(import.meta.url), "verify"]);
    console.log("✓ 实际 SQLite 备份→删除→恢复→独立清单重放：已删身份未复现、他人记录保留、图片及凭证随身份清除");
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
    } else if (stage === "delete") {
      assert.equal((await new PrivacyService(owner).deleteData()).deleted, true);
    } else if (stage === "verify") {
      for (const collection of ["sessions", "media", "credentials"] as const) assert.equal((await payload.count({ collection, overrideAccess: true, where: { owner: { equals: owner.owner.id } } })).totalDocs, 0);
      assert.equal((await other.all("sessions")).length, 1);
      const media = await other.all("media");
      assert.equal(media.length, 1);
      assert.ok((await new MediaService(other).read(media[0].id)).bytes.length > 0);
    } else if (stage === "cleanup") {
      for (const repo of [owner, other]) await new PrivacyService(repo).deleteData();
    } else throw new Error("Unknown drill stage");
  } finally { await payload.destroy(); }
}
