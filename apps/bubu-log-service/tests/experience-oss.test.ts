import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/contracts";
import { IdentityService, type Principal } from "../src/identity";
import { ImageReviewService, REVIEW_VERSION, type ImageReviewer } from "../src/images/review";
import { PrivacyService } from "../src/privacy/service";
import { privacyCollections } from "../src/privacy/persistence";
import { AttachmentService, sanitizeAttachment, createAttachmentHandler } from "../src/records/attachments";
import { hash, recordCollections } from "../src/records/persistence";
import { configuredAttachmentObjectStore, type AttachmentObjectStore } from "../src/storage/attachment-objects";
import type { MediaUploadIntent } from "../src/storage/media-operations";
import { openStore, type Store } from "../src/store";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";
import { testPrivacyConfig } from "./fixtures/privacy";

class MemoryObjectStore implements AttachmentObjectStore {
  readonly kind = "oss";
  readonly objects = new Map<string, Buffer>();
  readonly timestamps = new Map<string, number>();
  remoteError = false;
  putStarted = makeDeferred<void>();
  putGate: Promise<void> | undefined;
  getGate: Promise<void> | undefined;
  getStarted = makeDeferred<void>();
  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.putStarted.resolve();
    await this.putGate;
    if (this.remoteError) throw new AppError(503, "ATTACHMENT_UNAVAILABLE", "synthetic remote unavailable");
    this.objects.set(key, Buffer.from(bytes));
    this.timestamps.set(key, Date.now());
  }
  async get(key: string, maxBytes: number): Promise<Buffer> {
    this.getStarted.resolve();
    await this.getGate;
    if (this.remoteError) throw new AppError(503, "ATTACHMENT_UNAVAILABLE", "synthetic remote unavailable");
    const value = this.objects.get(key);
    if (!value) throw new AppError(503, "ATTACHMENT_OBJECT_MISSING", "synthetic missing");
    if (value.length > maxBytes) throw new AppError(503, "ATTACHMENT_OBJECT_CORRUPT", "synthetic oversize");
    return value;
  }
  async remove(key: string): Promise<void> { this.objects.delete(key); this.timestamps.delete(key); }
  async *list(prefix = ""): AsyncIterableIterator<{ key: string; lastModified: number }> {
    for (const [key, lastModified] of [...this.timestamps].sort(([a], [b]) => a.localeCompare(b))) {
      if (key.startsWith(prefix) && this.objects.has(key)) yield { key, lastModified };
    }
  }
  resetPutGate() { this.putStarted = makeDeferred<void>(); this.putGate = undefined; }
}

function makeDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(result => { resolve = value => { resolve = () => undefined; result(value); }; });
  return { promise, resolve: (value: T | PromiseLike<T>) => resolve(value) };
}

describe("OSS-backed private experience attachments", () => {
  let directory: string, store: Store, identity: IdentityService, privacy: PrivacyService;
  let alice: Principal, bob: Principal;
  const reviewer = vi.fn<ImageReviewer>(async () => "allow");
  const encryptionKey = "1f".repeat(32);
  const legacy = new LegacyFixture(), wechat = new WechatFixture();
  const rows = async (babyId: string) => (await store.payload.find({ collection: "care-attachments", where: { babyId: { equals: babyId } }, pagination: false, limit: 0, depth: 0, overrideAccess: true })).docs;
  const mediaIntents = async (babyId?: string) => (await privacy.repository.list<MediaUploadIntent>("privacy-state")).filter(row => row.key.startsWith("media-upload:") && (!babyId || row.value.babyId === babyId));

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bubu-experience-oss-"));
    store = await openStore({ directory, extensions: [...recordCollections, ...privacyCollections] });
    identity = new IdentityService(store, legacy, wechat);
    privacy = new PrivacyService(identity, testPrivacyConfig);
    identity.setProcessingGuard((scope, permission) => privacy.guard(scope, permission));
    alice = await identity.authenticate((await identity.loginLegacy("old-alice", "correct-password", "native")).token, "bearer");
    bob = await identity.authenticate((await identity.loginLegacy("old-bob", "correct-password", "native")).token, "bearer");
    await privacy.consent(alice, { policyVersion: privacy.policy().version, accepted: true, adultCaregiver: true, sensitive: true, ai: true, images: true });
    await privacy.consent(bob, { policyVersion: privacy.policy().version, accepted: true, adultCaregiver: true, sensitive: true, ai: true, images: true });
  }, 30_000);
  afterAll(async () => { await store?.close(); await rm(directory, { force: true, recursive: true }); }, 30_000);

  async function scope(babyId: string) {
    legacy.babies.set(babyId, { id: babyId, name: babyId, isDefault: false });
    legacy.memberships.set("old-alice", [...new Set([...legacy.memberships.get("old-alice") || [], babyId])]);
    await privacy.guardian(alice, babyId, { policyVersion: privacy.policy().version, guardian: true, sensitive: true, ai: true, images: true, collection: true, groupMembersInformed: true });
    const objects = new MemoryObjectStore();
    const service = new AttachmentService(identity, { directory, encryptionKey, imageReview: new ImageReviewService(privacy, reviewer), objectStore: objects });
    return { babyId, objects, service };
  }

  async function photo(background: string, width = 9, height = 7) {
    return sharp({ create: { width, height, channels: 3, background } }).withExif({ IFD0: { Artist: `synthetic ${background}` } }).png().toBuffer();
  }

  it("rejects production local defaults and keeps test defaults local", () => {
    expect(configuredAttachmentObjectStore({ NODE_ENV: "test" })).toBeUndefined();
    expect(() => configuredAttachmentObjectStore({ NODE_ENV: "production" })).toThrow(AppError);
  });

  it("stores only encrypted normalized pixels in OSS and verifies public reads", async () => {
    const { babyId, objects, service } = await scope("baby-encrypted");
    const bytes = await photo("#5588aa");
    const attachment = await service.upload(alice, babyId, bytes, "image/png", "oss-upload");
    expect(attachment).not.toHaveProperty("storage");
    const stored = (await rows(babyId))[0]!.value as { storage?: { kind: string; key: string }; review?: unknown };
    expect(stored.storage).toEqual({ kind: "oss", key: `${hash(babyId)}/${attachment.sha256}` });
    expect(stored.review).toMatchObject({ version: REVIEW_VERSION, sha256: attachment.sha256 });
    const encrypted = objects.objects.get(stored.storage!.key)!;
    expect(encrypted.subarray(0, 10).toString("latin1")).toBe("BUBUMEDIA1");
    expect(encrypted.includes((await sanitizeAttachment(bytes, "image/png")).bytes)).toBe(false);
    expect(await readdir(path.join(directory, "private-attachments"), { recursive: true }).catch(() => [])).toEqual([]);
    expect((await service.read(alice, babyId, attachment.id)).bytes).toEqual((await sanitizeAttachment(bytes, "image/png")).bytes);
    expect((await service.readForModel(alice, babyId, attachment.id)).bytes).toEqual((await sanitizeAttachment(bytes, "image/png")).bytes);
  }, 30_000);

  it("keeps a failed runtime PUT durably uncertain", async () => {
    const { babyId, objects, service } = await scope("baby-remote-error");
    objects.remoteError = true;
    await expect(service.upload(alice, babyId, await photo("#aa3333"), "image/png", "oss-remote-error")).rejects.toMatchObject({ code: "MEDIA_UPLOAD_UNCERTAIN" });
    expect(await rows(babyId)).toHaveLength(0);
    expect(objects.objects.size).toBe(0);
    const intents = await mediaIntents(babyId);
    expect(intents).toHaveLength(1);
    expect(intents[0]!.value.state).toBe("uncertain");
  }, 30_000);

  it("keeps baby and source authorization before remote work", async () => {
    const { babyId, objects, service } = await scope("baby-auth-before");
    const bytes = await photo("#33aa55");
    const attachment = await service.upload(alice, babyId, bytes, "image/png", "seed");
    await expect(service.read(bob, babyId, attachment.id)).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
    await expect(service.upload(alice, babyId, bytes, "image/png", "caregiver-group-source", { kind: "wechat", groupId: "group-a", accountId: "account", conversationId: "group-a", messageId: "m", eventKey: "e", sentAt: "2026-10-23T08:00:00+08:00", senderId: "s" })).rejects.toMatchObject({ code: "ATTACHMENT_SOURCE_FORBIDDEN" });
    expect(objects.objects.size).toBe(1);
  }, 30_000);

  it("keeps revocation responsive during deferred OSS and returns the final authorization error", async () => {
    const { babyId, objects, service } = await scope("baby-deferred-revoke");
    const bytes = await photo("#7777aa");
    const gate = makeDeferred<void>();
    objects.putGate = gate.promise;
    const deferredUpload = service.upload(alice, babyId, bytes, "image/png", "oss-deferred-revoke");
    await objects.putStarted.promise;
    await privacy.withdraw(alice, babyId);
    gate.resolve();
    await expect(deferredUpload).rejects.toMatchObject({ code: "GUARDIAN_CONSENT_REQUIRED" });
    expect(await rows(babyId)).toHaveLength(0);
    const intent = (await mediaIntents(babyId)).at(-1)!;
    expect(intent.value.state).toBe("completed");
    expect(objects.objects.has(intent.value.objectKey)).toBe(true);
    await expect(service.read(alice, babyId, "att_" + "0".repeat(64))).rejects.toMatchObject({ code: "GUARDIAN_CONSENT_REQUIRED" });
  }, 30_000);

  it("fails readInScope closed instead of doing OSS I/O under the identity queue", async () => {
    const { babyId, service } = await scope("baby-read-lock");
    const attachment = await service.upload(alice, babyId, await photo("#aaaa33"), "image/png", "seed");
    await expect(identity.executeAuthorized(alice, babyId, "media:read", (_scope, req) => service.readInScope({
      actor: { kind: "caregiver", id: alice.subjectId, sessionId: alice.sessionId }, babyId, permissions: ["media:read"],
    }, req, attachment.id))).rejects.toMatchObject({ code: "OSS_REMOTE_IO_IN_LOCK" });
  }, 30_000);

  it("executes online family cleanup and keeps offline migration explicit", async () => {
    const { babyId, objects, service } = await scope("baby-online-lifecycle");
    await service.upload(alice, babyId, await photo("#33aaaa"), "image/png", "seed");
    const prefix = `${hash(babyId)}/`;
    const other = `${hash("baby-other")}/${"9".repeat(64)}`;
    objects.objects.set(other, Buffer.from("other"));
    objects.timestamps.set(other, 1);
    await expect(service.purgeFamilyObjects(babyId)).resolves.toMatchObject({ removed: 1 });
    expect([...objects.objects.keys()].filter(key => key.startsWith(prefix))).toEqual([]);
    expect(objects.objects.has(other)).toBe(true);
    await expect(identity.exclusive(() => identity.store.transaction(req => service.purgeOrphanObjects(req)))).rejects.toMatchObject({ code: "OSS_REMOTE_IO_IN_LOCK" });
    await expect(service.migrateObjects(false)).rejects.toMatchObject({ code: "OSS_LIFECYCLE_PENDING" });
  }, 30_000);

  it("recovers raw-input receipts, serializes exact retries, and repairs only matching bytes", async () => {
    const { babyId, objects, service } = await scope("baby-receipt");
    const raw = await photo("#124567");
    expect(await service.recoverUpload(alice, babyId, "receipt")).toEqual({ state: "absent" });
    const calls = reviewer.mock.calls.length;
    const [first, retry] = await Promise.all([service.upload(alice, babyId, raw, "image/png", "receipt"), service.upload(alice, babyId, raw, "image/png", "receipt")]);
    expect(retry).toEqual(first);
    expect(reviewer.mock.calls.length - calls).toBe(1);
    expect(await rows(babyId)).toHaveLength(1);
    expect(await service.recoverUpload(alice, babyId, "receipt")).toEqual({ state: "verified", attachment: first });
    const metadata = (await rows(babyId))[0]!.value;
    const key = `${hash(babyId)}/${first.sha256}`;
    objects.objects.delete(key);
    const receipt = await service.recoverUpload(alice, babyId, "receipt");
    expect(receipt).toMatchObject({ state: "needsRepair", id: first.id, sha256: first.sha256 });
    if (receipt.state !== "needsRepair") throw new Error("Expected repair receipt");
    expect(receipt.requestFingerprint).not.toEqual(hash([first.sha256, "image/png", undefined]));
    await expect(service.upload(alice, babyId, await photo("#abcdef"), "image/png", "receipt")).rejects.toMatchObject({ code: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });
    expect(await service.upload(alice, babyId, raw, "image/png", "receipt")).toEqual(first);
    expect((await rows(babyId))[0]!.value).toEqual(metadata);
    objects.objects.set(key, Buffer.alloc(service.maxBytes + 1024));
    expect(await service.recoverUpload(alice, babyId, "receipt")).toMatchObject({ state: "needsRepair" });
    objects.remoteError = true;
    await expect(service.recoverUpload(alice, babyId, "receipt")).rejects.toMatchObject({ code: "ATTACHMENT_UNAVAILABLE" });
  });

  it("reauthorizes receipts after remote reads and bounds receipt HTTP bodies", async () => {
    const { babyId, objects, service } = await scope("baby-receipt-revoke");
    await service.upload(alice, babyId, await photo("#555555"), "image/png", "receipt");
    const handler = createAttachmentHandler(service);
    await expect(handler(new Request(`https://example.test/api/app/attachments/receipt?babyId=${babyId}`, { method: "POST", body: "x".repeat(16385) }), alice)).rejects.toMatchObject({ status: 413 });
    objects.getStarted = makeDeferred<void>();
    const gate = makeDeferred<void>(); objects.getGate = gate.promise;
    const pending = service.recoverUpload(alice, babyId, "receipt");
    const assertion = expect(pending).rejects.toMatchObject({ code: "IMAGE_CONSENT_REQUIRED" });
    await objects.getStarted.promise;
    await privacy.guardian(alice, babyId, { policyVersion: privacy.policy().version, guardian: true, sensitive: true, ai: true, images: false, collection: true, groupMembersInformed: true });
    gate.resolve(); await assertion;
  });

  it("migrates verified encrypted local objects unchanged and cleans up only after verification", async () => {
    const base = await scope("baby-migration");
    // This focused migration fixture owns the only metadata rows; earlier assertions used isolated synthetic stores.
    await identity.exclusive(() => store.transaction(async req => {
      const all = await store.payload.find({ collection: "care-attachments", pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
      for (const row of all.docs) if (row.babyId !== base.babyId) await store.payload.delete({ collection: "care-attachments", id: row.id, overrideAccess: true, req });
    }));
    const localService = new AttachmentService(identity, { directory, encryptionKey, imageReview: new ImageReviewService(privacy, reviewer) });
    const bytes = await photo("#aa7733", 5, 4);
    const local = await localService.upload(alice, base.babyId, bytes, "image/png", "oss-migration-source");
    const localPath = path.join(directory, "private-attachments", hash(base.babyId), local.sha256);
    const originalCiphertext = await readFile(localPath);
    const before = (await rows(base.babyId))[0]!.value as Record<string, unknown>;
    const migrationStore = new MemoryObjectStore();
    const migration = new AttachmentService(identity, { directory, encryptionKey, imageReview: new ImageReviewService(privacy, reviewer), objectStore: migrationStore });

    const dryRun = await migration.migrateAttachmentStorage();
    expect(dryRun).toMatchObject({ scanned: 1, alreadyRemote: 0, migrated: 0, removedLocal: 0, applied: false });
    expect(migrationStore.objects.size).toBe(0);
    expect(((await rows(base.babyId))[0]!.value as Record<string, unknown>).storage).toBeUndefined();

    const applied = await migration.migrateAttachmentStorage({ apply: true });
    expect(applied).toMatchObject({ alreadyRemote: 0, migrated: 1, removedLocal: 0 });
    const current = (await rows(base.babyId))[0]!.value as Record<string, unknown>;
    expect(current.id).toBe(before.id);
    expect(current.review).toEqual(before.review);
    expect(current.requestFingerprint).toEqual(before.requestFingerprint);
    expect(current.storage).toEqual({ kind: "oss", key: `${hash(base.babyId)}/${local.sha256}` });
    expect(migrationStore.objects.get(`${hash(base.babyId)}/${local.sha256}`)).toEqual(originalCiphertext);
    expect(await readFile(localPath)).toEqual(originalCiphertext);

    const cleanup = await migration.migrateAttachmentStorage({ apply: true, removeLocal: true });
    expect(cleanup).toMatchObject({ alreadyRemote: 1, migrated: 0, removedLocal: 1 });
    await expect(readFile(localPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await migration.read(alice, base.babyId, local.id)).bytes).toEqual((await sanitizeAttachment(bytes, "image/png")).bytes);
  }, 30_000);
});
