import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { openStore, type Store } from "../src/store";
import { IdentityService, type Principal } from "../src/identity";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";
import { PrivacyService } from "../src/privacy/service";
import { privacyCollections } from "../src/privacy/persistence";
import { AttachmentService } from "../src/records/attachments";
import { recordCollections, RecordsRepository } from "../src/records/persistence";
import { ImageReviewService, type ImageReviewer, REVIEW_VERSION } from "../src/images/review";
import { testPrivacyConfig } from "./fixtures/privacy";

describe("private photo review uses durable quotas and rechecks authorization after supplier work", () => {
  let directory: string, store: Store, identity: IdentityService, privacy: PrivacyService, alice: Principal, photo: Buffer;
  const reviewer = vi.fn<ImageReviewer>(async () => "allow");
  const service = (review: ImageReviewer | undefined = reviewer, limits?: { family: number; global: number }) => new AttachmentService(identity, { directory, imageReview: new ImageReviewService(privacy, review, limits) });
  const objects = async () => (await readdir(path.join(directory, "private-attachments"), { recursive: true }).catch(() => []));
  const attachRows = () => store.payload.find({ collection: "care-attachments", pagination: false, limit: 0, overrideAccess: true });
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bubu-image-review-"));
    store = await openStore({ directory, extensions: [...recordCollections, ...privacyCollections] });
    identity = new IdentityService(store, new LegacyFixture(), new WechatFixture());
    privacy = new PrivacyService(identity, testPrivacyConfig);
    identity.setProcessingGuard((scope, permission) => privacy.guard(scope, permission));
    photo = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#aaccee" } }).withExif({ IFD0: { Artist: "Synthetic private metadata" } }).png().toBuffer();
  }, 30000);
  beforeEach(async () => {
    reviewer.mockReset().mockResolvedValue("allow");
    await store.transaction(async req => { for (const collection of ["privacy-state", "care-attachments"]) await store.payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true, req }); });
    await rm(path.join(directory, "private-attachments"), { force: true, recursive: true });
    alice = await identity.authenticate((await identity.loginLegacy("old-alice", "correct-password", "native")).token);
    const policyVersion = privacy.policy().version;
    await privacy.consent(alice, { policyVersion, accepted: true, adultCaregiver: true, sensitive: true, ai: true, images: true });
    await privacy.guardian(alice, "baby-a", { policyVersion, guardian: true, sensitive: true, ai: true, images: true, collection: true, groupMembersInformed: true });
  });
  afterAll(async () => { await store?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

  it("reviews normalized pixels once, persists proof privately, and reuses it after a service reconstruction", async () => {
    const first = await service().upload(alice, "baby-a", photo, "image/png", "same");
    expect((await sharp(reviewer.mock.calls[0]![0]).metadata()).exif).toBeUndefined();
    expect(JSON.stringify(first)).not.toContain("review");
    const stored = (await attachRows()).docs[0]!.value;
    expect(stored.review).toMatchObject({ version: REVIEW_VERSION, sha256: first.sha256 });
    expect(await service().upload(alice, "baby-a", photo, "image/png", "same")).toEqual(first);
    expect(reviewer).toHaveBeenCalledTimes(1);
    expect((await service().readForModel(alice, "baby-a", first.id)).bytes).toEqual(reviewer.mock.calls[0]![0]);
  });
  it.each(["block", "uncertain", "unavailable"] as const)("does not store pixels or metadata on %s", async verdict => {
    reviewer.mockResolvedValue(verdict);
    await expect(service().upload(alice, "baby-a", photo, "image/png", verdict)).rejects.toMatchObject({ code: verdict === "unavailable" ? "IMAGE_REVIEW_UNAVAILABLE" : "IMAGE_REVIEW_NOT_ACCEPTED" });
    expect((await attachRows()).docs).toHaveLength(0); expect(await objects()).toEqual([]);
    expect(await privacy.repository.get("privacy-state", "image-review:global")).toMatchObject({ count: 1 });
  });
  it("fails closed without a reviewer and refuses cross-family calls before any supplier work", async () => {
    const unavailable = new AttachmentService(identity, { directory, imageReview: new ImageReviewService(privacy) });
    await expect(unavailable.upload(alice, "baby-a", photo, "image/png", "no-provider")).rejects.toMatchObject({ code: "IMAGE_REVIEW_UNAVAILABLE" });
    await expect(service().upload(alice, "baby-b", photo, "image/png", "wrong-baby")).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
    expect(reviewer).not.toHaveBeenCalled(); expect(await objects()).toEqual([]);
  });
  it("does not block consent withdrawal during a supplier call, then refuses the late allow result", async () => {
    let finish!: (result: "allow") => void, started!: () => void;
    const pending = new Promise<void>(r => { started = r; });
    reviewer.mockImplementation(() => new Promise(r => { finish = r; started(); }));
    const upload = service().upload(alice, "baby-a", photo, "image/png", "withdraw-during-review");
    await pending; await privacy.withdraw(alice); finish("allow");
    await expect(upload).rejects.toMatchObject({ code: "PRIVACY_CONSENT_REQUIRED" });
    expect((await attachRows()).docs).toHaveLength(0); expect(await objects()).toEqual([]);
  });
  it("does not revive a family frozen while a supplier call was in flight", async () => {
    reviewer.mockImplementation(async () => {
      await identity.exclusive(() => privacy.repository.put("privacy-state", "frozen-baby:baby-a", { state: "deleting" }, { babyId: "baby-a" }));
      return "allow";
    });
    await expect(service().upload(alice, "baby-a", photo, "image/png", "freeze-during-review")).rejects.toMatchObject({ code: "PRIVACY_PROCESSING_FROZEN" });
    expect((await attachRows()).docs).toHaveLength(0); expect(await objects()).toEqual([]);
  });
  it("counts failed attempts across new services, rolls back a rejected quota reservation and never resets on clock reversal", async () => {
    reviewer.mockResolvedValue("unavailable");
    await expect(service(reviewer, { family: 1, global: 2 }).upload(alice, "baby-a", photo, "image/png", "budget-one")).rejects.toMatchObject({ code: "IMAGE_REVIEW_UNAVAILABLE" });
    await expect(service(reviewer, { family: 1, global: 2 }).upload(alice, "baby-a", photo, "image/png", "budget-two")).rejects.toMatchObject({ code: "IMAGE_REVIEW_LIMIT" });
    expect(await privacy.repository.get("privacy-state", "image-review:global")).toMatchObject({ count: 1 });
    await identity.exclusive(() => privacy.repository.put("privacy-state", "image-review:global", { day: "2099-01-01", count: 1 }, {}));
    await expect(service().upload(alice, "baby-a", photo, "image/png", "clock-reversed")).rejects.toMatchObject({ code: "IMAGE_REVIEW_UNAVAILABLE" });
    expect(reviewer).toHaveBeenCalledTimes(1);
  });
  it("keeps unreviewed history readable while blocking both model input and delegated agent retrieval", async () => {
    const legacy = new AttachmentService(identity, { directory });
    const image = await legacy.importLegacy("baby-a", { kind: "activity", documentId: "synthetic" }, photo, "image/png");
    expect((await service().read(alice, "baby-a", image.id)).bytes.length).toBeGreaterThan(0);
    await expect(service().readForModel(alice, "baby-a", image.id)).rejects.toMatchObject({ code: "IMAGE_REVIEW_REQUIRED" });
    const agent = await identity.authenticate((await identity.issueAgent(alice, "baby-a", "chat-agent")).token);
    await expect(service().read(agent, "baby-a", image.id)).rejects.toMatchObject({ code: "IMAGE_REVIEW_REQUIRED" });
    expect(reviewer).not.toHaveBeenCalled();
  });
  it("rejects a mismatched proof and a request number reused for different pixels", async () => {
    const image = await service().upload(alice, "baby-a", photo, "image/png", "proof");
    const repository = new RecordsRepository(store.payload);
    await identity.exclusive(() => store.transaction(async req => {
      const row = await repository.get<Record<string, unknown>>("care-attachments", "baby-a", image.id, req);
      await repository.put("care-attachments", "baby-a", image.id, { ...row, review: { version: REVIEW_VERSION, sha256: "wrong", at: new Date().toISOString() } }, req);
    }));
    await expect(service().readForModel(alice, "baby-a", image.id)).rejects.toMatchObject({ code: "IMAGE_REVIEW_REQUIRED" });
    const changed = await sharp(photo).negate().png().toBuffer();
    await expect(service().upload(alice, "baby-a", changed, "image/png", "proof")).rejects.toMatchObject({ code: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });
    expect(reviewer).toHaveBeenCalledTimes(1);
  });
});
