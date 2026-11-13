import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/contracts";
import { IdentityService, type Principal } from "../src/identity";
import { ImageReviewService, type ImageReviewer } from "../src/images/review";
import { DeletionLedger } from "../src/privacy/deletion-ledger";
import { DeletionService, type DeletionJob } from "../src/privacy/deletion";
import { PrivacyService } from "../src/privacy/service";
import { privacyCollections } from "../src/privacy/persistence";
import { AttachmentService, sanitizeAttachment } from "../src/records/attachments";
import { chatCollections } from "../src/chat/persistence";
import { hash, recordCollections } from "../src/records/persistence";
import type { AttachmentObjectStore } from "../src/storage/attachment-objects";
import type { MediaUploadIntent } from "../src/storage/media-operations";
import { openStore, type Store } from "../src/store";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";
import { testPrivacyConfig } from "./fixtures/privacy";

class LifecycleObjectStore implements AttachmentObjectStore {
  readonly kind = "oss";
  readonly objects = new Map<string, Buffer>();
  readonly timestamps = new Map<string, number>();
  readonly operations: Array<{ type: "put" | "remove"; key: string }> = [];
  putStarted = makeDeferred<void>();
  putGate: Promise<void> | undefined;
  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.putStarted.resolve();
    await this.putGate;
    this.objects.set(key, Buffer.from(bytes));
    this.timestamps.set(key, Date.now());
    this.operations.push({ type: "put", key });
  }
  async get(key: string, maxBytes: number): Promise<Buffer> {
    const value = this.objects.get(key);
    if (!value || value.length > maxBytes) throw new AppError(404, "ATTACHMENT_OBJECT_MISSING", "synthetic object missing");
    return value;
  }
  async remove(key: string): Promise<void> {
    this.objects.delete(key);
    this.timestamps.delete(key);
    this.operations.push({ type: "remove", key });
  }
  async *list(prefix = ""): AsyncIterableIterator<{ key: string; lastModified: number }> {
    for (const [key, lastModified] of [...this.timestamps].sort(([a], [b]) => a.localeCompare(b))) {
      if (key.startsWith(prefix) && this.objects.has(key)) yield { key, lastModified };
    }
  }
  resetPutGate() { this.putStarted = makeDeferred<void>(); this.putGate = undefined; }
}

function makeDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((result, failure) => { resolve = value => { resolve = () => undefined; result(value); }; reject = reason => { reject = () => undefined; failure(reason); }; });
  return { promise, resolve: (value: T | PromiseLike<T>) => resolve(value), reject: (reason?: unknown) => reject(reason) };
}

describe("OSS experience lifecycle", () => {
  let directory: string, store: Store, identity: IdentityService, privacy: PrivacyService;
  let objectStore: LifecycleObjectStore, attachments: AttachmentService, deletion: DeletionService;
  const reviewer = vi.fn<ImageReviewer>(async () => "allow");
  const encryptionKey = "2e".repeat(32);
  const legacy = new LegacyFixture(), wechat = new WechatFixture();
  let serial = 0;

  const rows = async (babyId: string) => (await store.payload.find({ collection: "care-attachments", where: { babyId: { equals: babyId } }, pagination: false, limit: 0, depth: 0, overrideAccess: true })).docs;
  const intents = async (babyId: string) => (await privacy.repository.list<MediaUploadIntent>("privacy-state")).filter(row => row.key.startsWith("media-upload:") && row.value.babyId === babyId);
  const job = async (id: string) => privacy.repository.get<DeletionJob>("privacy-state", `deletion:${id}`);

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bubu-experience-lifecycle-"));
    store = await openStore({ directory, extensions: [...recordCollections, ...chatCollections, ...privacyCollections] });
    identity = new IdentityService(store, legacy, wechat);
    const ledger = new DeletionLedger(path.join(directory, "deletions.ndjson"));
    privacy = new PrivacyService(identity, testPrivacyConfig, ledger);
    identity.setProcessingGuard((scope, permission) => privacy.guard(scope, permission));
    identity.setLegacyAccountGuard(id => privacy.requireLegacyAccount(id));
    identity.setAccountChangeGuard(id => privacy.requireIdentityChange(id));
    objectStore = new LifecycleObjectStore();
    attachments = new AttachmentService(identity, { directory, encryptionKey, imageReview: new ImageReviewService(privacy, reviewer), objectStore });
    deletion = new DeletionService(privacy, attachments, ledger, { exportFamilyData: async babyId => ({ babyId }), deleteFamilyData: async () => undefined });
  }, 30_000);
  afterAll(async () => { await store?.close(); await rm(directory, { recursive: true, force: true }); }, 30_000);

  async function family(label: string) {
    const suffix = ++serial, username = `lifecycle-user-${suffix}`, babyId = `lifecycle-${label}-${suffix}`;
    legacy.users.add(username);
    legacy.memberships.set(username, [babyId]);
    legacy.babies.set(babyId, { id: babyId, name: babyId, isDefault: false });
    const principal = await identity.authenticate((await identity.loginLegacy(username, "correct-password", "native")).token);
    await privacy.consent(principal, { policyVersion: privacy.policy().version, accepted: true, adultCaregiver: true, sensitive: true, ai: true, images: true });
    await privacy.guardian(principal, babyId, { policyVersion: privacy.policy().version, guardian: true, sensitive: true, ai: true, images: true, collection: true, groupMembersInformed: true });
    return { principal, babyId };
  }

  async function photo(background: string, width = 7, height = 5) {
    const bytes = await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
    return { bytes, normalized: (await sanitizeAttachment(bytes, "image/png")).bytes };
  }

  async function confirm(principal: Principal, kind: "account" | "family", babyId?: string) {
    const intent = await deletion.prepare(principal, kind, babyId);
    return { receipt: await deletion.confirm(principal, intent.token, intent.confirmation), intent };
  }

  it("keeps revocation responsive, rejects late metadata revival, and cleans the exact family prefix", async () => {
    const { principal, babyId } = await family("deferred");
    const image = await photo("#553377");
    const gate = makeDeferred<void>();
    objectStore.resetPutGate();
    objectStore.putGate = gate.promise;
    const upload = attachments.upload(principal, babyId, image.bytes, "image/png", "deferred-revocation");
    await objectStore.putStarted.promise;
    await privacy.withdraw(principal, babyId);
    gate.resolve();
    await expect(upload).rejects.toMatchObject({ code: "GUARDIAN_CONSENT_REQUIRED" });
    expect(await rows(babyId)).toHaveLength(0);
    const intent = (await intents(babyId)).at(-1)!;
    expect(intent.value.state).toBe("completed");
    const target = intent.value.objectKey;
    expect(objectStore.objects.has(target)).toBe(true);
    const retained = path.join(directory, "private-attachments", target);
    await mkdir(path.dirname(retained), { recursive: true });
    await writeFile(retained, objectStore.objects.get(target)!);
    const other = `${hash("lifecycle-other-family")}/${"8".repeat(64)}`;
    objectStore.objects.set(other, Buffer.from("unrelated"));
    objectStore.timestamps.set(other, 1);

    const { receipt } = await confirm(principal, "family", babyId);
    await deletion.processPending();
    expect(await job(receipt.id)).toMatchObject({ status: "completed" });
    expect(objectStore.objects.has(target)).toBe(false);
    expect(objectStore.objects.has(other)).toBe(true);
    await expect(readFile(retained)).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("retries account cleanup of verified uploads whose metadata commit was revoked", async () => {
    const { principal: guardian, babyId } = await family("account-uncommitted");
    const source = await identity.authenticate((await identity.loginWechat(`app:orphan-source-${++serial}:one`)).token);
    await privacy.consent(source, { policyVersion: privacy.policy().version, accepted: true, adultCaregiver: true, sensitive: true, ai: true, images: true });
    const inviter = await identity.authenticate((await identity.provisionOperator(`orphan-inviter-${++serial}`, babyId, 60_000)).token);
    await identity.acceptInvite(source, (await identity.invite(inviter, babyId, "write")).code);
    const image = await photo("#ab1234");
    const gate = makeDeferred<void>();
    objectStore.resetPutGate();
    objectStore.putGate = gate.promise;
    const upload = attachments.upload(source, babyId, image.bytes, "image/png", "account-uncommitted");
    await objectStore.putStarted.promise;
    await privacy.withdraw(guardian, babyId);
    gate.resolve();
    await expect(upload).rejects.toMatchObject({ code: "GUARDIAN_CONSENT_REQUIRED" });
    expect(await rows(babyId)).toHaveLength(0);
    const target = (await intents(babyId)).at(-1)!.value.objectKey;
    expect(objectStore.objects.has(target)).toBe(true);
    const remove = vi.spyOn(objectStore, "remove").mockRejectedValueOnce(new Error("synthetic delete timeout"));
    try {
      const { receipt } = await confirm(source, "account");
      await deletion.processPending();
      expect(await job(receipt.id)).toMatchObject({ status: "retry" });
      expect(objectStore.objects.has(target)).toBe(true);
      await deletion.processPending();
      expect(await job(receipt.id)).toMatchObject({ status: "completed" });
      expect(objectStore.objects.has(target)).toBe(false);
    } finally {
      remove.mockRestore();
      objectStore.resetPutGate();
    }
  }, 30_000);

  it("keeps a timed-out PUT uncertain and deletion retrying", async () => {
    const { principal, babyId } = await family("timeout");
    const image = await photo("#335577");
    const gate = makeDeferred<void>();
    objectStore.resetPutGate();
    objectStore.putGate = gate.promise;
    const upload = attachments.upload(principal, babyId, image.bytes, "image/png", "timed-out");
    await objectStore.putStarted.promise;
    const { receipt } = await confirm(principal, "family", babyId);
    gate.reject(new Error("synthetic provider timeout"));
    await expect(upload).rejects.toMatchObject({ code: "MEDIA_UPLOAD_UNCERTAIN" });
    expect((await intents(babyId)).at(-1)!.value.state).toBe("uncertain");
    await deletion.processPending();
    expect(await job(receipt.id)).toMatchObject({ status: "retry", errorCode: "MEDIA_UPLOAD_UNCERTAIN" });
    await deletion.processPending();
    expect(await job(receipt.id)).toMatchObject({ status: "retry", errorCode: "MEDIA_UPLOAD_UNCERTAIN" });
    objectStore.resetPutGate();
  }, 30_000);

  it("persists account candidates, removes only unreferenced candidates, and retains shared hashes", async () => {
    const { principal: guardian, babyId } = await family("shared");
    const source = await identity.authenticate((await identity.loginWechat(`app:lifecycle-source-${++serial}:one`)).token);
    await privacy.consent(source, { policyVersion: privacy.policy().version, accepted: true, adultCaregiver: true, sensitive: true, ai: true, images: true });
    const inviter = await identity.authenticate((await identity.provisionOperator(`lifecycle-inviter-${++serial}`, babyId, 60_000)).token);
    await identity.acceptInvite(source, (await identity.invite(inviter, babyId, "write")).code);
    const sharedImage = await photo("#445566");
    const privateImage = await photo("#667744");
    const privateAttachment = await attachments.upload(source, babyId, privateImage.bytes, "image/png", "source-private");
    const sharedAttachment = await attachments.upload(guardian, babyId, sharedImage.bytes, "image/png", "guardian-shared");
    const sourceAttachment = await attachments.upload(source, babyId, sharedImage.bytes, "image/png", "source-shared");
    const eventId = randomUUID();
    await identity.exclusive(async () => {
      await store.payload.create({ collection: "care-events", data: { id: eventId, key: eventId, babyId, value: { attachmentIds: [sharedAttachment.id], facts: { type: "NOTE" } } }, overrideAccess: true, req: store.currentRequest() });
    });
    const sharedKey = `${hash(babyId)}/${sharedAttachment.sha256}`;
    const privateKey = `${hash(babyId)}/${privateAttachment.sha256}`;
    const privateLocal = path.join(directory, "private-attachments", privateKey);
    const sharedLocal = path.join(directory, "private-attachments", sharedKey);
    await mkdir(path.dirname(privateLocal), { recursive: true });
    const privateCiphertext = objectStore.objects.get(privateKey)!;
    await writeFile(privateLocal, privateCiphertext);
    await writeFile(sharedLocal, objectStore.objects.get(sharedKey)!);
    const failAccountPurge = vi.spyOn(attachments, "purgeAccountObjects").mockRejectedValueOnce(new Error("synthetic crash before OSS purge"));
    const { receipt } = await confirm(source, "account");
    await deletion.processPending();
    failAccountPurge.mockRestore();
    const retryJob = await job(receipt.id);
    expect(retryJob).toMatchObject({ status: "retry", errorCode: "DELETION_RETRY_REQUIRED" });
    expect(retryJob?.mediaObjectKeys).toEqual([privateKey, sharedKey].sort());
    expect(await rows(babyId)).toHaveLength(1);
    expect(objectStore.objects.has(privateKey)).toBe(true);

    // An invalid restored local entry must not let a successful remote deletion
    // report completion; after repairing the local entry the durable job retries.
    await rm(privateLocal);
    await mkdir(privateLocal);
    await deletion.processPending();
    expect(await job(receipt.id)).toMatchObject({ status: "retry" });
    expect(objectStore.objects.has(privateKey)).toBe(false);
    await rm(privateLocal, { recursive: true });
    await writeFile(privateLocal, privateCiphertext);
    await deletion.processPending();
    expect(await job(receipt.id)).toMatchObject({ status: "completed" });
    const remaining = (await rows(babyId)).map(row => (row.value as { id: string }).id);
    expect(remaining).toEqual(expect.arrayContaining([sharedAttachment.id]));
    expect(remaining).not.toContain(sourceAttachment.id);
    expect(remaining).not.toContain(privateAttachment.id);
    expect(objectStore.objects.has(privateKey)).toBe(false);
    expect(objectStore.objects.has(sharedKey)).toBe(true);
    await expect(readFile(privateLocal)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(sharedLocal)).toEqual(objectStore.objects.get(sharedKey));
    expect((await attachments.read(guardian, babyId, sharedAttachment.id)).bytes).toEqual(sharedImage.normalized);
  }, 30_000);

  it("GC lists remote objects outside the identity transaction and skips new, referenced, and active intents", async () => {
    const { principal, babyId } = await family("gc");
    for (const key of objectStore.objects.keys()) objectStore.timestamps.set(key, Number.MAX_SAFE_INTEGER);
    const oldOrphan = `${hash(babyId)}/${"1".repeat(64)}`;
    const newOrphan = `${hash(babyId)}/${"2".repeat(64)}`;
    const activeKey = `${hash(babyId)}/${"3".repeat(64)}`;
    for (const [key, bytes] of [[oldOrphan, Buffer.from("old")], [newOrphan, Buffer.from("new")], [activeKey, Buffer.from("active")]] as const) {
      objectStore.objects.set(key, bytes);
      objectStore.timestamps.set(key, key === newOrphan ? Date.now() + 2_000 : 1);
    }
    await identity.exclusive(() => store.transaction(req => privacy.repository.put("privacy-state", "media-upload:gc-active", {
      version: 1, operation: "put", babyId, identityId: principal.subjectId,
      actor: { kind: "caregiver", id: principal.subjectId }, attachmentId: "att_" + "3".repeat(64),
      objectKey: activeKey, state: "inflight", processId: "synthetic-active", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } satisfies MediaUploadIntent, { babyId, identityId: principal.subjectId }, req)));

    const image = await photo("#778899");
    const gate = makeDeferred<void>();
    objectStore.resetPutGate();
    objectStore.putGate = gate.promise;
    objectStore.objects.set(`${hash(babyId)}/${createHash("sha256").update(image.normalized).digest("hex")}`, Buffer.from("old copy"));
    objectStore.timestamps.set(`${hash(babyId)}/${createHash("sha256").update(image.normalized).digest("hex")}`, 1);
    const referencedKey = `${hash(babyId)}/${createHash("sha256").update(image.normalized).digest("hex")}`;
    const upload = attachments.upload(principal, babyId, image.bytes, "image/png", "gc-referenced");
    await objectStore.putStarted.promise;
    const gc = attachments.purgeOrphanObjects(undefined, Date.now() + 1_000);
    gate.resolve();
    await Promise.all([upload, gc]);
    expect(objectStore.objects.has(referencedKey)).toBe(true);
    expect(objectStore.objects.has(oldOrphan)).toBe(false);
    expect(objectStore.objects.has(newOrphan)).toBe(true);
    expect(objectStore.objects.has(activeKey)).toBe(true);
    expect(objectStore.operations.filter(item => item.key === referencedKey && item.type === "remove")).toHaveLength(0);
  }, 30_000);

  it("removes retained local orphans in OSS mode while preserving referenced and recent files", async () => {
    const { principal, babyId } = await family("local-gc");
    const image = await photo("#346789");
    const attachment = await attachments.upload(principal, babyId, image.bytes, "image/png", "local-gc-reference");
    const base = path.join(directory, "private-attachments", hash(babyId));
    await mkdir(base, { recursive: true });
    const referenced = path.join(base, attachment.sha256), old = path.join(base, "a".repeat(64)), recent = path.join(base, "b".repeat(64));
    await writeFile(referenced, Buffer.from("retained referenced ciphertext"));
    await writeFile(old, Buffer.from("orphan ciphertext restored from snapshot"));
    await writeFile(recent, Buffer.from("recent ciphertext"));
    await utimes(old, 1, 1);
    await attachments.purgeOrphanObjects(undefined, Date.now() - 1_000);
    await expect(readFile(old)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readFile(referenced)).length).toBeGreaterThan(0);
    expect((await readFile(recent)).length).toBeGreaterThan(0);
    await attachments.purgeRemovedObjects([`${hash(babyId)}/${"b".repeat(64)}`]);
    await expect(readFile(recent)).rejects.toMatchObject({ code: "ENOENT" });
    await attachments.purgeRemovedObjects([`${hash(babyId)}/${"b".repeat(64)}`]);
  }, 30_000);

  it("migrates a mixed local/remote shared-hash group before unlinking its local copy", async () => {
    const { principal, babyId } = await family("mixed");
    await identity.exclusive(() => store.transaction(async req => {
      const all = await store.payload.find({ collection: "care-attachments", pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
      for (const row of all.docs) if (row.babyId !== babyId) await store.payload.delete({ collection: "care-attachments", id: row.id, overrideAccess: true, req });
    }));
    const localService = new AttachmentService(identity, { directory, encryptionKey, imageReview: new ImageReviewService(privacy, reviewer) });
    const image = await photo("#998877", 4, 3);
    const first = await localService.upload(principal, babyId, image.bytes, "image/png", "mixed-first");
    const second = await localService.upload(principal, babyId, image.bytes, "image/png", "mixed-second");
    expect(first.sha256).toBe(second.sha256);
    const localPath = path.join(directory, "private-attachments", hash(babyId), first.sha256);
    const ciphertext = await readFile(localPath);
    const migrationStore = new LifecycleObjectStore();
    const key = `${hash(babyId)}/${first.sha256}`;
    migrationStore.objects.set(key, ciphertext);
    migrationStore.timestamps.set(key, 1);
    await identity.exclusive(() => store.transaction(async req => {
      const row = (await rows(babyId)).find(item => (item.value as { id: string }).id === second.id)!;
      await store.payload.update({ collection: "care-attachments", id: row.id, data: { value: { ...row.value as object, storage: { kind: "oss", key } } }, overrideAccess: true, req });
    }));
    const migration = new AttachmentService(identity, { directory, encryptionKey, imageReview: new ImageReviewService(privacy, reviewer), objectStore: migrationStore });

    const dryRun = await migration.migrateAttachmentStorage();
    expect(dryRun).toMatchObject({ scanned: 2, alreadyRemote: 1, migrated: 0, removedLocal: 0, applied: false });
    expect(await readFile(localPath)).toEqual(ciphertext);
    const applied = await migration.migrateAttachmentStorage({ apply: true });
    expect(applied).toMatchObject({ scanned: 2, alreadyRemote: 1, migrated: 1, removedLocal: 0 });
    expect((await rows(babyId)).map(row => (row.value as { storage?: unknown }).storage)).toEqual([{ kind: "oss", key }, { kind: "oss", key }]);
    expect(await readFile(localPath)).toEqual(ciphertext);
    expect(migrationStore.objects.get(key)).toEqual(ciphertext);

    const cleanup = await migration.migrateAttachmentStorage({ apply: true, removeLocal: true });
    expect(cleanup).toMatchObject({ scanned: 2, alreadyRemote: 2, migrated: 0, removedLocal: 1 });
    expect(migrationStore.objects.get(key)).toEqual(ciphertext);
    await expect(readFile(localPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);
});
