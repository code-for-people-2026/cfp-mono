import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { migrateAttachmentStorage } from "../scripts/migrate-attachment-storage";
import { attachmentObjectKey, AttachmentService } from "../src/records/attachments";
import { hash, recordCollections, RecordsRepository } from "../src/records/persistence";
import type { SourceRef } from "../src/records/types";
import { IdentityService, type Principal } from "../src/identity";
import { openStore, type Store } from "../src/store";
import type { AttachmentObjectStore } from "../src/storage/attachment-objects";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";

class MemoryObjectStore implements AttachmentObjectStore {
  readonly kind = "oss" as const;
  readonly objects = new Map<string, Buffer>();
  puts = 0; gets = 0; removals = 0; failAtGet = Number.POSITIVE_INFINITY;
  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(key, Buffer.from(bytes));
    this.puts++;
  }
  async get(key: string, maxBytes: number): Promise<Buffer> {
    this.gets++;
    if (this.gets >= this.failAtGet) throw new Error("synthetic cleanup verification failure");
    const bytes = this.objects.get(key);
    if (!bytes || bytes.byteLength > maxBytes) throw new Error("synthetic missing object");
    return Buffer.from(bytes);
  }
  async remove(key: string): Promise<void> { this.objects.delete(key); this.removals++; }
  async *list(prefix: string): AsyncIterable<{ key: string; lastModified: number }> {
    for (const [key] of this.objects) if (key.startsWith(prefix)) yield { key, lastModified: 1 };
  }
}

interface StoredAttachment {
  id: string; babyId: string; sha256: string; requestFingerprint: string;
  source?: SourceRef; storage?: { kind: "oss"; key: string };
}

describe("offline attachment storage migration", () => {
  let directory: string, store: Store, identity: IdentityService, attachments: AttachmentService, principal: Principal;
  let photo: Buffer, objects: MemoryObjectStore;
  const legacy = new LegacyFixture(), wechat = new WechatFixture();
  const source: SourceRef = { kind: "manual", accountId: "manual-account", conversationId: "manual-conversation",
    messageId: "message-1", eventKey: "event-1", sentAt: "2026-10-23T08:12:43+08:00", senderId: "sender-1" };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bubu-attachment-migration-"));
    store = await openStore({ directory, extensions: recordCollections });
    identity = new IdentityService(store, legacy, wechat);
    attachments = new AttachmentService(identity, { directory });
    principal = await identity.authenticate((await identity.loginLegacy("old-alice", "correct-password", "native")).token, "bearer");
    photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#6688aa" } }).png().toBuffer();
    objects = new MemoryObjectStore();
  }, 30_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await store.transaction(async req => {
      const rows = await store.payload.find({ collection: "care-attachments", limit: 0, pagination: false, depth: 0, overrideAccess: true, req });
      for (const row of rows.docs as Array<{ id: string }>) await store.payload.delete({ collection: "care-attachments", id: row.id, req });
    });
    await rm(path.join(directory, "private-attachments"), { force: true, recursive: true });
    objects = new MemoryObjectStore();
  });
  afterAll(async () => { await store?.close(); if (directory) await rm(directory, { force: true, recursive: true }); });

  const metadata = (id: string) => store.transaction(req => new RecordsRepository(store.payload)
    .get<StoredAttachment>("care-attachments", "baby-a", id, req));
  const objectFile = (sha256: string) => path.join(directory, "private-attachments", hash("baby-a"), sha256);
  const photoHash = () => createHash("sha256").update(photo).digest("hex");

  it("dry-run verifies legacy local bytes without remote or metadata writes", async () => {
    const uploaded = await attachments.upload(principal, "baby-a", photo, "image/png", "migration-dry-run", source);
    const before = await metadata(uploaded.id);
    const report = await migrateAttachmentStorage(identity, directory, objects);
    expect(report).toMatchObject({ mode: "dry-run", scanned: 1, legacy: 1, oss: 0, localVerified: 1, absentLocal: 0,
      remoteVerified: 0, remoteUploaded: 0, metadataUpdated: 0, removedLocal: 0 });
    expect(objects.puts).toBe(0); expect(objects.objects).toEqual(new Map());
    expect(await metadata(uploaded.id)).toEqual(before);
  });

  it("rejects cleanup requested through the function API without apply", async () => {
    await expect(migrateAttachmentStorage(identity, directory, objects, { removeLocal: true }))
      .rejects.toThrow("ATTACHMENT_MIGRATION_REMOVE_LOCAL_REQUIRES_APPLY");
  });

  it("applies only after a verified remote read-back and preserves identity metadata", async () => {
    const first = await attachments.upload(principal, "baby-a", photo, "image/png", "migration-apply-first", source);
    const second = await attachments.upload(principal, "baby-a", photo, "image/png", "migration-apply-second", source);
    const before = await metadata(second.id), key = attachmentObjectKey("baby-a", second.sha256);
    const beforeFirst = await metadata(first.id);
    const report = await migrateAttachmentStorage(identity, directory, objects, { apply: true });
    expect(report).toMatchObject({ mode: "apply", scanned: 2, legacy: 2, oss: 0, localVerified: 2,
      remoteVerified: 2, remoteUploaded: 1, metadataUpdated: 2, removedLocal: 0 });
    const afterFirst = await metadata(first.id), afterSecond = await metadata(second.id);
    expect(afterFirst).toEqual({ ...beforeFirst, storage: { kind: "oss", key } });
    expect(afterSecond).toEqual({ ...before, storage: { kind: "oss", key } });
    expect(afterSecond?.id).toBe(before?.id);
    expect(afterSecond?.requestFingerprint).toBe(before?.requestFingerprint);
    expect(afterSecond?.source).toEqual(before?.source);
    expect(objects.puts).toBe(1);
    expect(objects.objects.get(key)).toEqual(photo);
    expect((await stat(objectFile(second.sha256))).isFile()).toBe(true);
  });

  it("is idempotent and retains one deterministic object for repeated identical migration runs", async () => {
    await attachments.upload(principal, "baby-a", photo, "image/png", "migration-idempotent-first", source);
    await attachments.upload(principal, "baby-a", photo, "image/png", "migration-idempotent-second", source);
    await migrateAttachmentStorage(identity, directory, objects, { apply: true });
    const objectCount = objects.objects.size;
    const report = await migrateAttachmentStorage(identity, directory, objects, { apply: true });
    expect(report).toMatchObject({ legacy: 0, oss: 2, localVerified: 2, remoteVerified: 2,
      remoteUploaded: 0, metadataUpdated: 0, removedLocal: 0 });
    expect(objects.objects.size).toBe(objectCount); expect(objects.puts).toBe(1);
  });

  it("removes one verified shared local file after every duplicate reference is committed", async () => {
    await attachments.upload(principal, "baby-a", photo, "image/png", "migration-cleanup-first", source);
    await attachments.upload(principal, "baby-a", photo, "image/png", "migration-cleanup-second", source);
    const report = await migrateAttachmentStorage(identity, directory, objects, { apply: true, removeLocal: true });
    expect(report).toMatchObject({ scanned: 2, legacy: 2, cleanupCandidates: 2, removedLocal: 1, cleanupFailed: 0 });
    expect(objects.puts).toBe(1); expect(objects.removals).toBe(0);
    await expect(stat(objectFile(photoHash()))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not remove the last verified local copy when post-commit cleanup verification fails", async () => {
    const uploaded = await attachments.upload(principal, "baby-a", photo, "image/png", "migration-cleanup-check", source);
    await writeFile(objectFile(photoHash()), photo, { mode: 0o600 });
    const file = objectFile(uploaded.sha256);
    objects.failAtGet = objects.gets + 2; // The migration read-back succeeds; the first cleanup GET fails.
    try {
      const report = await migrateAttachmentStorage(identity, directory, objects, { apply: true, removeLocal: true });
      expect(report).toMatchObject({ cleanupCandidates: 1, removedLocal: 0, cleanupFailed: 1 });
      expect((await stat(file)).isFile()).toBe(true);
    } finally {
      objects.failAtGet = Number.POSITIVE_INFINITY;
    }
  });

  it("rolls back metadata and keeps local bytes when the sidecar transaction fails", async () => {
    const uploaded = await attachments.upload(principal, "baby-a", photo, "image/png", "migration-transaction-failure", source);
    const put = vi.spyOn(RecordsRepository.prototype, "put").mockRejectedValueOnce(new Error("synthetic transaction failure"));
    try {
      await expect(migrateAttachmentStorage(identity, directory, objects, { apply: true }))
        .rejects.toThrow("synthetic transaction failure");
    } finally {
      put.mockRestore();
    }
    expect((await metadata(uploaded.id))?.storage).toBeUndefined();
    expect((await stat(objectFile(uploaded.sha256))).isFile()).toBe(true);
  });

  it("rejects an OSS metadata key derived for another baby", async () => {
    const uploaded = await attachments.upload(principal, "baby-a", photo, "image/png", "migration-cross-baby", source);
    const repository = new RecordsRepository(store.payload);
    await store.transaction(async req => {
      const value = await repository.get<StoredAttachment>("care-attachments", "baby-a", uploaded.id, req);
      await repository.put("care-attachments", "baby-a", uploaded.id, {
        ...value, storage: { kind: "oss", key: attachmentObjectKey("baby-b", uploaded.sha256) },
      }, req);
    });
    await expect(migrateAttachmentStorage(identity, directory, objects, { apply: true, removeLocal: true }))
      .rejects.toThrow("ATTACHMENT_MIGRATION_OBJECT_INVALID");
    expect((await stat(objectFile(uploaded.sha256))).isFile()).toBe(true);
  });

  it("fails and rolls back apply when a legacy local source is absent", async () => {
    const uploaded = await attachments.upload(principal, "baby-a", photo, "image/png", "migration-absent-local", source);
    await rm(objectFile(uploaded.sha256), { force: true });
    await expect(migrateAttachmentStorage(identity, directory, objects, { apply: true }))
      .rejects.toThrow("ATTACHMENT_MIGRATION_LOCAL_MISSING");
    expect(objects.puts).toBe(0);
    expect(objects.objects.has(attachmentObjectKey("baby-a", uploaded.sha256))).toBe(false);
    expect((await metadata(uploaded.id))?.storage).toBeUndefined();
  });

  it("treats only ENOENT as an absent local source and fails closed for other local errors", async () => {
    const uploaded = await attachments.upload(principal, "baby-a", photo, "image/png", "migration-local-error", source);
    const file = objectFile(uploaded.sha256);
    await rm(file, { force: true });
    await symlink("/dev/null", file);
    try {
      await expect(migrateAttachmentStorage(identity, directory, objects, { apply: true }))
        .rejects.toMatchObject({ code: "ELOOP" });
      expect((await metadata(uploaded.id))?.storage).toBeUndefined();
    } finally {
      await rm(file, { force: true });
    }
  });
});
