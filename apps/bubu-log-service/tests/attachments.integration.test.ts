import { mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/contracts";
import { AttachmentService, createAttachmentHandler, inspectAttachment } from "../src/records/attachments";
import { hash, recordCollections, RecordsRepository } from "../src/records/persistence";
import type { SourceRef } from "../src/records/types";
import { IdentityService, type Principal } from "../src/identity";
import { openStore, type Store } from "../src/store";
import type { AttachmentObjectStore } from "../src/storage/attachment-objects";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";

class MemoryObjectStore implements AttachmentObjectStore {
  readonly kind = "oss" as const;
  readonly objects = new Map<string, Buffer>();
  puts = 0; gets = 0; removals = 0;
  failPut = false; corruptPut = false; failGet = false;
  getFailure: Error | undefined;
  async put(key: string, bytes: Uint8Array): Promise<void> {
    if (this.failPut) throw new Error("synthetic remote PUT failure");
    this.objects.set(key, this.corruptPut ? Buffer.alloc(bytes.byteLength, 7) : Buffer.from(bytes));
    this.puts++;
  }
  async get(key: string, maxBytes: number): Promise<Buffer> {
    if (this.failGet) throw new Error("synthetic remote GET failure");
    if (this.getFailure) throw this.getFailure;
    const bytes = this.objects.get(key);
    if (!bytes) throw new AppError(503, "ATTACHMENT_OBJECT_MISSING", "synthetic missing object");
    if (bytes.byteLength > maxBytes) throw new AppError(503, "ATTACHMENT_OBJECT_CORRUPT", "synthetic remote oversized object");
    return Buffer.from(bytes);
  }
  async remove(key: string): Promise<void> { this.objects.delete(key); this.removals++; }
  async *list(prefix: string): AsyncIterable<{ key: string; lastModified: number }> {
    for (const [key] of this.objects) if (key.startsWith(prefix)) yield { key, lastModified: 1 };
  }
}

class DeferredObjectStore implements AttachmentObjectStore {
  readonly kind = "oss" as const;
  readonly objects = new Map<string, Buffer>();
  removals = 0;
  private putGate?: Promise<void>;
  private releasePut?: () => void;
  private putStarted?: Promise<void>;
  private resolvePutStarted?: () => void;
  private getGate?: Promise<void>;
  private releaseGet?: () => void;
  private getStarted?: Promise<void>;
  private resolveGetStarted?: () => void;
  private nextPutPauses = false;
  private nextGetPauses = false;
  pauseNextPut() {
    this.nextPutPauses = true;
    let releaseGate!: () => void;
    this.putGate = new Promise(resolve => { releaseGate = resolve; });
    this.releasePut = releaseGate;
    let resolveStarted!: () => void;
    this.putStarted = new Promise(resolve => { resolveStarted = resolve; });
    this.resolvePutStarted = resolveStarted;
  }
  pauseNextGet() {
    this.nextGetPauses = true;
    let releaseGate!: () => void;
    this.getGate = new Promise(resolve => { releaseGate = resolve; });
    this.releaseGet = releaseGate;
    let resolveStarted!: () => void;
    this.getStarted = new Promise(resolve => { resolveStarted = resolve; });
    this.resolveGetStarted = resolveStarted;
  }
  startedPut() {
    if (!this.putStarted) throw new Error("Deferred PUT was not armed");
    return this.putStarted;
  }
  startedGet() {
    if (!this.getStarted) throw new Error("Deferred GET was not armed");
    return this.getStarted;
  }
  finishPut() { const release = this.releasePut; this.releasePut = undefined; release?.(); }
  finishGet() { const release = this.releaseGet; this.releaseGet = undefined; release?.(); }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    if (this.nextPutPauses) {
      this.nextPutPauses = false;
      const gate = this.putGate, resolveStarted = this.resolvePutStarted;
      resolveStarted?.();
      await gate;
    }
    this.objects.set(key, Buffer.from(bytes));
  }
  async get(key: string, maxBytes: number): Promise<Buffer> {
    if (this.nextGetPauses) {
      this.nextGetPauses = false;
      const gate = this.getGate, resolveStarted = this.resolveGetStarted;
      resolveStarted?.();
      await gate;
    }
    const bytes = this.objects.get(key);
    if (!bytes || bytes.byteLength > maxBytes) throw new AppError(503, "ATTACHMENT_OBJECT_MISSING", "synthetic missing object");
    return Buffer.from(bytes);
  }
  async remove(key: string): Promise<void> { this.objects.delete(key); this.removals++; }
  async *list(prefix: string): AsyncIterable<{ key: string; lastModified: number }> {
    for (const [key] of this.objects) if (key.startsWith(prefix)) yield { key, lastModified: 1 };
  }
}

describe("private attachments use the shared durable identity boundary", () => {
  let directory: string, store: Store, identity: IdentityService, attachments: AttachmentService;
  let alice: Principal, bob: Principal, operator: Principal, collectorA: Principal, collectorB: Principal;
  let aliceToken: string, photo: Buffer, otherPhoto: Buffer;
  const legacy = new LegacyFixture(), wechat = new WechatFixture();
  const source = (groupId: string, messageId = "42"): SourceRef => ({ kind: "wechat", accountId: "fixture-account", conversationId: groupId,
    messageId, eventKey: "photo-0", sentAt: "2026-10-23T08:12:43+08:00", senderId: "fixture-sender", groupId });

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bubu-attachments-test-"));
    store = await openStore({ directory, extensions: recordCollections });
    identity = new IdentityService(store, legacy, wechat);
    attachments = new AttachmentService(identity, { directory });
    const login = await identity.loginLegacy("old-alice", "correct-password", "native");
    aliceToken = login.token; alice = await identity.authenticate(aliceToken, "bearer");
    bob = await identity.authenticate((await identity.loginLegacy("old-bob", "correct-password", "native")).token, "bearer");
    operator = await identity.authenticate((await identity.provisionOperator("fixture-operator", "baby-a", 60_000)).token, "bearer");
    await identity.bindGroup(operator, "baby-a", "account:group-a", "fixture-collector-a", true);
    await identity.bindGroup(operator, "baby-a", "account:group-b", "fixture-collector-b", true);
    collectorA = await identity.authenticate((await identity.issueAgent(operator, "baby-a", "collector", { groupId: "account:group-a", agentId: "fixture-collector-a" })).token, "bearer");
    collectorB = await identity.authenticate((await identity.issueAgent(operator, "baby-a", "collector", { groupId: "account:group-b", agentId: "fixture-collector-b" })).token, "bearer");
    photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#77aabb" } }).png().toBuffer();
    otherPhoto = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#cc8899" } }).png().toBuffer();
  }, 30_000);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await store?.close(); if (directory) await rm(directory, { force: true, recursive: true }); });

  it("stores original bytes privately and keeps retries stable across process restart", async () => {
    const first = await attachments.upload(alice, "baby-a", photo, "image/png", "restart-upload");
    const second = await attachments.upload(alice, "baby-a", photo, "image/png", "restart-upload");
    expect(second).toEqual(first);
    expect(first).toMatchObject({ babyId: "baby-a", mime: "image/png", byteLength: photo.length, uploadedBy: { kind: "caregiver", id: alice.subjectId } });
    expect(JSON.stringify(first)).not.toContain(directory);
    expect(first).not.toHaveProperty("actor"); expect(first).not.toHaveProperty("requestFingerprint");
    const objectPath = path.join(directory, "private-attachments", hash("baby-a"), first.sha256);
    expect((await stat(objectPath)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(objectPath))).mode & 0o777).toBe(0o700);
    await store.close();
    store = await openStore({ directory, extensions: recordCollections });
    identity = new IdentityService(store, legacy, wechat); attachments = new AttachmentService(identity, { directory });
    alice = await identity.authenticate(aliceToken, "bearer");
    const read = await attachments.read(alice, "baby-a", first.id);
    expect(read.attachment).toEqual(first); expect(read.bytes).toEqual(photo);
    expect(await attachments.upload(alice, "baby-a", photo, "image/png", "restart-upload")).toEqual(first);
  }, 30_000);

  it("refuses a request number reused for different bytes or provenance", async () => {
    await attachments.upload(alice, "baby-a", photo, "image/png", "same-request");
    await expect(attachments.upload(alice, "baby-a", otherPhoto, "image/png", "same-request")).rejects.toMatchObject({ status: 409, code: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });
    await attachments.upload(collectorA, "baby-a", photo, "image/png", "source-retry", source("account:group-a"));
    await expect(attachments.upload(collectorA, "baby-a", photo, "image/png", "source-retry", source("account:group-a", "43"))).rejects.toMatchObject({ code: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });
  });

  it("lets an exact concurrent retry adopt the first committed winner", async () => {
    const startedAt = Date.now(), firstTime = startedAt, secondTime = startedAt + 60_000;
    const firstIdentity = new IdentityService(store, legacy, wechat, () => firstTime);
    const secondIdentity = new IdentityService(store, legacy, wechat, () => secondTime);
    const first = await firstIdentity.authenticate((await firstIdentity.loginLegacy("old-alice", "correct-password", "native")).token, "bearer");
    const second = await secondIdentity.authenticate((await secondIdentity.loginLegacy("old-alice", "correct-password", "native")).token, "bearer");
    const objects = new DeferredObjectStore();
    const firstUploads = new AttachmentService(firstIdentity, { directory, objectStore: objects });
    const secondUploads = new AttachmentService(secondIdentity, { directory, objectStore: objects });

    objects.pauseNextPut();
    const firstAttempt = firstUploads.upload(first, "baby-a", photo, "image/png", "concurrent-exact-retry");
    await objects.startedPut();
    const winner = await secondUploads.upload(second, "baby-a", photo, "image/png", "concurrent-exact-retry");
    objects.finishPut();
    expect(await firstAttempt).toEqual(winner);
    expect(winner.createdAt).toBe(new Date(secondTime).toISOString());

    const id = `att_${hash(["baby-a", "caregiver", first.subjectId, undefined, undefined, "concurrent-exact-retry"])}`;
    expect(winner.id).toBe(id);
    const rows = await store.transaction(async req => (await new RecordsRepository(store.payload)
      .list<Record<string, unknown>>("care-attachments", "baby-a", req)).filter(row => row.id === id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id, createdAt: new Date(secondTime).toISOString(), actor: { sessionId: second.sessionId },
    });
  }, 30_000);

  it("keeps the concurrent winner when a slower retry changes bytes", async () => {
    const startedAt = Date.now(), firstTime = startedAt, secondTime = startedAt + 1_000;
    const firstIdentity = new IdentityService(store, legacy, wechat, () => firstTime);
    const secondIdentity = new IdentityService(store, legacy, wechat, () => secondTime);
    const first = await firstIdentity.authenticate((await firstIdentity.loginLegacy("old-alice", "correct-password", "native")).token, "bearer");
    const second = await secondIdentity.authenticate((await secondIdentity.loginLegacy("old-alice", "correct-password", "native")).token, "bearer");
    const objects = new DeferredObjectStore();
    const firstUploads = new AttachmentService(firstIdentity, { directory, objectStore: objects });
    const secondUploads = new AttachmentService(secondIdentity, { directory, objectStore: objects });

    objects.pauseNextPut();
    const firstAttempt = firstUploads.upload(first, "baby-a", otherPhoto, "image/png", "concurrent-byte-conflict");
    await objects.startedPut();
    const winner = await secondUploads.upload(second, "baby-a", photo, "image/png", "concurrent-byte-conflict");
    objects.finishPut();
    await expect(firstAttempt).rejects.toMatchObject({ status: 409, code: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });

    const stored = await store.transaction(req => new RecordsRepository(store.payload)
      .get<Record<string, unknown>>("care-attachments", "baby-a", winner.id, req));
    expect(stored).toMatchObject({ id: winner.id, createdAt: new Date(secondTime).toISOString(), actor: { sessionId: second.sessionId } });
  }, 30_000);

  it("keeps the concurrent winner when a slower retry changes provenance", async () => {
    const startedAt = Date.now(), firstTime = startedAt, secondTime = startedAt + 1_000;
    const firstIdentity = new IdentityService(store, legacy, wechat, () => firstTime);
    const secondIdentity = new IdentityService(store, legacy, wechat, () => secondTime);
    const operatorLogin = await firstIdentity.provisionOperator("fixture-operator", "baby-a", 3_600_000);
    const operatorPrincipal = await firstIdentity.authenticate(operatorLogin.token, "bearer");
    const first = await firstIdentity.authenticate((await firstIdentity.issueAgent(operatorPrincipal, "baby-a", "collector", { groupId: "account:group-a", agentId: "fixture-collector-a" })).token, "bearer");
    const second = await secondIdentity.authenticate((await secondIdentity.issueAgent(operatorPrincipal, "baby-a", "collector", { groupId: "account:group-a", agentId: "fixture-collector-a" })).token, "bearer");
    const winnerSource = source("account:group-a", "winner");
    const objects = new DeferredObjectStore();
    const firstUploads = new AttachmentService(firstIdentity, { directory, objectStore: objects });
    const secondUploads = new AttachmentService(secondIdentity, { directory, objectStore: objects });

    objects.pauseNextPut();
    const firstAttempt = firstUploads.upload(first, "baby-a", photo, "image/png", "concurrent-source-conflict", source("account:group-a", "loser"));
    await objects.startedPut();
    const winner = await secondUploads.upload(second, "baby-a", photo, "image/png", "concurrent-source-conflict", winnerSource);
    objects.finishPut();
    await expect(firstAttempt).rejects.toMatchObject({ status: 409, code: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });

    const stored = await store.transaction(req => new RecordsRepository(store.payload)
      .get<Record<string, unknown>>("care-attachments", "baby-a", winner.id, req));
    expect(stored).toMatchObject({ id: winner.id, source: winnerSource, createdAt: new Date(secondTime).toISOString(), actor: { sessionId: second.sessionId } });
  }, 30_000);

  it("recovers a committed upload receipt only with exact provenance and advertises repair metadata", async () => {
    const exact = source("account:group-a");
    const uploaded = await attachments.upload(collectorA, "baby-a", photo, "image/png", "receipt-retry", exact);
    expect(await attachments.recoverUpload(collectorA, "baby-a", "receipt-retry", exact)).toEqual({ state: "verified", attachment: uploaded });
    await expect(attachments.recoverUpload(collectorA, "baby-a", "receipt-retry", source("account:group-a", "43"))).rejects.toMatchObject({ status: 409, code: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });
    await expect(attachments.recoverUpload(collectorA, "baby-a", "receipt-retry", source("account:group-b"))).rejects.toMatchObject({ status: 403, code: "ATTACHMENT_SOURCE_FORBIDDEN" });
    await expect(attachments.recoverUpload(collectorA, "baby-b", "receipt-retry", exact)).rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });
    expect(await attachments.recoverUpload(collectorB, "baby-a", "receipt-retry", source("account:group-b"))).toEqual({ state: "absent" });
    // Alternate bytes cannot bypass the original POST fingerprint check.
    await expect(attachments.upload(collectorA, "baby-a", otherPhoto, "image/png", "receipt-retry", exact)).rejects.toMatchObject({ status: 409, code: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });
    await rm(path.join(directory, "private-attachments", hash("baby-a"), uploaded.sha256), { force: true });
    expect(await attachments.recoverUpload(collectorA, "baby-a", "receipt-retry", exact)).toEqual({
      state: "needsRepair", id: uploaded.id, mime: uploaded.mime, sha256: uploaded.sha256,
      requestFingerprint: hash([uploaded.sha256, uploaded.mime, exact]),
    });
    await expect(attachments.read(alice, "baby-a", uploaded.id)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_OBJECT_MISSING" });
  });

  it("checks the stored baby's ownership for download and association", async () => {
    const uploaded = await attachments.upload(alice, "baby-a", photo, "image/png", "isolation");
    await expect(attachments.read(bob, "baby-a", uploaded.id)).rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });
    await expect(attachments.read(bob, "baby-b", uploaded.id)).rejects.toMatchObject({ status: 404, code: "ATTACHMENT_NOT_FOUND" });
    await expect(identity.executeAuthorized(bob, "baby-b", "records:write", (scope, req) => attachments.validateAttachment(scope, req, uploaded.id))).rejects.toMatchObject({ status: 404, code: "ATTACHMENT_NOT_FOUND" });
    await expect(attachments.upload(bob, "baby-a", photo, "image/png", "forbidden-upload")).rejects.toMatchObject({ status: 403 });
  });

  it("requires a bound collector source and fences cross-group download and association", async () => {
    const uploaded = await attachments.upload(collectorA, "baby-a", photo, "image/png", "collector-photo", source("account:group-a"));
    expect((await attachments.read(collectorA, "baby-a", uploaded.id)).bytes).toEqual(photo);
    expect((await attachments.read(alice, "baby-a", uploaded.id)).bytes).toEqual(photo);
    await expect(attachments.upload(collectorA, "baby-a", photo, "image/png", "no-source")).rejects.toMatchObject({ code: "ATTACHMENT_SOURCE_FORBIDDEN" });
    await expect(attachments.upload(collectorA, "baby-a", photo, "image/png", "wrong-source", source("account:group-b"))).rejects.toMatchObject({ status: 403 });
    await expect(attachments.upload(collectorA, "baby-a", photo, "image/png", "forged-conversation", { ...source("account:group-a"), conversationId: "unrelated-group" })).rejects.toMatchObject({ status: 403, code: "ATTACHMENT_SOURCE_FORBIDDEN" });
    await expect(attachments.upload(alice, "baby-a", photo, "image/png", "spoof-source", source("account:group-a"))).rejects.toMatchObject({ status: 403 });
    await expect(attachments.read(collectorB, "baby-a", uploaded.id)).rejects.toMatchObject({ status: 403, code: "ATTACHMENT_SOURCE_FORBIDDEN" });
    await expect(identity.executeAuthorized(collectorB, "baby-a", "records:write", (scope, req) => attachments.validateAttachment(scope, req, uploaded.id), "account:group-b")).rejects.toMatchObject({ status: 403 });
    await identity.bindGroup(operator, "baby-a", "account:group-a", "fixture-collector-a", false);
    await expect(attachments.read(collectorA, "baby-a", uploaded.id)).rejects.toMatchObject({ status: 403 });
    await identity.bindGroup(operator, "baby-a", "account:group-a", "fixture-collector-a", true);
  });

  it("retains chat delegation audit and checks parent revocation on every read", async () => {
    const login = await identity.loginLegacy("old-alice", "correct-password", "native");
    const parent = await identity.authenticate(login.token, "bearer");
    const chat = await identity.authenticate((await identity.issueAgent(parent, "baby-a", "chat-agent")).token, "bearer");
    const uploaded = await attachments.upload(chat, "baby-a", photo, "image/png", "chat-photo");
    expect(uploaded.uploadedBy).toEqual({ kind: "chat-agent", id: "bubu-chat", onBehalfOf: parent.subjectId });
    await identity.logout(parent);
    await expect(attachments.read(chat, "baby-a", uploaded.id)).rejects.toMatchObject({ status: 401 });
  });

  it("does not publish metadata after a database failure and safely retries the original bytes", async () => {
    const put = vi.spyOn(RecordsRepository.prototype, "put").mockRejectedValueOnce(new Error("synthetic commit failure"));
    await expect(attachments.upload(alice, "baby-a", photo, "image/png", "db-failure")).rejects.toThrow("synthetic commit failure");
    put.mockRestore();
    const uploaded = await attachments.upload(alice, "baby-a", photo, "image/png", "db-failure");
    expect((await attachments.read(alice, "baby-a", uploaded.id)).bytes).toEqual(photo);
    expect((await readdir(path.join(directory, "private-attachments", hash("baby-a")))).some(name => name.startsWith(".upload-"))).toBe(false);
  });

  it("detects object corruption without exposing the path and exact retry repairs the object", async () => {
    const uploaded = await attachments.upload(alice, "baby-a", otherPhoto, "image/png", "corrupted-object");
    await writeFile(path.join(directory, "private-attachments", hash("baby-a"), uploaded.sha256), Buffer.alloc(otherPhoto.length));
    await expect(attachments.read(alice, "baby-a", uploaded.id)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_OBJECT_CORRUPT" });
    await attachments.upload(alice, "baby-a", otherPhoto, "image/png", "corrupted-object");
    expect((await attachments.read(alice, "baby-a", uploaded.id)).bytes).toEqual(otherPhoto);
  });

  it("does not classify a non-ENOENT local object error as repairable", async () => {
    const localFailure = await sharp({ create: { width: 7, height: 7, channels: 3, background: "#516d7a" } }).png().toBuffer();
    const uploaded = await attachments.upload(alice, "baby-a", localFailure, "image/png", "local-io-failure");
    const file = path.join(directory, "private-attachments", hash("baby-a"), uploaded.sha256);
    await rm(file, { force: true });
    await symlink("/dev/null", file);
    try {
      await expect(attachments.read(alice, "baby-a", uploaded.id)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_UNAVAILABLE" });
      await expect(attachments.recoverUpload(alice, "baby-a", "local-io-failure")).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_UNAVAILABLE" });
    } finally {
      await rm(file, { force: true });
    }
  });

  it("decodes actual images, enforces MIME and size, and rejects truncated or active content", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const bytes = await sharp(photo).toFormat(format).toBuffer();
      expect(await inspectAttachment(bytes, `image/${format}`)).toBe(`image/${format}`);
    }
    await expect(inspectAttachment(photo, "image/jpeg")).rejects.toMatchObject({ status: 415 });
    await expect(inspectAttachment(photo.subarray(0, photo.length - 16), "image/png")).rejects.toMatchObject({ status: 415 });
    await expect(inspectAttachment(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'), "image/svg+xml")).rejects.toMatchObject({ status: 415 });
    await expect(inspectAttachment(Buffer.from("<html>not a photograph</html>"), "image/png")).rejects.toMatchObject({ status: 415 });
    const limited = new AttachmentService(identity, { directory, maxBytes: photo.length - 1 });
    await expect(limited.upload(alice, "baby-a", photo, "image/png", "oversize")).rejects.toMatchObject({ status: 413 });
  });

  it("handles raw binary HTTP bodies separately from JSON and returns only private media headers", async () => {
    const handler = createAttachmentHandler(attachments);
    const largePhoto = await sharp(randomBytes(128 * 128 * 3), { raw: { width: 128, height: 128, channels: 3 } }).png().toBuffer();
    expect(largePhoto.length).toBeGreaterThan(16_384);
    const response = await handler(new Request("https://bubu.example/api/app/attachments?babyId=baby-a", {
      method: "POST", body: new Uint8Array(largePhoto), headers: { "Content-Type": "image/png", "X-Bubu-Request-Id": "binary-upload" },
    }), alice);
    expect(response?.status).toBe(200);
    const result = await response!.json() as { data: { url: string } };
    const downloaded = await handler(new Request(`https://bubu.example${result.data.url}`), alice);
    expect(Buffer.from(await downloaded!.arrayBuffer())).toEqual(largePhoto);
    expect(downloaded!.headers.get("cache-control")).toBe("private, no-store");
    expect(downloaded!.headers.get("x-content-type-options")).toBe("nosniff");
    expect(downloaded!.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(downloaded!.headers.get("content-type")).toBe("image/png");
    expect(downloaded!.headers.get("content-length")).toBe(String(largePhoto.length));
    expect(await handler(new Request("https://bubu.example/api/app/not-attachments"), alice)).toBeUndefined();
  });

  it("exposes a strict JSON receipt endpoint without returning pixels", async () => {
    const uploaded = await attachments.upload(alice, "baby-a", photo, "image/png", "http-receipt");
    const handler = createAttachmentHandler(attachments);
    const response = await handler(new Request("https://bubu.example/api/app/attachments/receipt?babyId=baby-a", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: "http-receipt" }),
    }), alice);
    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({ data: { state: "verified", attachment: uploaded } });
    const missing = await handler(new Request("https://bubu.example/api/app/attachments/receipt?babyId=baby-a", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: "missing" }),
    }), alice);
    expect(await missing!.json()).toEqual({ data: { state: "absent" } });
    await expect(handler(new Request("https://bubu.example/api/app/attachments/receipt?babyId=baby-a", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: "http-receipt", extra: true }),
    }), alice)).rejects.toMatchObject({ status: 400, code: "ATTACHMENT_RECEIPT_INVALID" });
    await expect(handler(new Request("https://bubu.example/api/app/attachments/receipt?babyId=baby-a", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "oversized-receipt", padding: "x".repeat(16_384) }),
    }), alice)).rejects.toMatchObject({ status: 413, code: "ATTACHMENT_TOO_LARGE" });
  });

  it("bounds streamed bodies even when Content-Length lies and validates scope/source before persistence", async () => {
    const limited = createAttachmentHandler(new AttachmentService(identity, { directory, maxBytes: photo.length }));
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(photo); controller.enqueue(photo); }, cancel });
    const request = new Request("https://bubu.example/api/app/attachments?babyId=baby-a", {
      method: "POST", body, duplex: "half", headers: { "Content-Type": "image/png", "Content-Length": "1", "X-Bubu-Request-Id": "stream-limit" },
    } as RequestInit & { duplex: string });
    await expect(limited(request, alice)).rejects.toMatchObject({ status: 413 }); expect(cancel).toHaveBeenCalled();
    const handler = createAttachmentHandler(attachments);
    await expect(handler(new Request("https://bubu.example/api/app/attachments?babyId=baby-a", {
      method: "POST", body: new Uint8Array(photo), headers: { "Content-Type": "image/png", "X-Baby-Id": "baby-b" },
    }), alice)).rejects.toMatchObject({ status: 400, code: "SCOPE_MISMATCH" });
    await expect(handler(new Request("https://bubu.example/api/app/attachments?babyId=baby-a", {
      method: "POST", body: new Uint8Array(photo), headers: { "Content-Type": "image/png", "X-Bubu-Source": encodeURIComponent('{"kind":"wechat"}') },
    }), collectorA)).rejects.toMatchObject({ status: 400, code: "ATTACHMENT_SOURCE_INVALID" });
  });

  it("uses OSS for new uploads, keeps the object key private, and repairs exact retries", async () => {
    const objects = new MemoryObjectStore();
    const remote = new AttachmentService(identity, { directory, objectStore: objects });
    const uploaded = await remote.upload(bob, "baby-b", photo, "image/png", "remote-upload");
    const key = `${hash("baby-b")}/${uploaded.sha256}`;
    expect(uploaded).toMatchObject({ babyId: "baby-b", byteLength: photo.length });
    expect(JSON.stringify(uploaded)).not.toContain(key);
    expect(JSON.stringify(uploaded)).not.toContain("storage");
    expect(JSON.stringify(uploaded)).not.toContain("bucket");
    expect(objects.objects.get(key)).toEqual(photo);
    await expect(stat(path.join(directory, "private-attachments", hash("baby-b"), uploaded.sha256))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await remote.read(bob, "baby-b", uploaded.id)).toEqual({ attachment: uploaded, bytes: photo });
    expect(await remote.recoverUpload(bob, "baby-b", "remote-upload")).toEqual({ state: "verified", attachment: uploaded });

    objects.objects.delete(key);
    expect(await remote.recoverUpload(bob, "baby-b", "remote-upload")).toEqual({
      state: "needsRepair", id: uploaded.id, mime: uploaded.mime, sha256: uploaded.sha256,
      requestFingerprint: hash([uploaded.sha256, uploaded.mime, undefined]),
    });
    const retry = await remote.upload(bob, "baby-b", photo, "image/png", "remote-upload");
    expect(retry).toEqual(uploaded);
    expect(objects.puts).toBe(2);
    expect(await remote.read(bob, "baby-b", uploaded.id)).toEqual({ attachment: uploaded, bytes: photo });
  });

  it("commits no metadata when remote PUT or verified read-back fails", async () => {
    const objects = new MemoryObjectStore();
    const remote = new AttachmentService(identity, { directory, objectStore: objects });
    const stored = (requestId: string) => store.transaction(req => new RecordsRepository(store.payload)
      .get<Record<string, unknown>>("care-attachments", "baby-b", `att_${hash(["baby-b", "caregiver", bob.subjectId, undefined, undefined, undefined, requestId])}`, req));
    objects.failPut = true;
    await expect(remote.upload(bob, "baby-b", photo, "image/png", "remote-put-failure")).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_UNAVAILABLE" });
    await expect(stored("remote-put-failure")).resolves.toBeUndefined();
    objects.failPut = false; objects.corruptPut = true;
    await expect(remote.upload(bob, "baby-b", photo, "image/png", "remote-readback-corrupt")).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_UNAVAILABLE" });
    await expect(stored("remote-readback-corrupt")).resolves.toBeUndefined();
  });

  it("lets revocation complete while an OSS PUT is paused and commits nothing afterward", async () => {
    const objects = new DeferredObjectStore();
    const remote = new AttachmentService(identity, { directory, objectStore: objects });
    const exact = source("account:group-a", "paused-put");
    objects.pauseNextPut();
    const attempt = remote.upload(collectorA, "baby-a", photo, "image/png", "paused-put", exact);
    try {
      await objects.startedPut();
      await identity.bindGroup(operator, "baby-a", "account:group-a", "fixture-collector-a", false);
      objects.finishPut();
      await expect(attempt).rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });
    } finally {
      objects.finishPut();
      await identity.bindGroup(operator, "baby-a", "account:group-a", "fixture-collector-a", true);
    }

    const id = `att_${hash(["baby-a", "collector", collectorA.subjectId, undefined, "account:group-a", "paused-put"])}`;
    await expect(store.transaction(req => new RecordsRepository(store.payload).get("care-attachments", "baby-a", id, req))).resolves.toBeUndefined();
    expect([...objects.objects.values()].every(bytes => bytes.equals(photo))).toBe(true);
    expect(objects.removals).toBe(0);
  });

  it("lets revocation complete while OSS reads are paused and returns neither bytes nor repair metadata", async () => {
    const objects = new DeferredObjectStore();
    const remote = new AttachmentService(identity, { directory, objectStore: objects });
    const exact = source("account:group-a", "paused-get");
    const uploaded = await remote.upload(collectorA, "baby-a", photo, "image/png", "paused-get", exact);
    objects.pauseNextGet();
    const readAttempt = remote.read(collectorA, "baby-a", uploaded.id);
    try {
      await objects.startedGet();
      await identity.bindGroup(operator, "baby-a", "account:group-a", "fixture-collector-a", false);
      objects.finishGet();
      await expect(readAttempt).rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });
    } finally {
      objects.finishGet();
      await identity.bindGroup(operator, "baby-a", "account:group-a", "fixture-collector-a", true);
    }

    objects.pauseNextGet();
    const recoverAttempt = remote.recoverUpload(collectorA, "baby-a", "paused-get", exact);
    try {
      await objects.startedGet();
      await identity.bindGroup(operator, "baby-a", "account:group-a", "fixture-collector-a", false);
      objects.finishGet();
      await expect(recoverAttempt).rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });
    } finally {
      objects.finishGet();
      await identity.bindGroup(operator, "baby-a", "account:group-a", "fixture-collector-a", true);
    }
  });

  it("rejects a verified receipt when storage changes while an OSS read is deferred", async () => {
    const objects = new DeferredObjectStore();
    const remote = new AttachmentService(identity, { directory, objectStore: objects });
    const uploaded = await remote.upload(bob, "baby-b", photo, "image/png", "recover-storage-cas");
    objects.pauseNextGet();
    const recoverAttempt = remote.recoverUpload(bob, "baby-b", "recover-storage-cas");
    try {
      await objects.startedGet();
      const objectPath = path.join(directory, "private-attachments", hash("baby-b"), uploaded.sha256);
      await mkdir(path.dirname(objectPath), { recursive: true, mode: 0o700 });
      await writeFile(objectPath, photo);
      await store.transaction(async req => {
        const repository = new RecordsRepository(store.payload);
        const current = await repository.get<Record<string, unknown>>("care-attachments", "baby-b", uploaded.id, req);
        const metadata = { ...current };
        delete metadata.storage;
        await repository.put("care-attachments", "baby-b", uploaded.id, metadata, req);
      });
      objects.finishGet();
      await expect(recoverAttempt).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_UNAVAILABLE" });
    } finally {
      objects.finishGet();
      await recoverAttempt.catch(() => undefined);
    }
  });

  it("distinguishes remote corruption and transient remote unavailability in repair receipts", async () => {
    const objects = new MemoryObjectStore();
    const remote = new AttachmentService(identity, { directory, objectStore: objects, maxBytes: photo.length });
    const uploaded = await remote.upload(bob, "baby-b", photo, "image/png", "remote-storage-errors");
    const key = `${hash("baby-b")}/${uploaded.sha256}`;

    for (const corrupted of [Buffer.alloc(photo.length, 7), Buffer.concat([photo, Buffer.from([7])])]) {
      objects.objects.set(key, corrupted);
      await expect(remote.read(bob, "baby-b", uploaded.id)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_OBJECT_CORRUPT" });
      expect(await remote.recoverUpload(bob, "baby-b", "remote-storage-errors")).toEqual({
        state: "needsRepair", id: uploaded.id, mime: uploaded.mime, sha256: uploaded.sha256,
        requestFingerprint: hash([uploaded.sha256, uploaded.mime, undefined]),
      });
      const repaired = await remote.upload(bob, "baby-b", photo, "image/png", "remote-storage-errors");
      expect(repaired.id).toBe(uploaded.id);
      expect(objects.objects.get(key)).toEqual(photo);
      expect(await remote.recoverUpload(bob, "baby-b", "remote-storage-errors")).toMatchObject({
        state: "verified", attachment: uploaded,
      });
    }

    objects.getFailure = new AppError(503, "ATTACHMENT_STORAGE_UNAVAILABLE", "synthetic transient remote failure");
    await expect(remote.read(bob, "baby-b", uploaded.id)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    await expect(remote.recoverUpload(bob, "baby-b", "remote-storage-errors")).rejects.toMatchObject({
      status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE",
    });

    objects.getFailure = new Error("synthetic unknown remote GET failure");
    await expect(remote.read(bob, "baby-b", uploaded.id)).rejects.toMatchObject({
      status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE",
    });
    await expect(remote.recoverUpload(bob, "baby-b", "remote-storage-errors")).rejects.toMatchObject({
      status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE",
    });
  });

  it("upgrades a legacy exact retry to OSS and never falls back to the local copy", async () => {
    const objects = new MemoryObjectStore();
    const local = new AttachmentService(identity, { directory });
    const uploaded = await local.upload(bob, "baby-b", photo, "image/png", "legacy-upgrade");
    const key = `${hash("baby-b")}/${uploaded.sha256}`;
    const remote = new AttachmentService(identity, { directory, objectStore: objects });
    const upgraded = await remote.upload(bob, "baby-b", photo, "image/png", "legacy-upgrade");
    expect(upgraded.id).toBe(uploaded.id);
    expect(objects.objects.get(key)).toEqual(photo);
    const metadata = await store.transaction(req => new RecordsRepository(store.payload).get<typeof uploaded & { storage?: { kind: string; key: string } }>("care-attachments", "baby-b", uploaded.id, req));
    expect(metadata?.storage).toEqual({ kind: "oss", key });
    objects.failGet = true;
    expect((await stat(path.join(directory, "private-attachments", hash("baby-b"), uploaded.sha256))).isFile()).toBe(true);
    await expect(remote.read(bob, "baby-b", uploaded.id)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
  });

  it("rejects storage metadata whose key belongs to another baby", async () => {
    const objects = new MemoryObjectStore();
    const remote = new AttachmentService(identity, { directory, objectStore: objects });
    const uploaded = await remote.upload(bob, "baby-b", photo, "image/png", "remote-cross-baby");
    const repository = new RecordsRepository(store.payload);
    await store.transaction(async req => {
      const value = await repository.get<Record<string, unknown>>("care-attachments", "baby-b", uploaded.id, req);
      await repository.put("care-attachments", "baby-b", uploaded.id, { ...value, storage: { kind: "oss", key: `${hash("baby-a")}/${uploaded.sha256}` } }, req);
    });
    await expect(remote.read(bob, "baby-b", uploaded.id)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_UNAVAILABLE" });
    await expect(remote.upload(bob, "baby-b", photo, "image/png", "remote-cross-baby")).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_UNAVAILABLE" });
  });
});
