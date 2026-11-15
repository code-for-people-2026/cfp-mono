import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatDraftStore, type ChatRequest } from "../src/chat/drafts";
import { ChatSession } from "../src/chat/session";
import type { ChatHistory, ChatTurn, ChatPending } from "../src/chat/contracts";
import { ApiError } from "../src/api/client";
const babyId = "baby-1", identityId = "parent-1";
const time = "2026-10-23T08:00:00Z";
function turn(input: ChatRequest, patch: Partial<ChatTurn> = {}): ChatTurn {
  return { id: "turn-1", requestId: input.requestId, babyId, createdAt: time, updatedAt: time, status: "completed", input, assistantText: "已保存已有内容", receipts: [{ status: "needs_information" }], pending: [], refreshRequired: true, ...patch };
}
function fixture() {
  const values = new Map<string, unknown>();
  const store = new ChatDraftStore({ get: key => values.get(key), set: (key, value) => { values.set(key, JSON.parse(JSON.stringify(value))); }, remove: key => { values.delete(key); } }, "same-origin");
  const api = { getChatHistory: vi.fn(async (): Promise<ChatHistory> => ({ babyId, conversationId: "conversation", turns: [], pending: [], pendingCount: 0 })), getPending: vi.fn(async (): Promise<ChatPending[]> => []), getChatRequest: vi.fn(async (_baby: string, _request: string): Promise<ChatTurn | null> => null), sendChat: vi.fn(async (input: ChatRequest) => turn(input)) };
  const callbacks = { refresh: vi.fn(), revoked: vi.fn() };
  const session = new ChatSession(api, store, identityId, babyId, callbacks);
  return { values, store, api, callbacks, session };
}
afterEach(() => { vi.useRealTimers(); });
describe("recoverable baby conversation", () => {
  it("persists draft and question versions across collapse/restart, isolated by identity and baby", () => {
    const { store, session } = fixture();
    session.edit({ text: "剩下30毫升", attachmentIds: [`att_${"a".repeat(64)}`], question: { id: "q1", questionVersion: 3, eventVersion: 5 } });
    expect(store.read(identityId, babyId).text).toBe("剩下30毫升");
    expect(store.read("other-parent", babyId).text).toBe(""); expect(store.read(identityId, "other-baby").text).toBe("");
    session.dispose(); expect(store.read(identityId, babyId).question).toEqual({ id: "q1", questionVersion: 3, eventVersion: 5 });
    store.reconcile(identityId, ["other-baby"]); expect(store.read(identityId, babyId).text).toBe("");
  });
  it("keeps oversized voice drafts editable after restart without sending or truncating", async () => {
    const { store, session, api } = fixture(); await session.load();
    session.edit({ text: "字".repeat(6500) }); await session.send("2026-10-01");
    expect(store.read(identityId, babyId).text.length).toBe(6500); expect(api.sendChat).not.toHaveBeenCalled(); session.dispose();
  });
  it("persists the original request before POST, queries it before retry, and never uses viewed date as event time", async () => {
    const { store, session, api, callbacks } = fixture(); await session.load();
    session.edit({ text: "刚才喝了奶", selectedEventId: "event-1" });
    api.sendChat.mockImplementationOnce(async input => { expect(store.read(identityId, babyId).pending).toEqual(input); throw new Error("断网"); });
    await session.send("2026-10-01");
    const original = store.read(identityId, babyId).pending!;
    expect(original.context).toEqual({ viewedDate: "2026-10-01", selectedEventId: "event-1" }); expect(original).not.toHaveProperty("occurredAt");
    const calls: string[] = [];
    api.getChatRequest.mockImplementation(async (_baby, id) => { calls.push("get"); expect(id).toBe(original.requestId); return null; });
    api.sendChat.mockImplementation(async input => { calls.push("post"); expect(input).toEqual(original); return turn(input); });
    await session.recover();
    expect(calls).toEqual(["get", "post"]); expect(callbacks.refresh).toHaveBeenCalledOnce(); expect(store.read(identityId, babyId).pending).toBeUndefined(); expect(store.read(identityId, babyId).text).toBe(""); session.dispose();
  });
  it("recovers a lost success response without POSTing again", async () => {
    const { store, session, api } = fixture(); await session.load(); session.edit({ text: "换了尿布" });
    api.sendChat.mockRejectedValueOnce(new Error("response lost")); await session.send("2026-10-23");
    const original = store.read(identityId, babyId).pending!; session.dispose();
    api.getChatRequest.mockResolvedValue(turn(original));
    const resumed = new ChatSession(api, store, identityId, babyId, { refresh: vi.fn(), revoked: vi.fn() });
    await resumed.recover(); expect(api.sendChat).toHaveBeenCalledOnce(); expect(resumed.getSnapshot().draft.pending).toBeUndefined(); resumed.dispose();
  });
  it("keeps a paused service request and resumes the identical submission after service is restored", async () => {
    const { store, session, api, callbacks } = fixture(); await session.load();
    session.edit({ text: "刚才换了尿布", question: { id: "q1", questionVersion: 2, eventVersion: 3 } });
    api.sendChat.mockRejectedValueOnce(new ApiError(423, "服务已暂停，恢复后可继续。", "SERVICE_PAUSED"));
    await session.send("2026-10-23");
    const original = store.read(identityId, babyId).pending!;
    expect(session.getSnapshot().error).toBe("服务已暂停，恢复后可继续。");
    expect(session.getSnapshot().draft.text).toBe("刚才换了尿布");
    expect(callbacks.revoked).not.toHaveBeenCalled(); session.dispose();
    const resumed = new ChatSession(api, store, identityId, babyId, callbacks);
    await resumed.recover();
    expect(api.getChatRequest).toHaveBeenCalledWith(babyId, original.requestId);
    expect(api.sendChat.mock.calls.map(call => call[0])).toEqual([original, original]);
    expect(store.read(identityId, babyId).pending).toBeUndefined(); resumed.dispose();
  });
  it("polls processing, preserves immutable request and does not duplicate generation", async () => {
    vi.useFakeTimers(); const { session, api, store } = fixture(); await session.load(); session.edit({ text: "睡着了" });
    api.sendChat.mockImplementation(async input => turn(input, { status: "processing", refreshRequired: false, receipts: [] }));
    await session.send("2026-10-23"); const original = store.read(identityId, babyId).pending!;
    session.edit({ text: "不能覆盖待确认请求" }); expect(session.getSnapshot().draft.text).toBe("睡着了");
    api.getChatRequest.mockResolvedValue(turn(original)); await vi.advanceTimersByTimeAsync(1800);
    expect(api.sendChat).toHaveBeenCalledOnce(); expect(session.getSnapshot().busy).toBe(false); expect(session.getSnapshot().draft.pending).toBeUndefined(); session.dispose();
  });
  it("disposal and revoked access prevent delayed responses restoring private state", async () => {
    const { session, api, store, callbacks } = fixture(); await session.load(); session.edit({ text: "private draft" });
    api.sendChat.mockRejectedValueOnce(new ApiError(403, "revoked")); await session.send("2026-10-23");
    expect(store.read(identityId, babyId).text).toBe(""); expect(callbacks.revoked).toHaveBeenCalledOnce();
    session.edit({ text: "late" }); expect(store.read(identityId, babyId).text).toBe("");
  });
  it("keeps field question versions and media context on their separate server routes", async () => {
    const { session, api } = fixture(); await session.load();
    session.selectTarget({ selectedEventId: "event-1", question: { id: "q1", questionVersion: 2, eventVersion: 3 } }); session.edit({ text: "不知道" });
    await session.send("2026-10-23"); expect(api.sendChat.mock.calls[0]![0].question).toEqual({ id: "q1", questionVersion: 2, eventVersion: 3 });
    session.selectTarget({ mediaPendingId: "media-1", selectedEventId: "event-1" }); session.edit({ text: "找不到照片了" });
    await session.send("2026-10-23"); expect(api.sendChat.mock.calls[1]![0].question).toBeUndefined(); expect(api.sendChat.mock.calls[1]![0].context.mediaPendingId).toBe("media-1"); session.dispose();
  });
  it("does not write a late successful response into a disposed baby's draft", async () => {
    const { session, api, callbacks, store } = fixture(); await session.load(); session.edit({ text: "私有内容" });
    let finish: (turn: ChatTurn) => void = () => {};
    api.sendChat.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const sending = session.send("2026-10-23"); const pending = store.read(identityId, babyId).pending!;
    session.dispose(); store.clearBaby(babyId); finish(turn(pending)); await sending;
    expect(store.read(identityId, babyId).text).toBe(""); expect(callbacks.refresh).not.toHaveBeenCalled();
  });
  it("restores a blocking server turn when local pending is lost, without clearing a separate draft", async () => {
    const { session, api, store } = fixture(); session.edit({ text: "下一条还没发送的内容", selectedEventId: "next-event" });
    const original: ChatRequest = { babyId, requestId: "server-old-request", text: "刚才换尿布", attachmentIds: [], context: { viewedDate: "2026-10-22" } };
    api.getChatHistory.mockResolvedValue({ babyId, conversationId: "conversation", pendingCount: 0, pending: [], turns: [turn(original, { status: "needs_recovery", refreshRequired: false })] });
    await session.load(); expect(store.read(identityId, babyId).pending).toEqual(original);
    expect(session.getSnapshot().draft.text).toBe("下一条还没发送的内容");
    api.getChatRequest.mockResolvedValue(turn(original, { status: "needs_recovery", refreshRequired: false }));
    await session.recover(); expect(api.sendChat).toHaveBeenCalledWith(original);
    expect(session.getSnapshot().draft.text).toBe("下一条还没发送的内容"); expect(session.getSnapshot().draft.selectedEventId).toBe("next-event");
    expect(store.read(identityId, babyId).pending).toBeUndefined(); session.dispose();
  });
  it("offers a retryable historical failure with its original request after local storage is lost", async () => {
    const { session, api } = fixture();
    const original: ChatRequest = { babyId, requestId: "server-failed-request", text: "旧失败消息", attachmentIds: [], context: { viewedDate: "2026-10-22" }, question: { id: "q1", questionVersion: 2, eventVersion: 4 } };
    const failed = turn(original, { status: "failed", refreshRequired: false, error: { code: "PROVIDER_UNAVAILABLE", message: "稍后再试", retryable: true } });
    api.getChatHistory.mockResolvedValue({ babyId, conversationId: "conversation", pendingCount: 0, pending: [], turns: [failed] });
    api.getChatRequest.mockResolvedValue(failed); await session.load();
    await session.recoverTurn(failed.id); expect(api.sendChat).toHaveBeenCalledWith(original); expect(session.getSnapshot().draft.pending).toBeUndefined(); session.dispose();
  });
  it("recovers the server blocker after a definite CHAT_PREVIOUS_PENDING rejection", async () => {
    const { session, api } = fixture(); await session.load(); session.edit({ text: "新的草稿" });
    const original: ChatRequest = { babyId, requestId: "server-blocking-request", text: "旧消息", attachmentIds: [], context: { viewedDate: "2026-10-22" } };
    api.sendChat.mockRejectedValueOnce(new ApiError(409, "先处理上一条", "CHAT_PREVIOUS_PENDING"));
    api.getChatHistory.mockResolvedValue({ babyId, conversationId: "conversation", pendingCount: 0, pending: [], turns: [turn(original, { status: "needs_recovery", refreshRequired: false })] });
    await session.send("2026-10-23"); expect(session.getSnapshot().draft.pending).toEqual(original); expect(session.getSnapshot().draft.text).toBe("新的草稿"); session.dispose();
  });
  it("does not overwrite the latest pending versions with an older history receipt", async () => {
    const { session, api, store } = fixture(); const input: ChatRequest = { babyId, requestId: "request-001", text: "回答", attachmentIds: [], context: { viewedDate: "2026-10-23" } };
    store.save(identityId, babyId, { text: "回答", attachmentIds: [], pending: input });
    const resumed = new ChatSession(api, store, identityId, babyId, { refresh: vi.fn(), revoked: vi.fn() });
    const question = { kind: "fields" as const, id: "q1", babyId, eventId: "e1", version: 4, eventVersion: 5, fields: ["milkAmount"], conflicts: [], duplicateCandidates: [], state: "open" as const };
    api.getPending.mockResolvedValue([question]);
    api.getChatHistory.mockResolvedValue({ babyId, conversationId: "conversation", pendingCount: 0, pending: [], turns: [turn(input)] });
    await resumed.load(); expect(resumed.getSnapshot().pending).toEqual([question]); resumed.dispose(); session.dispose();
  });
});
