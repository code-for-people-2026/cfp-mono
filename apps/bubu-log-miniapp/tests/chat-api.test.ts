import { describe, expect, it, vi } from "vitest";
import { createBubuApi, type Transport, type TransportRequest } from "../src/api/client";
import { decodePending, decodeTurn, receiptLabels, pendingLabel } from "../src/chat/contracts";
import type { ChatRequest } from "../src/chat/drafts";
const babyId = "baby-1", att = `att_${"a".repeat(64)}`;
const context = { authenticated: true, identityId: "parent-1", legacyLinked: false, hasBaby: true, baby: { id: babyId, name: "小满" }, babies: [{ id: babyId, name: "小满" }] };
const input: ChatRequest = { babyId, requestId: "request-1", text: "刚才换了尿布", attachmentIds: [att], context: { viewedDate: "2026-10-01" } };
function turn(patch: Record<string, unknown> = {}) { return { id: "turn-1", requestId: input.requestId, babyId, conversationId: "conversation-1", createdAt: "2026-10-23T08:00:00Z", updatedAt: "2026-10-23T08:00:00Z", status: "processing", input: { text: input.text, attachmentIds: input.attachmentIds, context: input.context }, assistantText: "", receipts: [], pending: [], refreshRequired: false, ...patch }; }
function setup(transport: Transport, native = true) {
  const values = new Map<string, unknown>();
  const revoked = vi.fn(), expired = vi.fn();
  const api = createBubuApi({ transport, native, origin: "https://bubu.test", authMode: "sidecar", onAccessRevoked: revoked, onSessionExpired: expired,
    storage: { get: key => values.get(key), set: (key, value) => { values.set(key, value); }, remove: key => { values.delete(key); } }, wechatLogin: async () => "login-code" });
  return { api, revoked, expired, values };
}
const loggedIn = { status: 200, data: { token: "test-token", expiresAt: "2030-01-01T00:00:00Z", context } };
describe("chat HTTP boundary", () => {
  it("uses scoped authenticated HTTP, preserves original request data, and never exposes credentials in model input", async () => {
    const calls: TransportRequest[] = [];
    const fixture = setup(async request => {
      if (request.url.endsWith("/wechat")) return loggedIn;
      calls.push(request); expect(request.headers.Authorization).toBe("Bearer test-token");
      if (request.url.includes("/chat/request")) return { status: 200, data: { turn: turn() } };
      if (request.method === "POST") return { status: 200, data: { turn: turn() } };
      return { status: 200, data: { babyId, conversationId: "conversation-1", turns: [turn()], pending: [], pendingCount: 0 } };
    });
    await fixture.api.loginWithWechat(); await fixture.api.getChatHistory(babyId); await fixture.api.sendChat(input); await fixture.api.getChatRequest(babyId, input.requestId);
    expect(JSON.parse(calls[1]!.body!)).toEqual(input); expect(calls[1]!.body).not.toContain("test-token"); expect(calls[1]!.headers["x-baby-id"]).toBe(babyId);
    expect(calls[2]!.url).toContain("requestId=request-1"); expect(calls.every(call => !call.url.includes("mcp"))).toBe(true);
  });
  it("uploads original image bytes and validates a protected same-baby image reference", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
    const fixture = setup(async request => {
      if (request.url.endsWith("/wechat")) return loggedIn;
      expect(request.binary).toBe(bytes); expect(request.body).toBeUndefined();
      expect(request.headers["Content-Type"]).toBe("image/png"); expect(request.headers["X-Bubu-Request-Id"]).toBe("upload-1");
      return { status: 200, data: { data: { id: att, babyId, mime: "image/png", byteLength: 4, url: `/api/app/attachments/${att}?babyId=${babyId}` } } };
    });
    await fixture.api.loginWithWechat(); expect((await fixture.api.uploadAttachment(babyId, "upload-1", bytes, "image/png")).id).toBe(att);
    await expect(fixture.api.uploadAttachment(babyId, "upload-2", bytes, "text/plain")).rejects.toThrow("照片");
  });
  it("invalidates late same-baby replies after a 403 and clears private client state", async () => {
    let resolve: (value: { status: number; data: unknown }) => void = () => {};
    let count = 0;
    const fixture = setup(async request => {
      if (request.url.endsWith("/wechat")) return loggedIn;
      count++;
      if (count === 1) return new Promise(value => { resolve = value; });
      return { status: 403, data: { code: "BABY_FORBIDDEN", error: "已撤权" } };
    });
    await fixture.api.loginWithWechat(); const pending = fixture.api.getChatRequest(babyId, input.requestId);
    await expect(fixture.api.getPending(babyId)).rejects.toMatchObject({ status: 403 });
    resolve({ status: 200, data: { turn: turn() } });
    await expect(pending).rejects.toMatchObject({ status: 403 }); expect(fixture.revoked).toHaveBeenCalledWith(babyId);
  });
  it("rejects a turn for another baby or request and sends no chat requests in legacy mode", async () => {
    const fixture = setup(async () => ({ status: 200, data: { turn: turn({ requestId: "wrong-request" }) } }), false);
    await expect(fixture.api.sendChat(input)).rejects.toThrow("格式");
    expect(() => decodeTurn(turn({ babyId: "wrong-baby" }), babyId)).toThrow("格式");
    const transport = vi.fn();
    const legacy = createBubuApi({ transport, native: false, origin: "", authMode: "legacy", storage: { get: () => undefined, set: () => {}, remove: () => {} } });
    await expect(legacy.sendChat(input)).rejects.toMatchObject({ code: "IDENTITY_NOT_ENABLED" }); expect(transport).not.toHaveBeenCalled();
  });
  it("keeps media pending separate from versioned fields and strips source identities", () => {
    const pending = decodePending({ kind: "media", id: "media-1", babyId, eventIds: ["event-1"], state: "open", source: { sentAt: "2026-10-23T08:00:00Z", accountId: "private-account", groupId: "private-group" }, media: [{ index: 0, kind: "image", state: "unavailable", reason: "not available" }] }, babyId);
    expect(pending.kind).toBe("media"); expect(pending).not.toHaveProperty("questionVersion"); expect(JSON.stringify(pending)).not.toContain("private-");
  });
  it("keeps versioned field questions and uses server natural prompts before fallback", () => {
    const value = { id: "q1", babyId, eventId: "e1", version: 3, eventVersion: 4, fields: ["type"], conflicts: [], duplicateCandidates: [], state: "open", prompt: "这次是亲喂还是奶瓶喂？" };
    const pending = decodePending(value, babyId);
    expect(pending).toMatchObject({ kind: "fields", id: "q1", version: 3, eventVersion: 4 });
    expect(pendingLabel(pending)).toBe(value.prompt);
    expect(pendingLabel(decodePending({ ...value, prompt: undefined, fields: ["milkAmount"] }, babyId))).toBe("宝宝实际喝了多少毫升？");
    expect(() => decodePending({ ...value, version: 0 }, babyId)).toThrow("格式");
  });
  it("never labels unconfirmed projections or conflicts as recorded", () => {
    const labels = receiptLabels(decodeTurn(turn({ status: "needs_recovery", receipts: [{ status: "pending_projection" }, { status: "conflict" }] }), babyId));
    expect(labels).toEqual(["保存尚未确认，待恢复", "信息待核对"]); expect(labels).not.toContain("已记录");
  });
});
