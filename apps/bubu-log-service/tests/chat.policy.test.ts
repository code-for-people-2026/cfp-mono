import { describe, expect, it } from "vitest";
import { modelTools, prepareCall } from "../src/chat/policy";
import { confirmedReply, renderPendingQuestion, uncommittedReply } from "../src/chat/presentation";
import type { StoredTurn } from "../src/chat/persistence";
import type { ChatPending } from "../src/chat/contracts";
import { evaluateEvent } from "../src/records/rules";
import type { CareEvent, EventInput } from "../src/records/types";

function turn(): StoredTurn {
  return { id: "turn_1", identityId: "real-identity", conversationId: "private-conversation", babyId: "baby-a", requestId: "request-1234", createdAt: "2026-10-23T12:00:00.000Z", updatedAt: "2026-10-23T12:00:00.000Z", status: "processing",
    input: { text: "刚喂了100毫升", attachmentIds: [], context: { viewedDate: "2025-01-01" } }, assistantText: "", receipts: [], pending: [], refreshRequired: false, fingerprint: "fingerprint", transcript: [], steps: [], rounds: 0, versions: { "event-1": 2 }, questionVersions: { "question-1": { questionVersion: 4, eventVersion: 2 } } };
}
function event(input: EventInput): CareEvent {
  return { ...evaluateEvent(input), intent: input.intent, id: "event-1", babyId: "baby-a", legacyId: "event-1", version: 1, lifecycle: "active", duplicateCandidates: [], sources: [], attachmentIds: [], actor: { kind: "chat-agent", id: "bubu-chat", sessionId: "session", onBehalfOf: "real-identity" }, projection: "candidate", projected: null, createdAt: "2026-10-23T12:00:00.000Z", updatedAt: "2026-10-23T12:00:00.000Z" };
}
function question(value: CareEvent): ChatPending {
  return { kind: "fields", id: "question-1", babyId: value.babyId, eventId: value.id, version: 1, eventVersion: value.version, fields: value.missing, conflicts: value.conflicts, duplicateCandidates: value.duplicateCandidates, state: "open", updatedAt: value.updatedAt };
}

describe("chat tool scope and evidence boundary", () => {
  it("injects authenticated baby/source/request metadata and freezes message time independently of the browsed day", () => {
    const args = prepareCall(turn(), { id: "call", name: "bubu_record_events", arguments: { babyId: "other-baby", requestId: "forged", actor: "operator", events: [{ facts: { type: "BOTTLE", milkAmount: 100 }, sources: [{ senderId: "forged" }] }] } }, 0);
    expect(args.babyId).toBe("baby-a"); expect(args.requestId).toMatch(/^chat-/);
    const source = (args.events as EventInput[])[0]!.sources![0]!;
    expect(source).toMatchObject({ kind: "chat", senderId: "real-identity", accountId: "real-identity", sentAt: "2026-10-23T12:00:00.000Z", messageId: "turn_1" });
    expect(JSON.stringify(args)).not.toMatch(/other-baby|forged|operator|2025-01-01/);
    expect(prepareCall(turn(), { id: "new-model-id", name: "bubu_record_events", arguments: { events: [{ facts: { type: "BOTTLE", milkAmount: 100 } }] } }, 0)).toEqual(args);
  });
  it("overrides model versions with the user's fixed question and cannot bypass it with update", () => {
    const current = turn(); current.input.question = { id: "question-1", questionVersion: 4, eventVersion: 2 };
    const args = prepareCall(current, { id: "call", name: "bubu_answer_pending", arguments: { questionId: "forged", questionVersion: 9, eventVersion: 12, patch: { facts: { milkAmount: 0, burpSuccess: false }, states: { endTime: "unknown" } } } }, 1);
    expect(args).toMatchObject({ questionId: "question-1", questionVersion: 4, eventVersion: 2, patch: { facts: { milkAmount: 0, burpSuccess: false }, states: { endTime: "unknown" } } });
    expect(() => prepareCall(current, { id: "call", name: "bubu_update_event", arguments: { eventId: "event-1", patch: { facts: { milkAmount: 100 } } } }, 1)).toThrow(/原问题/);
  });
  it("image captions cannot promote model-labelled reported facts into confirmed visual attributes", () => {
    const current = turn(); current.input.attachmentIds = ["attachment-1"]; current.input.text = "刚换的尿布";
    const args = prepareCall(current, { id: "call", name: "bubu_record_events", arguments: { events: [{ facts: { type: "DIAPER", startTime: current.createdAt, hasPoop: true, hasPee: false, poopColor: "GREEN" }, evidence: [{ field: "poopColor", kind: "reported", confirmed: true }] }] } }, 0);
    const input = (args.events as EventInput[])[0]!;
    expect(input.attachmentIds).toEqual(["attachment-1"]);
    for (const field of ["hasPoop", "hasPee", "poopColor"]) expect(input.evidence).toContainEqual({ field, kind: "image", confirmed: false });
    const result = evaluateEvent(input);
    expect(result.states.hasPee).not.toBe("known"); expect(result.states.poopColor).not.toBe("known");
    expect(() => prepareCall(current, { id: "bad", name: "bubu_attach_images", arguments: { eventId: "event-1", attachmentIds: ["another-photo"] } }, 1)).toThrow(/照片/);
  });
  it("model-facing tool schemas hide transport fields while retaining real business constraints", () => {
    const tools = modelTools([{ name: "bubu_record_events", inputSchema: { type: "object", required: ["babyId", "requestId", "events"], properties: { babyId: { type: "string" }, requestId: { type: "string" }, events: { type: "array", minItems: 1, items: { type: "object", required: ["facts"], properties: { sources: {}, facts: { type: "object" } } } } } } }]);
    expect(JSON.stringify(tools)).not.toMatch(/babyId|requestId|sources/);
    expect(JSON.stringify(tools)).toContain('"minItems":1');
    expect(() => prepareCall(turn(), { id: "forbidden", name: "bubu_collector", arguments: {} }, 0)).toThrow(/不能使用/);
  });
});
describe("natural follow-ups use only MCP-selected fields", () => {
  it.each(["保存成功，100ml已入账。", "已记下这次100ml", "我已经帮你记录到日历啦。", "删除完成。", "记好啦，已入库。", "I saved the new feeding."])("rejects an unconfirmed success statement: %s", text => {
    expect(uncommittedReply(text)).toContain("没有获得记录变更回执");
    expect(uncommittedReply("这次是亲喂还是奶瓶喂？")).toBe("这次是亲喂还是奶瓶喂？");
  });
  it("asks the feeding branch and distinct formula quantities instead of exposing field names", () => {
    const feeding = event({ facts: { startTime: "2026-10-23T08:00:00+08:00" }, intent: "feeding" });
    expect(renderPendingQuestion(question(feeding), feeding)).toMatch(/亲喂.*奶瓶.*母乳.*奶粉/);
    const bottle = event({ facts: { type: "BOTTLE", startTime: "2026-10-23T08:00:00+08:00", milkSource: "FORMULA" } });
    const text = renderPendingQuestion(question(bottle), bottle);
    expect(text).toMatch(/泡好/); expect(text).toMatch(/实际喝/); expect(text).toMatch(/多久|结束/); expect(text).toMatch(/拍嗝/);
    expect(text).not.toMatch(/milkAmount|preparedMilkAmount|burpSuccess/);
  });
  it("asks diaper branch first and never repeats an explicitly unknown field", () => {
    const diaper = event({ facts: { type: "DIAPER", startTime: "2026-10-23T08:00:00+08:00" } });
    expect(renderPendingQuestion(question(diaper), diaper)).toMatch(/有尿、有便/);
    const knownUnknown = event({ facts: { type: "BOTTLE", startTime: "2026-10-23T08:00:00+08:00", milkSource: "BREAST_MILK", milkAmount: 100 }, states: { burpSuccess: "unknown" } });
    expect(renderPendingQuestion(question(knownUnknown), knownUnknown)).not.toMatch(/拍嗝/);
    knownUnknown.projection = "synced"; knownUnknown.projected = { ...knownUnknown.facts, id: "event-1", babyId: "baby-a", type: "BOTTLE", startTime: "2026-10-23T08:00:00+08:00" };
    expect(confirmedReply([{ requestId: "request", status: "needs_information", events: [knownUnknown], questions: [], retryable: false }], [question(knownUnknown)])).toMatch(/实际喝入 100 毫升/);
  });
});
