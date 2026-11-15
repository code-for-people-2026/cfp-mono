import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { PayloadRequest } from "payload";
import { IdentityService } from "../src/identity";
import { legacyBackendFromEnv } from "../src/legacy";
import { attachmentObjectKey, MAX_ATTACHMENT_BYTES } from "../src/records/attachments";
import { hash, recordCollections, RecordsRepository } from "../src/records/persistence";
import { acquireRuntimeLock } from "../src/runtime-lock";
import { configuredAttachmentObjectStore, type AttachmentObjectStore } from "../src/storage/attachment-objects";
import { openStore } from "../src/store";
import { WechatCodeProvider } from "../src/wechat";

interface StoredAttachment {
  id: string; babyId: string; byteLength: number; sha256: string; requestFingerprint: string;
  storage?: { kind: "oss"; key: string };
}
interface AttachmentRow { key?: unknown; babyId?: unknown; value?: unknown }
interface AttachmentGroup { path: string; file: string; values: StoredAttachment[]; localPresent: boolean[] }
interface AttachmentStorageMigrationReport {
  mode: "dry-run" | "apply"; scanned: number; legacy: number; oss: number;
  localVerified: number; absentLocal: number; remoteVerified: number; remoteUploaded: number;
  metadataUpdated: number; cleanupCandidates: number; removedLocal: number; cleanupFailed: number;
}
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const unavailable = (): never => { throw new Error("ATTACHMENT_MIGRATION_OBJECT_INVALID"); };
function storedValue(row: AttachmentRow): StoredAttachment {
  const value = row.value as StoredAttachment | undefined;
  if (!value) throw new Error("ATTACHMENT_MIGRATION_OBJECT_INVALID");
  if (!value.id || !value.babyId || !/^att_[a-f0-9]{64}$/.test(value.id) ||
      !Number.isSafeInteger(value.byteLength) || value.byteLength <= 0 || value.byteLength > MAX_ATTACHMENT_BYTES ||
      !/^[a-f0-9]{64}$/.test(value.sha256 ?? "") || !/^[a-f0-9]{64}$/.test(value.requestFingerprint ?? "") ||
      row.key !== value.id || row.babyId !== value.babyId) unavailable();
  if (value.storage && (value.storage.kind !== "oss" || value.storage.key !== attachmentObjectKey(value.babyId, value.sha256))) unavailable();
  return value;
}
function legacyPath(directory: string, value: StoredAttachment) {
  return path.join(path.resolve(directory), "private-attachments", hash(value.babyId), value.sha256);
}
async function readVerifiedLocal(directory: string, value: StoredAttachment): Promise<Buffer | undefined> {
  let file;
  try {
    file = await open(legacyPath(directory, value), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== value.byteLength || stat.size > MAX_ATTACHMENT_BYTES) unavailable();
    const bytes = await file.readFile();
    if (bytes.byteLength !== value.byteLength || checksum(bytes) !== value.sha256) unavailable();
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message === "ATTACHMENT_MIGRATION_OBJECT_INVALID") throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  } finally { await file?.close(); }
}
async function readVerifiedRemote(objectStore: AttachmentObjectStore, key: string, value: StoredAttachment): Promise<Buffer> {
  const bytes = await objectStore.get(key, MAX_ATTACHMENT_BYTES);
  if (bytes.byteLength !== value.byteLength || checksum(bytes) !== value.sha256) unavailable();
  return bytes;
}
function sameMetadataExceptStorage(left: StoredAttachment, right: StoredAttachment): boolean {
  const leftMetadata = { ...left }, rightMetadata = { ...right };
  delete leftMetadata.storage; delete rightMetadata.storage;
  return hash(leftMetadata) === hash(rightMetadata);
}
async function syncParent(directory: string): Promise<void> {
  const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await parent.sync(); } finally { await parent.close(); }
}

async function migrateAll(
  identity: IdentityService,
  directory: string,
  objectStore: AttachmentObjectStore,
  report: AttachmentStorageMigrationReport,
  apply: boolean,
  removeLocal: boolean,
): Promise<AttachmentGroup[]> {
  const groups = new Map<string, AttachmentGroup>();
  const cleanup: AttachmentGroup[] = [];
  await identity.exclusive(() => identity.store.transaction(async (req: PayloadRequest) => {
    const rows = (await identity.store.payload.find({ collection: "care-attachments", limit: 0, pagination: false, depth: 0, overrideAccess: true, req })).docs as unknown as AttachmentRow[];
    const repository = new RecordsRepository(identity.store.payload);
    for (const row of rows) {
      const value = storedValue(row);
      report.scanned++;
      if (value.storage) report.oss++; else report.legacy++;
      const local = await readVerifiedLocal(directory, value);
      if (local) report.localVerified++; else report.absentLocal++;
      const objectPath = attachmentObjectKey(value.babyId, value.sha256);
      const group = groups.get(objectPath) ?? {
        path: objectPath, file: legacyPath(directory, value), values: [], localPresent: [],
      };
      group.values.push(value); group.localPresent.push(Boolean(local));
      groups.set(objectPath, group);
      if (apply && !value.storage && !local) throw new Error("ATTACHMENT_MIGRATION_LOCAL_MISSING");
    }

    for (const group of groups.values()) {
      const legacyValues = group.values.filter(value => !value.storage);
      const committedValue = group.values.find(value => value.storage);
      let remote: Buffer | undefined;
      if (committedValue) {
        remote = await readVerifiedRemote(objectStore, group.path, committedValue);
      } else if (apply) {
        const source = group.values.find((value, index) => !value.storage && group.localPresent[index]);
        if (!source) throw new Error("ATTACHMENT_MIGRATION_LOCAL_MISSING");
        const local = await readVerifiedLocal(directory, source);
        if (!local) throw new Error("ATTACHMENT_MIGRATION_LOCAL_MISSING");
        await objectStore.put(group.path, local);
        remote = await readVerifiedRemote(objectStore, group.path, source);
        report.remoteUploaded++;
      }
      if (!remote) continue;
      for (const value of group.values) {
        if (remote.byteLength !== value.byteLength || checksum(remote) !== value.sha256) unavailable();
        report.remoteVerified++;
      }

      if (!apply) continue;
      for (const value of legacyValues) {
        const current = await repository.get<StoredAttachment>("care-attachments", value.babyId, value.id, req);
        const storage = { kind: "oss" as const, key: group.path };
        if (current?.storage?.kind === "oss" && current.storage.key === group.path) continue;
        if (!current || !sameMetadataExceptStorage(current, value)) throw new Error("ATTACHMENT_MIGRATION_METADATA_CHANGED");
        await repository.put("care-attachments", value.babyId, value.id, { ...current, storage }, req);
        report.metadataUpdated++;
      }
      if (apply && removeLocal && group.localPresent.every(Boolean)) {
        report.cleanupCandidates += group.values.length;
        cleanup.push(group);
      }
    }
  }));
  return cleanup;
}

async function cleanupVerifiedLocal(
  objectStore: AttachmentObjectStore,
  directory: string,
  groups: AttachmentGroup[],
  report: AttachmentStorageMigrationReport,
): Promise<void> {
  const completedPaths = new Set<string>();
  for (const group of groups) {
    if (completedPaths.has(group.path)) continue;
    completedPaths.add(group.path);
    try {
      const representative = group.values[0];
      if (!representative) throw new Error("ATTACHMENT_MIGRATION_OBJECT_INVALID");
      // Every reference was migrated and verified before commit. Re-verify both sides before unlinking this one shared file.
      await readVerifiedRemote(objectStore, group.path, representative);
      const local = await readVerifiedLocal(directory, representative);
      if (!local) continue;
      await unlink(group.file);
      await syncParent(path.dirname(group.file));
      report.removedLocal++;
    } catch {
      report.cleanupFailed++;
    }
  }
}

/** Runs under the single writer lock. Remote PUT and metadata update are one sidecar transaction; cleanup is strictly after commit. */
export async function migrateAttachmentStorage(identity: IdentityService, directory: string, objectStore: AttachmentObjectStore, options: { apply?: boolean; removeLocal?: boolean } = {}): Promise<AttachmentStorageMigrationReport> {
  const mode = options.apply ? "apply" : "dry-run";
  if (options.removeLocal && !options.apply) throw new Error("ATTACHMENT_MIGRATION_REMOVE_LOCAL_REQUIRES_APPLY");
  const report: AttachmentStorageMigrationReport = { mode, scanned: 0, legacy: 0, oss: 0, localVerified: 0, absentLocal: 0,
    remoteVerified: 0, remoteUploaded: 0, metadataUpdated: 0, cleanupCandidates: 0, removedLocal: 0, cleanupFailed: 0 };
  const cleanup = await migrateAll(identity, directory, objectStore, report, options.apply === true, options.removeLocal === true);
  if (options.removeLocal && options.apply) await cleanupVerifiedLocal(objectStore, directory, cleanup, report);
  return report;
}

async function runCli() {
  const { values } = parseArgs({ options: {
    apply: { type: "boolean" }, "remove-local": { type: "boolean" }, help: { type: "boolean" },
  }, strict: true });
  if (values.help) {
    console.log("Usage: migrate-attachment-storage [--apply] [--remove-local]. Default is a read-only dry run; --remove-local requires --apply.");
    return;
  }
  if (values["remove-local"] && !values.apply) throw new Error("ATTACHMENT_MIGRATION_REMOVE_LOCAL_REQUIRES_APPLY");
  if (process.env.NODE_ENV === "production" && (!process.env.BUBU_IDENTITY_DIRECTORY || !process.env.BUBU_PAYLOAD_SECRET)) throw new Error("ATTACHMENT_MIGRATION_PRODUCTION_CONFIGURATION_REQUIRED");
  const directory = process.env.BUBU_IDENTITY_DIRECTORY || resolveDefaultDirectory();
  const objectStore = configuredAttachmentObjectStore();
  if (!objectStore) throw new Error("ATTACHMENT_MIGRATION_OBJECT_STORE_REQUIRED");
  const releaseLock = acquireRuntimeLock(directory);
  let store;
  try {
    store = await openStore({ directory, secret: process.env.BUBU_PAYLOAD_SECRET, extensions: recordCollections });
    const identity = new IdentityService(store, legacyBackendFromEnv(), new WechatCodeProvider(process.env.BUBU_WECHAT_APP_ID || "", process.env.BUBU_WECHAT_APP_SECRET || ""));
    const report = await migrateAttachmentStorage(identity, directory, objectStore, { apply: values.apply, removeLocal: values["remove-local"] });
    console.log(JSON.stringify(report));
  } finally {
    await store?.close();
    releaseLock();
  }
}
function resolveDefaultDirectory() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.data"); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(() => {
    // Object, database, path and credential errors can contain private values; emit only a stable code.
    console.error("ATTACHMENT_MIGRATION_FAILED");
    process.exitCode = 1;
  });
}
