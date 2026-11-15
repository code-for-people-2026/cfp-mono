import { describe, expect, it, vi } from "vitest";
import { createBubuApi, type Transport, type TransportRequest } from "../src/api/client";
import { decodeEventSources, decodeHistory, decodePending, decodeTurn, receiptLabels, pendingLabel } from "../src/chat/contracts";
import type { ChatRequest } from "../src/chat/drafts";
const babyId = "baby-1", att = `att_${"a".repeat(64)}`;
const context = { authenticated: true, identityId: "parent-1", legacyLinked: false, hasBaby: true, baby: { id: babyId, name: "小满" }, babies: [{ id: babyId, name: "小满" }] };
const input: ChatRequest = { babyId, requestId: "request-1", text: "刚才换了尿布", attachmentIds: [att], context: { viewedDate: "2026-10-01" } };
function turn(patch: Record<string, unknown> = {}) { return { id: "turn-1", requestId: input.requestId, babyId, conversationId: "conversation-1", createdAt: "2026-10-23T08:00:00Z", updatedAt: "2026-10-23T08:00:00Z", status: "processing", input: { text: input.text, attachmentIds: input.attachmentIds, context: input.context }, assistantText: "", replyQuestions: [], receipts: [], pending: [], refreshRequired: false, ...patch }; }
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
      return { status: 200, data: { babyId, conversationId: "conversation-1", turns: [turn()], pending: [], pendingCount: 0, replyQuestions: [], automaticMessages: [] } };
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
  it("accepts only safe HTTPS or scoped protected sender avatars", () => {
    const base = { babyId, eventId: "event-1", unavailableCount: 0 };
    const message = { id: "message-1", kind: "wechat", senderId: "internal-wxid", senderName: "小林", sentAt: "2026-10-23T08:00:00Z", text: "原文" };
    expect(decodeEventSources({ ...base, messages: [{ ...message, senderAvatarUrl: "https://images.example.test/avatar.png" }] }, babyId, "event-1").messages[0]?.senderAvatarUrl).toBe("https://images.example.test/avatar.png");
    const protectedUrl = `/api/app/media/activities/avatar-1?babyId=${babyId}`;
    expect(decodeEventSources({ ...base, messages: [{ ...message, senderAvatarUrl: protectedUrl }] }, babyId, "event-1").messages[0]?.senderAvatarUrl).toBe(protectedUrl);
    expect(decodeEventSources({ ...base, messages: [{ ...message, kind: "test", label: "测试记录 · 模拟消息" }] }, babyId, "event-1").messages[0]).toMatchObject({ kind: "test", label: "测试记录 · 模拟消息" });
    expect(() => decodeEventSources({ ...base, messages: [{ ...message, kind: "test" }] }, babyId, "event-1")).toThrow("格式");
    expect(() => decodeEventSources({ ...base, messages: [{ ...message, label: "测试记录 · 模拟消息" }] }, babyId, "event-1")).toThrow("格式");
    for (const senderAvatarUrl of ["javascript:alert(1)", "http://images.example.test/avatar.png", "https://user:pass@images.example.test/avatar.png", "/api/app/media/activities/avatar-1?babyId=other"])
      expect(() => decodeEventSources({ ...base, messages: [{ ...message, senderAvatarUrl }] }, babyId, "event-1")).toThrow("格式");
  });
  it("decodes the persisted baby-shared first-week notice as distinct history", () => {
    const notice = { id: "first-week", timestamp: "2026-11-01T00:00:00Z", text: "宝宝首周规律总结", periodStart: "2026-10-23T00:00:00Z", periodEnd: "2026-10-30T00:00:00Z",
      sampleCounts: { "PUMP.milkAmount": 3 }, actualOptions: { "PUMP.milkAmount": [{ value: 90, supportCount: 3 }] }, suggestions: {}, patternStatement: "已自动整理吸奶奶量", instructions: "可继续聊天调整，也可到设置修改" };
    expect(decodeHistory({ babyId, conversationId: "conversation-1", turns: [], pending: [], pendingCount: 0, replyQuestions: [], automaticMessages: [], firstWeekNotice: notice }, babyId).firstWeekNotice).toEqual(notice);
  });
  it("decodes the service field DTO and restores a submitted form answer for recovery", () => {
    const pending = { kind: "fields", id: "q1", babyId, eventId: "event-1", version: 3, eventVersion: 4, fields: ["milkAmount", "endTime"], conflicts: [], duplicateCandidates: ["candidate-1"], state: "open" as const,
      form: { eventId: "event-1", eventVersion: 4, questionId: "q1", questionVersion: 3, title: "瓶喂", knownSummary: "14:00 开始", controls: [
        { field: "milkAmount", draftKey: "milkAmount", kind: "number", label: "实际喝入奶量", unit: "ml", allowUnknown: true },
        { field: "endTime", draftKey: "endTime", kind: "timestamp", label: "结束时间", allowUnknown: true },
      ], progressControl: { field: "progress", kind: "progress", label: "进行状态", options: [{ label: "已经结束", value: "ended" }] }, conflictMessages: [], duplicateCandidateIds: [] } };
    const formAnswer = { facts: { milkAmount: 0, durationMinutes: 10 }, progress: "ended" };
    const recovered = decodeTurn(turn({
      status: "completed",
      input: { text: "", attachmentIds: [], context: { ...input.context, selectedEventId: "event-1" }, question: { id: "q1", questionVersion: 3, eventVersion: 4 }, formAnswer },
      pending: [pending],
    }), babyId);
    expect(recovered.pending[0]).toMatchObject({ duplicateCandidates: ["candidate-1"], form: { duplicateCandidateIds: [] } });
    expect(recovered.input.formAnswer).toEqual(formAnswer);
    expect(decodeHistory({ babyId, conversationId: "conversation-1", turns: [recovered], pending: [pending], pendingCount: 1, replyQuestions: [] }, babyId).automaticMessages).toEqual([]);
  });
  it("decodes one durable multi-event batch receipt with a combined structured answer and supplement", () => {
    const formBatch = [1, 2].map(index => ({ eventId: `event-${index}`, question: { id: `q${index}`, questionVersion: 1, eventVersion: 4 }, formAnswer: { facts: { burpSuccess: true } } }));
    const combinedBatch = [{ ...formBatch[0]!, text: "还有一点补充" }, formBatch[1]!];
    const recovered = decodeTurn(turn({
      status: "completed", input: { text: "", attachmentIds: [], context: input.context, formBatch: combinedBatch }, batchProgress: { total: 2, completed: 2 },
      receipts: [{ requestId: "record-request", status: "needs_information", retryable: false, events: formBatch.map(item => ({ id: item.eventId, version: 5 })), questions: [] }],
    }), babyId);
    expect(recovered.input.formBatch).toEqual(combinedBatch);
    expect(recovered.receipts).toEqual([{ status: "needs_information", events: [{ id: "event-1", version: 5 }, { id: "event-2", version: 5 }] }]);
    expect(recovered.batchProgress).toEqual({ total: 2, completed: 2 });
  });
  it("keeps versioned field questions and uses server natural prompts before fallback", () => {
    const value = { kind: "fields", id: "q1", babyId, eventId: "e1", version: 3, eventVersion: 4, fields: ["type"], conflicts: [], duplicateCandidates: [], state: "open", prompt: "这次是亲喂还是奶瓶喂？" };
    const pending = decodePending(value, babyId);
    expect(pending).toMatchObject({ kind: "fields", id: "q1", version: 3, eventVersion: 4 });
    expect(pendingLabel(pending)).toBe(value.prompt);
    expect(pendingLabel(decodePending({ ...value, prompt: undefined, fields: ["milkAmount"] }, babyId))).toBe("宝宝实际喝了多少毫升？");
    expect(() => decodePending({ ...value, version: 0 }, babyId)).toThrow("格式");
  });
  it("never labels unconfirmed projections, conflicts, or explicit unknown as asking again", () => {
    const labels = receiptLabels(decodeTurn(turn({ status: "needs_recovery", receipts: [{ status: "pending_projection" }, { status: "conflict" }, { status: "needs_information" }] }), babyId));
    expect(labels).toEqual(["保存尚未确认，待恢复", "信息待核对", "已有内容已保留"]); expect(labels).not.toContain("已记录"); expect(labels).not.toContain("仍待补充");
  });
});
