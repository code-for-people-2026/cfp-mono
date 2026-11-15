import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createRuntime, type BubuRuntime } from "../src/runtime";
import { RecordsLegacyFixture } from "./fixtures/records";
import { WechatFixture } from "./fixtures/identity";
import { testPrivacyConfig } from "./fixtures/privacy";

describe("privacy HTTP integration and independent emergency response", () => {
  let runtime: BubuRuntime, directory: string, token: string;
  const wechat = new WechatFixture(), legacy = new RecordsLegacyFixture(), origin = "http://127.0.0.1:4991";
  async function call(route: string, body?: unknown, auth = token) {
    const response = await runtime.handler(new Request(origin + route, { method: body === undefined ? "GET" : "POST", headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json", "X-Bubu-Client": "native" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bubu-http-privacy-"));
    runtime = await createRuntime({ directory, publicOrigin: origin, opsOrigin: origin, mcpUrl: `${origin}/api/mcp`, legacy, wechat, privacy: testPrivacyConfig, maintenanceWorker: false });
    token = (await runtime.identity.loginLegacy("old-alice", "correct-password", "native")).token;
  }, 30000);
  afterAll(async () => { await runtime?.close(); await rm(directory, { recursive: true, force: true }); });
  it("exposes the policy before login and requires its current version before using WeChat code", async () => {
    const policy = await call("/api/app/privacy/policy", undefined, ""); expect(policy.status).toBe(200);
    expect((await call("/api/identity/wechat", { code: "app:openid:one" }, "")).status).toBe(409);
    expect(wechat.exchanges).toHaveLength(0);
    const logged = await call("/api/identity/wechat", { code: "app:openid:two", noticeVersion: policy.body.version }, "");
    expect(logged.status).toBe(200); expect(logged.body.context.babies).toEqual([]);
    const context = await call("/api/app/auth/context"); expect(context.body.babies).toEqual([]);
  });
  it("requires personal and guardian choices separately, allows policy requests after withdrawal", async () => {
    const policyVersion = runtime.privacy.policy().version;
    expect((await call("/api/app/privacy/consent", { policyVersion, accepted: true, adultCaregiver: true, sensitive: true, ai: false, images: false })).status).toBe(200);
    expect((await call("/api/app/auth/context")).body.babies).toHaveLength(1);
    expect((await call("/api/app/records/snapshot?babyId=baby-a&date=2026-10-24")).body.code).toBe("GUARDIAN_CONSENT_REQUIRED");
    expect((await call("/api/app/privacy/guardian", { babyId: "baby-a", consent: { policyVersion, guardian: true, sensitive: true, ai: false, images: false, collection: false, groupMembersInformed: false } })).status).toBe(200);
    const principal = await runtime.identity.authenticate(token);
    await expect(runtime.attachments.upload(principal, "baby-a", Buffer.from("ignored"), "image/png", "denied-photo")).rejects.toMatchObject({ code: "IMAGE_CONSENT_REQUIRED" });
    const ordinary = { babyId: "baby-a", requestId: "ordinary-ai-off", text: "喝奶了", attachmentIds: [], context: { viewedDate: "2026-10-24" } };
    expect((await call("/api/app/chat", ordinary)).body.code).toBe("AI_CONSENT_REQUIRED");
    const emergency = await call("/api/app/chat", { ...ordinary, requestId: "fixed-safety-reply", text: "宝宝叫不醒了" });
    expect(emergency.status).toBe(200); expect(emergency.body.turn).toMatchObject({ status: "completed", replySource: "safety", receipts: [] }); expect(emergency.body.turn.assistantText).toContain("120");
    expect(legacy.committedWrites).toBe(0);
    expect((await call("/api/app/safety?babyId=baby-a")).body.data).toHaveLength(1);
    expect((await call("/api/identity/agent-credentials", { babyId: "baby-a", kind: "chat-agent" })).body.code).toBe("AI_CONSENT_REQUIRED");
    const notices = (await call("/api/app/safety?babyId=baby-a")).body.data;
    expect((await call("/api/app/safety/acknowledge", { babyId: "baby-b", signalId: notices[0].id })).status).toBe(403);
    expect((await call("/api/app/safety/acknowledge", { babyId: "baby-a", signalId: notices[0].id })).status).toBe(200);
    expect((await call("/api/app/safety?babyId=baby-a")).body.data).toEqual([]);
    // Start an upload body, then finish withdrawal before allowing its mutation body to arrive.
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const input = new Request(origin + "/api/app/user-babies/baby-a?babyId=baby-a", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Bubu-Client": "native" }, body: JSON.stringify({ name: "must-not-write", fullName: null }) });
    const originalText = input.text.bind(input);
    vi.spyOn(input, "text").mockImplementation(async () => { await blocked; return originalText(); });
    const update = vi.spyOn(legacy, "updateBabyNames"), delayed = runtime.handler(input);
    expect((await call("/api/app/privacy/withdraw", {})).status).toBe(200);
    release(); const denied = await delayed;
    expect(denied.status).toBe(403); expect(update).not.toHaveBeenCalled(); update.mockRestore();
    expect((await call("/api/app/records/snapshot?babyId=baby-a&date=2026-10-24")).body.code).toBe("PRIVACY_CONSENT_REQUIRED");
    expect((await call("/api/app/privacy/requests", { kind: "privacy", message: "合成数据导出请求" })).status).toBe(201);
    expect((await call("/api/app/privacy/requests")).body.data).toHaveLength(1);
    expect((await call("/api/app/auth/context")).body.babies).toEqual([]);
  });
  it("keeps actual runtime image upload closed without supplier credentials after valid image consent", async () => {
    const policyVersion = runtime.privacy.policy().version;
    await call("/api/app/privacy/consent", { policyVersion, accepted: true, adultCaregiver: true, sensitive: true, ai: true, images: true });
    await call("/api/app/privacy/guardian", { babyId: "baby-a", consent: { policyVersion, guardian: true, sensitive: true, ai: true, images: true, collection: false, groupMembersInformed: false } });
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#aaccff" } }).png().toBuffer();
    const response = await runtime.handler(new Request(origin + "/api/app/attachments?babyId=baby-a", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png", "X-Bubu-Client": "native", "X-Bubu-Request-Id": "real-runtime-unconfigured" }, body: new Uint8Array(bytes) }));
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "IMAGE_REVIEW_UNAVAILABLE" });
    expect((await runtime.store.payload.find({ collection: "care-attachments", overrideAccess: true })).totalDocs).toBe(0);
  });
});
