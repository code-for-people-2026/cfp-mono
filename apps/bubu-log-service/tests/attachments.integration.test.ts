import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AttachmentService, createAttachmentHandler, inspectAttachment } from "../src/records/attachments";
import { hash, recordCollections, RecordsRepository } from "../src/records/persistence";
import type { SourceRef } from "../src/records/types";
import { IdentityService, type Principal } from "../src/identity";
import { openStore, type Store } from "../src/store";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";

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
    photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#77aabb" } }).png({ compressionLevel: 9 }).toBuffer();
    otherPhoto = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#cc8899" } }).png({ compressionLevel: 9 }).toBuffer();
  }, 30_000);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await store?.close(); if (directory) await rm(directory, { force: true, recursive: true }); });

  it("stores normalized pixels privately and keeps retries stable across process restart", async () => {
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
    await expect(attachments.read(alice, "baby-a", uploaded.id)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_UNAVAILABLE" });
    await attachments.upload(alice, "baby-a", otherPhoto, "image/png", "corrupted-object");
    expect((await attachments.read(alice, "baby-a", uploaded.id)).bytes).toEqual(otherPhoto);
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
    const largePhoto = await sharp(randomBytes(128 * 128 * 3), { raw: { width: 128, height: 128, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
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
});
