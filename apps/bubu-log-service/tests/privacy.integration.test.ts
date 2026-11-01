import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { openStore } from "../src/store";
import { IdentityService } from "../src/identity";
import { LegacyFixture, WechatFixture } from "./fixtures/identity";
import { PrivacyService } from "../src/privacy/service";
import { privacyCollections } from "../src/privacy/persistence";

import { testPrivacyConfig } from "./fixtures/privacy";
const cleanup: Array<() => Promise<void>> = [];
afterAll(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function createFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "bubu-privacy-test-"));
  const store = await openStore({ directory, extensions: privacyCollections });
  cleanup.push(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const identity = new IdentityService(store, new LegacyFixture(), new WechatFixture());
  const privacy = new PrivacyService(identity, testPrivacyConfig);
  identity.setProcessingGuard((scope, permission) => privacy.guard(scope, permission));
  const alice = await identity.authenticate((await identity.loginLegacy("old-alice", "correct-password", "native")).token);
  const bob = await identity.authenticate((await identity.loginLegacy("old-bob", "correct-password", "native")).token);
  const consent = { policyVersion: privacy.policy().version, accepted: true as const, adultCaregiver: true as const, sensitive: true as const, ai: false, images: false };
  const guardian = { policyVersion: privacy.policy().version, guardian: true as const, sensitive: true as const, ai: false, images: false, collection: false, groupMembersInformed: false };
  return { store, identity, privacy, alice, bob, consent, guardian };
}

let fixture: Awaited<ReturnType<typeof createFixture>>;
beforeAll(async () => { fixture = await createFixture(); });
beforeEach(async () => {
  await fixture.store.transaction(async req => {
    for (const collection of ["privacy-state", "privacy-requests"]) await fixture.store.payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true, req });
  });
});
const setup = async () => fixture;
describe("privacy authorization across real identity and SQLite boundaries", () => {
  it("enforces image choices for operators and AI choices for freshly delegated agents", async () => {
    const f = await setup();
    await f.privacy.consent(f.alice, f.consent); await f.privacy.guardian(f.alice, "baby-a", f.guardian);
    const operator = await f.identity.authenticate((await f.identity.provisionOperator("privacy-ops", "baby-a", 60000)).token);
    await expect(f.identity.authorize(operator, "baby-a", "media:write")).rejects.toMatchObject({ code: "IMAGE_CONSENT_REQUIRED" });
    await expect(f.identity.issueAgent(f.alice, "baby-a", "chat-agent")).rejects.toMatchObject({ code: "AI_CONSENT_REQUIRED" });
    const history = await f.identity.authenticate((await f.identity.issueAgent(f.alice, "baby-a", "chat-agent", { readOnly: true })).token);
    await f.identity.authorize(history, "baby-a", "records:read");
    await expect(f.identity.authorize(history, "baby-a", "records:write")).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
    await f.privacy.consent(f.alice, { ...f.consent, ai: true });
    await expect(f.identity.issueAgent(f.alice, "baby-a", "chat-agent")).rejects.toMatchObject({ code: "AI_CONSENT_REQUIRED" });
    await f.privacy.guardian(f.alice, "baby-a", { ...f.guardian, ai: true });
    const active = await f.identity.authenticate((await f.identity.issueAgent(f.alice, "baby-a", "chat-agent")).token);
    await f.identity.authorize(active, "baby-a", "records:write");
    await expect(f.identity.authorize(active, "baby-a", "media:read")).rejects.toMatchObject({ code: "IMAGE_CONSENT_REQUIRED" });
    await f.privacy.guardian(f.alice, "baby-a", f.guardian);
    await expect(f.identity.authorize(active, "baby-a", "records:write")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(f.identity.issueAgent(f.alice, "baby-a", "chat-agent")).rejects.toMatchObject({ code: "AI_CONSENT_REQUIRED" });
  });

  it("requires independent personal and guardian choices, and cannot grant another baby's scope", async () => {
    const f = await setup();
    await expect(f.identity.authorize(f.alice, "baby-a", "records:read")).rejects.toMatchObject({ code: "GUARDIAN_CONSENT_REQUIRED" });
    await f.privacy.consent(f.alice, f.consent);
    await expect(f.privacy.guardian(f.alice, "baby-b", f.guardian)).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
    await f.privacy.guardian(f.alice, "baby-a", f.guardian);
    expect((await f.identity.authorize(f.alice, "baby-a", "records:read")).babyId).toBe("baby-a");
    await expect(f.privacy.requireModel(f.alice, "baby-a", false)).rejects.toMatchObject({ code: "AI_CONSENT_REQUIRED" });
    await expect(f.identity.authorize(f.alice, "baby-a", "media:write")).rejects.toMatchObject({ code: "IMAGE_CONSENT_REQUIRED" });
    await f.privacy.consent(f.alice, { ...f.consent, ai: true, images: true });
    await expect(f.privacy.requireModel(f.alice, "baby-a", true)).rejects.toMatchObject({ code: "AI_CONSENT_REQUIRED" });
    await f.privacy.guardian(f.alice, "baby-a", { ...f.guardian, ai: true, images: true });
    await f.privacy.requireModel(f.alice, "baby-a", true);
  });
  it("revokes delegated agent credentials and leaves privacy requests accessible after withdrawal", async () => {
    const f = await setup();
    await f.privacy.consent(f.alice, { ...f.consent, ai: true });
    await f.privacy.guardian(f.alice, "baby-a", { ...f.guardian, ai: true });
    const agent = await f.identity.authenticate((await f.identity.issueAgent(f.alice, "baby-a", "chat-agent")).token);
    await f.identity.authorize(agent, "baby-a", "records:write");
    await f.privacy.withdraw(f.alice);
    await expect(f.identity.authorize(agent, "baby-a", "records:write")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(f.identity.authorize(f.alice, "baby-a", "records:read")).rejects.toMatchObject({ code: "PRIVACY_CONSENT_REQUIRED" });
    const receipt = await f.privacy.request(f.alice, { kind: "privacy", message: "申请查看删除范围", babyId: "baby-a" });
    expect((await f.privacy.requests(f.alice))[0]?.id).toBe(receipt.id);
    expect(await f.privacy.requests(f.bob)).toEqual([]);
    expect((await f.privacy.status(f.alice, "baby-a")).consentCurrent).toBe(false);
  });
  it("rejects stale or bundled implicit consent and requires group disclosure before enabling collection", async () => {
    const f = await setup();
    await expect(f.privacy.consent(f.alice, { ...f.consent, accepted: false })).rejects.toBeDefined();
    await expect(f.privacy.consent(f.alice, { ...f.consent, policyVersion: "old" })).rejects.toMatchObject({ code: "PRIVACY_VERSION_CHANGED" });
    await f.privacy.consent(f.alice, f.consent);
    await expect(f.privacy.guardian(f.alice, "baby-a", { ...f.guardian, collection: true })).rejects.toMatchObject({ code: "GROUP_NOTICE_REQUIRED" });
    expect((await f.privacy.status(f.alice, "baby-a")).guardian).toBeNull();
  });
  it("freezes access during deletion while preserving the authenticated data-rights route", async () => {
    const f = await setup();
    await f.privacy.consent(f.alice, f.consent); await f.privacy.guardian(f.alice, "baby-a", f.guardian);
    await f.identity.exclusive(() => f.privacy.repository.put("privacy-state", "frozen-baby:baby-a", { state: "deleting" }, { babyId: "baby-a" }));
    await expect(f.identity.authorize(f.alice, "baby-a", "records:read")).rejects.toMatchObject({ code: "PRIVACY_PROCESSING_FROZEN" });
    expect((await f.privacy.status(f.alice, "baby-a")).guardianCurrent).toBe(true);
    await expect(f.privacy.status(f.bob, "baby-a")).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
  });
});
