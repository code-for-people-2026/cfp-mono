import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { openStore, type Store } from "../src/store";
import { IdentityService } from "../src/identity";
import { recordCollections, hash } from "../src/records/persistence";
import { chatCollections } from "../src/chat/persistence";
import { privacyCollections } from "../src/privacy/persistence";
import { PrivacyService } from "../src/privacy/service";
import { DeletionService } from "../src/privacy/deletion";
import { DeletionLedger } from "../src/privacy/deletion-ledger";
import { AttachmentService } from "../src/records/attachments";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";
import { testPrivacyConfig } from "./fixtures/privacy";

describe("confirmed deletion, retries and restoring a snapshot", () => {
  let directory: string, store: Store, identity: IdentityService, privacy: PrivacyService, attachments: AttachmentService, ledger: DeletionLedger, deletion: DeletionService;
  const legacy = new LegacyFixture(); let failRemote = false, remoteCalls = 0;
  let serial = 0;
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bubu-deletion-test-"));
    store = await openStore({ directory: path.join(directory, "data"), extensions: [...recordCollections, ...chatCollections, ...privacyCollections] });
    identity = new IdentityService(store, legacy, new WechatFixture()); ledger = new DeletionLedger(path.join(directory, "ledger", "deletions.ndjson"));
    privacy = new PrivacyService(identity, testPrivacyConfig, ledger); identity.setProcessingGuard((scope, permission) => privacy.guard(scope, permission));
    attachments = new AttachmentService(identity, { directory: path.join(directory, "data") });
    deletion = new DeletionService(privacy, attachments, ledger, { exportFamilyData: async babyId => ({ babyId }), deleteFamilyData: async () => { remoteCalls++; if (failRemote) throw new Error("Synthetic upstream unavailable"); } });
  }, 30000);
  afterAll(async () => { await store?.close(); await rm(directory, { recursive: true, force: true }); });
  async function family() {
    const suffix = ++serial, username = `synthetic-user-${suffix}`, babyId = `synthetic-baby-${suffix}`;
    legacy.users.add(username); legacy.memberships.set(username, [babyId]); legacy.babies.set(babyId, { id: babyId, name: "合成测试" });
    const principal = await identity.authenticate((await identity.loginLegacy(username, "correct-password", "native")).token);
    const policyVersion = privacy.policy().version;
    await privacy.consent(principal, { policyVersion, accepted: true, adultCaregiver: true, sensitive: true, ai: true, images: true });
    await privacy.guardian(principal, babyId, { policyVersion, guardian: true, sensitive: true, ai: true, images: true, collection: false, groupMembersInformed: false });
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    const attachment = await attachments.upload(principal, babyId, bytes, "image/png", `privacy-image-${suffix}`);
    return { principal, babyId, attachment };
  }
  it("requires exact recent confirmation and never grants cross-family rights", async () => {
    const a = await family(), b = await family();
    await expect(deletion.prepare(b.principal, "family", a.babyId)).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
    const intent = await deletion.prepare(a.principal, "family", a.babyId);
    await expect(deletion.confirm(b.principal, intent.token, intent.confirmation)).rejects.toMatchObject({ code: "DELETION_INTENT_INVALID" });
    await expect(deletion.confirm(a.principal, intent.token, "确认")).rejects.toMatchObject({ code: "DELETION_CONFIRMATION_REQUIRED" });
    expect(ledger.read()).toHaveLength(0);
    expect((await attachments.read(a.principal, a.babyId, a.attachment.id)).bytes.length).toBeGreaterThan(0);
  });
  it("freezes before cleanup, retries failures, preserves other families and keeps the ledger outside DB state", async () => {
    const a = await family(), b = await family();
    const intent = await deletion.prepare(a.principal, "family", a.babyId);
    const receipt = await deletion.confirm(a.principal, intent.token, intent.confirmation);
    expect(await deletion.confirm(a.principal, intent.token, intent.confirmation)).toEqual(receipt);
    await expect(attachments.read(a.principal, a.babyId, a.attachment.id)).rejects.toMatchObject({ code: "PRIVACY_PROCESSING_FROZEN" });
    failRemote = true; await deletion.processPending();
    expect((await deletion.jobs(a.principal))[0]?.status).toBe("retry");
    expect(await store.payload.count({ collection: "care-attachments", where: { babyId: { equals: a.babyId } } })).toMatchObject({ totalDocs: 1 });
    failRemote = false; await deletion.processPending();
    expect((await deletion.jobs(a.principal))[0]?.status).toBe("completed");
    expect(await store.payload.count({ collection: "care-attachments", where: { babyId: { equals: a.babyId } } })).toMatchObject({ totalDocs: 0 });
    expect((await attachments.read(b.principal, b.babyId, b.attachment.id)).bytes.length).toBeGreaterThan(0);
    expect(ledger.frozen("family", a.babyId)).toBe(true);
    expect(remoteCalls).toBeGreaterThanOrEqual(2);
    await expect(privacy.guardian(a.principal, a.babyId, { policyVersion: privacy.policy().version, guardian: true, sensitive: true, ai: true, images: true, collection: false, groupMembersInformed: false })).rejects.toMatchObject({ code: "PRIVACY_PROCESSING_FROZEN" });
  });
  it("replays completed deletions after a restored snapshot and removes unreferenced restored objects", async () => {
    const a = await family(), intent = await deletion.prepare(a.principal, "family", a.babyId);
    const saved = await store.payload.findByID({ collection: "care-attachments", id: a.attachment.id });
    const objectPath = path.join(directory, "data", "private-attachments", hash(a.babyId), a.attachment.sha256);
    const ciphertext = await readFile(objectPath);
    await deletion.confirm(a.principal, intent.token, intent.confirmation); await deletion.processPending();
    // Simulate an old DB/media snapshot, including a blob omitted from its attachment rows.
    await store.transaction(req => store.payload.create({ collection: "care-attachments", data: saved, overrideAccess: true, req }));
    await mkdir(path.dirname(objectPath), { recursive: true }); await writeFile(objectPath, ciphertext);
    await writeFile(path.join(path.dirname(objectPath), "f".repeat(64)), Buffer.from("orphan"));
    await expect(attachments.read(a.principal, a.babyId, a.attachment.id)).rejects.toMatchObject({ code: "PRIVACY_PROCESSING_FROZEN" });
    await deletion.replayAfterRestore();
    expect((await store.payload.count({ collection: "care-attachments", where: { babyId: { equals: a.babyId } } })).totalDocs).toBe(0);
    await expect(readFile(objectPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("detects interrupted and modified ledger entries before trusting the deletion state", async () => {
    const file = path.join(directory, "corrupt.ndjson"), local = new DeletionLedger(file);
    local.append({ version: 1, jobId: randomUUID(), kind: "account", identityId: "synthetic", createdAt: new Date().toISOString() });
    const valid = await readFile(file, "utf8");
    await writeFile(file, valid.slice(0, -1)); expect(() => local.read()).toThrow("incomplete");
    await writeFile(file, valid.replace("synthetic", "changed")); expect(() => local.read()).toThrow("integrity");
  });
});
