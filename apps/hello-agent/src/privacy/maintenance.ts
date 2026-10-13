import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Payload } from "payload";
import { Repository } from "../cms/repository";
import { PrivacyService } from "./service";

// Restore mode MUST run with application traffic stopped, using the independent
// ledger retained outside the restored database. Default behavior is dry-run.
export async function maintainPrivacy(payload: Payload, options: { apply: boolean; restoreLedger?: string }) {
  const revoked = new Set<string>();
  if (options.restoreLedger) {
    const lines = (await readFile(options.restoreLedger, "utf8")).trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const record = JSON.parse(line) as { ownerDigest?: unknown };
      if (typeof record.ownerDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.ownerDigest)) throw new Error("删除清单格式无效，禁止恢复开放");
      revoked.add(record.ownerDigest);
    }
  }
  const owners = new Set<string>();
  const profiles = await payload.find({ collection: "privacy-profiles", overrideAccess: true, pagination: false });
  for (const row of profiles.docs)
    if (row.state === "withdrawn" || row.state === "deleting" || (row.state !== "deleted" && row.expiresAt && Date.parse(String(row.expiresAt)) <= Date.now())) owners.add(String(row.owner));
  if (options.restoreLedger) {
    // Older snapshots may predate the privacy collection contents entirely.
    for (const collection of ["sessions", "greetings", "media", "credentials", "adk-sessions", "session-locks", "privacy-profiles"] as const) {
      const rows = await payload.find({ collection, overrideAccess: true, pagination: false, depth: 0 });
      for (const row of rows.docs) if (revoked.has(createHash("sha256").update(String(row.owner)).digest("hex"))) owners.add(String(row.owner));
    }
  }
  let deleted = 0;
  for (const id of owners) {
    if (!options.apply) continue;
    const service = new PrivacyService(new Repository(payload, { id, auth: "cookie" }));
    await service.deleteData(); deleted++;
  }
  if (options.apply) await payload.delete({ collection: "credentials", overrideAccess: true, where: { expiresAt: { less_than: new Date().toISOString() } } });
  return { dryRun: !options.apply, eligibleIdentities: owners.size, deleted };
}
