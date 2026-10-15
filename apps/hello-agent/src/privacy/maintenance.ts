import { createHash } from "node:crypto";
import type { Payload } from "payload";
import { Repository } from "../cms/repository";
import { deleteMediaObjectsByOwnerDigest } from "../domain/media";
import { PrivacyService } from "./service";
import { deletionLedgerPath, readDeletionLedger } from "./deletion-ledger";

type MaintenanceResult = { dryRun: boolean; eligibleIdentities: number; deleted: number };
export class PrivacyMaintenanceError extends AggregateError {
  constructor(readonly result: MaintenanceResult, failures: Error[]) {
    super(failures, `隐私维护未完成：${failures.length} 项失败，已完成 ${result.deleted}/${result.eligibleIdentities} 个身份；修复后重试，禁止恢复开放`);
    this.name = "PrivacyMaintenanceError";
  }
}

// Restore mode MUST run with application traffic stopped, using the independent
// ledger retained outside the restored database. Default behavior is dry-run.
export async function maintainPrivacy(payload: Payload, options: { apply: boolean; restoreLedger?: string }) {
  const restoreLedger = options.restoreLedger === undefined ? undefined : deletionLedgerPath(options.restoreLedger);
  if (options.restoreLedger !== undefined && !restoreLedger) throw new Error("恢复必须使用独立删除清单的绝对路径");
  const revoked = new Set<string>();
  if (restoreLedger) for await (const digest of readDeletionLedger(restoreLedger)) revoked.add(digest);
  const owners = new Set<string>();
  const pageSize = 100;
  let cursor = 0;
  while (true) {
    const profiles = await payload.find({ collection: "privacy-profiles", overrideAccess: true, pagination: false, depth: 0, limit: pageSize, sort: "id", select: { id: true, owner: true, state: true, expiresAt: true }, where: { id: { greater_than: cursor } } });
    for (const row of profiles.docs)
      if (row.state === "withdrawn" || row.state === "deleting" || (row.state !== "deleted" && row.expiresAt && Date.parse(String(row.expiresAt)) <= Date.now())) owners.add(String(row.owner));
    if (profiles.docs.length < pageSize) break;
    cursor = profiles.docs[profiles.docs.length - 1].id;
  }
  // Legacy records predate privacy profiles. Consider all owned collections so
  // old anonymous conversations/media expire too; a recent peer protects the owner.
  const retention = process.env.HELLO_PRIVACY_RETENTION_DAYS || "30";
  if (!/^[1-9]\d{0,3}$/.test(retention)) throw new Error("隐私保留期限配置无效");
  const cutoff = new Date(Date.now() - Number(retention) * 86400_000).toISOString();
  const legacyCollections = ["sessions", "greetings", "media", "credentials", "adk-sessions", "session-locks", "wechat-identities", "age-profiles"] as const;
  const checked = new Set<string>();
  for (const collection of legacyCollections) {
    cursor = 0;
    while (true) {
      const rows = await payload.find({ collection, overrideAccess: true, pagination: false, depth: 0, limit: pageSize, sort: "id", select: { id: true, owner: true }, where: { and: [{ id: { greater_than: cursor } }, { updatedAt: { less_than: cutoff } }] } });
      for (const row of rows.docs) {
        if (checked.has(row.owner) || owners.has(row.owner)) continue;
        checked.add(row.owner);
        const profile = await payload.count({ collection: "privacy-profiles", overrideAccess: true, where: { owner: { equals: row.owner } } });
        if (profile.totalDocs) continue;
        let recent = false;
        for (const peer of legacyCollections) {
          const other = await payload.count({ collection: peer, overrideAccess: true, where: { and: [{ owner: { equals: row.owner } }, { updatedAt: { greater_than_equal: cutoff } }] } });
          if (other.totalDocs) { recent = true; break; }
        }
        if (!recent) owners.add(row.owner);
      }
      if (rows.docs.length < pageSize) break;
      cursor = rows.docs[rows.docs.length - 1].id;
    }
  }
  if (restoreLedger) {
    // Older snapshots may predate the privacy collection contents entirely.
    for (const collection of ["sessions", "greetings", "media", "credentials", "adk-sessions", "session-locks", "privacy-profiles", "wechat-identities", "age-profiles"] as const) {
      cursor = 0;
      while (true) {
        const rows = await payload.find({ collection, overrideAccess: true, pagination: false, depth: 0, limit: pageSize, sort: "id", select: { id: true, owner: true }, where: { id: { greater_than: cursor } } });
        for (const row of rows.docs) if (revoked.has(createHash("sha256").update(String(row.owner)).digest("hex"))) owners.add(String(row.owner));
        if (rows.docs.length < pageSize) break;
        cursor = rows.docs[rows.docs.length - 1].id;
      }
    }
  }
  const objectOnlyDigests = new Set(revoked);
  for (const id of owners) objectOnlyDigests.delete(createHash("sha256").update(id).digest("hex"));
  let deleted = 0;
  const failures: Error[] = [];
  for (const id of owners) {
    if (!options.apply) continue;
    try {
      const service = new PrivacyService(new Repository(payload, { id, auth: "cookie" }));
      await service.deleteData(); deleted++;
    } catch {
      // Independent identities must still be attempted. Identify the failed
      // ledger entry without logging raw identity IDs, object keys or content.
      failures.push(new Error(`身份清理失败，ownerDigest=${createHash("sha256").update(id).digest("hex")}`));
    }
  }
  // Database and object snapshots may have different cutoffs. A missing owner
  // row must not prevent replaying that identity's independent deletion entry.
  for (const ownerDigest of objectOnlyDigests) {
    if (!options.apply) continue;
    try {
      await deleteMediaObjectsByOwnerDigest(ownerDigest); deleted++;
    } catch {
      failures.push(new Error(`对象清理失败，ownerDigest=${ownerDigest}`));
    }
  }
  if (options.apply) {
    try {
      const locks = await payload.delete({ collection: "age-locks", overrideAccess: true, where: { expiresAt: { less_than: new Date().toISOString() } } });
      if (locks.errors.length) throw new Error("partial deletion");
    } catch { failures.push(new Error("过期年龄核验锁清理失败")); }
    try {
      const expired = await payload.delete({ collection: "credentials", overrideAccess: true, where: { expiresAt: { less_than: new Date().toISOString() } } });
      if (expired.errors.length) throw new Error("partial deletion");
    } catch { failures.push(new Error("过期凭证清理失败")); }
  }
  const result = { dryRun: !options.apply, eligibleIdentities: owners.size + objectOnlyDigests.size, deleted };
  if (failures.length) throw new PrivacyMaintenanceError(result, failures);
  return result;
}
