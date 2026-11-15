import { describe, expect, it } from "vitest";
import { CHAT_INSTRUCTIONS, hasExplicitPreferenceIntent, modelTools, prepareCall } from "../src/chat/policy";
import { buildPendingForm, confirmedReply, pendingReplyQuestions, renderPendingQuestion, structuredAnswerText, uncommittedReply, validatePendingFormPresentation } from "../src/chat/presentation";
import { deterministicCandidateIssues, hiddenRequestIssues, safeHistoricalReply } from "../src/chat/reply-gate";
import type { StoredTurn } from "../src/chat/persistence";
import type { ChatFieldPending } from "../src/chat/contracts";
import { evaluateEvent } from "../src/records/rules";
import type { CareEvent, EventInput } from "../src/records/types";

function turn(): StoredTurn {
  return { id: "turn_1", identityId: "real-identity", conversationId: "private-conversation", babyId: "baby-a", requestId: "request-1234", createdAt: "2026-10-23T12:00:00.000Z", updatedAt: "2026-10-23T12:00:00.000Z", status: "processing",
    input: { text: "刚喂了100毫升", attachmentIds: [], context: { viewedDate: "2025-01-01" } }, assistantText: "", receipts: [], pending: [], refreshRequired: false, fingerprint: "fingerprint", transcript: [], steps: [], rounds: 0, versions: { "event-1": 2 }, questionVersions: { "question-1": { questionVersion: 4, eventVersion: 2 } } };
}
function event(input: EventInput): CareEvent {
  return { ...evaluateEvent(input), intent: input.intent, id: "event-1", babyId: "baby-a", legacyId: "event-1", version: 1, lifecycle: "active", duplicateCandidates: [], sources: [], attachmentIds: [], actor: { kind: "chat-agent", id: "bubu-chat", sessionId: "session", onBehalfOf: "real-identity" }, projection: "candidate", projected: null, createdAt: "2026-10-23T12:00:00.000Z", updatedAt: "2026-10-23T12:00:00.000Z" };
}
function question(value: CareEvent): ChatFieldPending {
  return { kind: "fields", id: "question-1", babyId: value.babyId, eventId: value.id, version: 1, eventVersion: value.version, fields: value.missing, conflicts: value.conflicts, duplicateCandidates: value.duplicateCandidates, state: "open", updatedAt: value.updatedAt };
}

describe("chat tool scope and evidence boundary", () => {
  it("tells chat to keep one bottle meal with literal multi-milk details", () => {
    expect(CHAT_INSTRUCTIONS).toContain("一次瓶喂是一餐");
    expect(CHAT_INSTRUCTIONS).toContain("羊奶原话 200ml 和 FORMULA 150ml");
    expect(CHAT_INSTRUCTIONS).toContain("不拆事件、不追问奶源奶量或时间");
    expect(CHAT_INSTRUCTIONS).toContain("相同奶品续喝可保留为同餐另一个明细");
    expect(CHAT_INSTRUCTIONS).toContain("明确说两餐才创建两个事件");
  });

  it("injects authenticated baby/source/request metadata and freezes message time independently of the browsed day", () => {
    const args = prepareCall(turn(), { id: "call", name: "bubu_record_events", arguments: { babyId: "other-baby", requestId: "forged", actor: "operator", events: [{ facts: { type: "BOTTLE", milkItems: [{ id: "milk-1", milkSource: "FORMULA", milkAmount: 100 }] }, sources: [{ senderId: "forged" }] }] } }, 0);
    expect(args.babyId).toBe("baby-a"); expect(args.requestId).toMatch(/^chat-/);
    const source = (args.events as EventInput[])[0]!.sources![0]!;
    expect(source).toMatchObject({ kind: "chat", senderId: "real-identity", accountId: "real-identity", sentAt: "2026-10-23T12:00:00.000Z", messageId: "turn_1" });
    expect(JSON.stringify(args)).not.toMatch(/other-baby|forged|operator|2025-01-01/);
    expect(prepareCall(turn(), { id: "new-model-id", name: "bubu_record_events", arguments: { events: [{ facts: { type: "BOTTLE", milkItems: [{ id: "milk-1", milkSource: "FORMULA", milkAmount: 100 }] } }] } }, 0)).toEqual(args);
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
  it("keeps legacy photo state out of model schemas and rejects field questions passed to media resolution", () => {
    const tools = modelTools([{ name: "bubu_answer_pending", inputSchema: { properties: { states: { propertyNames: { anyOf: [{ enum: ["hasPoop", "poopPhotoUrl"] }, { const: "poopPhotoUrl" }] } } } } }]);
    expect(JSON.stringify(tools)).not.toContain("poopPhotoUrl");
    expect(JSON.stringify(tools)).toContain("hasPoop");
    expect(() => prepareCall(turn(), { id: "wrong-media", name: "bubu_resolve_media", arguments: { eventId: "event-1", pendingId: "question-1", resolution: "unknown" } }, 0)).toThrow(/没有这项待补照片/);
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
    const feedingForm = buildPendingForm(question(feeding), feeding);
    expect(feedingForm?.controls.map(control => control.field)).toContain("type");
    expect(feedingForm?.controls.map(control => control.field)).not.toContain("startTime");
    const bottle = event({ facts: { type: "BOTTLE", startTime: "2026-10-23T08:00:00+08:00", milkItems: [{ id: "private-stable-id", milkAmount: 200, milkSourceState: "pending" }] } });
    const text = renderPendingQuestion(question(bottle), bottle);
    expect(text).toMatch(/母乳.*奶粉/); expect(text).not.toMatch(/泡好|多久|结束|拍嗝/);
    expect(text).not.toMatch(/milkAmount|preparedMilkAmount|burpSuccess/);
    const bottleForm = buildPendingForm(question(bottle), bottle);
    expect(bottleForm?.controls).toEqual([expect.objectContaining({ field: "milkSource", milkItemId: "private-stable-id", draftKey: "milkSource:private-stable-id", label: "第 1 项奶品种类" })]);
    expect(JSON.stringify(bottleForm)).not.toContain("奶品 private-stable-id");
    expect(structuredAnswerText({ facts: { type: "PUMP", milkAmount: 0 }, progress: "ended" })).toContain("奶量：0毫升");
    const timeText = structuredAnswerText({ facts: { type: "BOTTLE", endTime: "2026-10-23T08:00:00+08:00" } });
    expect(timeText).toContain("结束时间：2026-10-23 08:00"); expect(timeText).not.toContain("北京时间");
    const itemText = structuredAnswerText({ facts: {}, milkItemAnswers: [{ milkItemId: "internal-milk-1", facts: { milkAmount: 75, milkDescription: "羊奶" } }] });
    expect(itemText).toContain("这项奶品：75毫升"); expect(itemText).toContain("这项奶品：羊奶"); expect(itemText).not.toContain("internal-milk-1");
  });
  it("scopes record activity reads and bounds their page size", () => {
    const activityArgs = prepareCall(turn(), { id: "activity", name: "bubu_get_record_activity", arguments: { babyId: "baby-b", limit: 100 } }, 0);
    expect(activityArgs).toEqual({ babyId: "baby-a", limit: 100 });
    expect(() => prepareCall(turn(), { id: "activity-zero", name: "bubu_get_record_activity", arguments: { limit: 0 } }, 0)).toThrow();
    expect(() => prepareCall(turn(), { id: "activity-high", name: "bubu_get_record_activity", arguments: { limit: 201 } }, 0)).toThrow();
  });
  it("pins shared preference writes to an observed version and requires explicit config intent", () => {
    expect(prepareCall(turn(), { id: "read-options", name: "bubu_get_care_preferences", arguments: { babyId: "forged" } }, 0)).toEqual({ babyId: "baby-a" });
    const ordinary = turn(); ordinary.preferenceVersion = 4;
    expect(() => prepareCall(ordinary, { id: "wrong-intent", name: "bubu_update_care_preferences", arguments: { updates: [{ key: "BOTTLE.milkAmount", values: [210] }] } }, 1)).toThrow(/明确要求/);
    const explicit = turn(); explicit.input.text = "把 210 ml 加入常用选项"; explicit.preferenceVersion = 4;
    expect(prepareCall(explicit, { id: "config", name: "bubu_update_care_preferences", arguments: { babyId: "other", expectedVersion: 99, requestId: "forged", updates: [{ key: "BOTTLE.milkAmount", values: [210, 180] }] } }, 1)).toMatchObject({
      babyId: "baby-a", expectedVersion: 4, updates: [{ key: "BOTTLE.milkAmount", values: [210, 180] }], requestId: expect.stringMatching(/^chat-/),
    });
    expect(hasExplicitPreferenceIntent("这次喝了210ml")).toBe(false);
    expect(hasExplicitPreferenceIntent("把210ml加入常用选项")).toBe(true);
    expect(hasExplicitPreferenceIntent("把“210ml”加入常用选项")).toBe(true);
    expect(hasExplicitPreferenceIntent("不要把210加入常用选项")).toBe(false);
    expect(hasExplicitPreferenceIntent("不要把“210ml”加入常用选项")).toBe(false);
    expect(hasExplicitPreferenceIntent("“把210加入常用选项”")).toBe(false);
    expect(hasExplicitPreferenceIntent("“把210加入常用选项”是什么意思")).toBe(false);
    expect(hasExplicitPreferenceIntent("如果我说把210加入常用选项，会发生什么")).toBe(false);
    expect(hasExplicitPreferenceIntent("如果我说“把210加入常用选项”，会发生什么")).toBe(false);
    expect(hasExplicitPreferenceIntent("把“210ml加入常用选项")).toBe(false);
  });
  it("maps alternate duration unknown only for an authoritative end-time question", () => {
    const legacyEnd = turn();
    legacyEnd.input.question = { id: "question-1", questionVersion: 4, eventVersion: 2 };
    legacyEnd.input.formAnswer = { facts: {}, states: { durationMinutes: "unknown" } };
    legacyEnd.pending = [{ kind: "fields", id: "question-1", babyId: "baby-a", eventId: "event-1", version: 4, eventVersion: 2, fields: ["endTime"], conflicts: [], duplicateCandidates: [], state: "open", updatedAt: legacyEnd.updatedAt }];
    expect(prepareCall(legacyEnd, { id: "legacy-end", name: "bubu_answer_pending", arguments: { patch: { facts: {}, states: { durationMinutes: "unknown" } } } }, 0)).toMatchObject({ patch: { states: { durationMinutes: "unknown", endTime: "unknown" } } });

    const durationOnly = turn();
    durationOnly.input.question = { id: "question-1", questionVersion: 4, eventVersion: 2 };
    durationOnly.input.formAnswer = { facts: {}, states: { durationMinutes: "unknown" } };
    durationOnly.pending = [{ kind: "fields", id: "question-1", babyId: "baby-a", eventId: "event-1", version: 4, eventVersion: 2, fields: ["durationMinutes"], conflicts: [], duplicateCandidates: [], state: "open", updatedAt: durationOnly.updatedAt }];
    expect(prepareCall(durationOnly, { id: "duration-only", name: "bubu_answer_pending", arguments: { patch: { facts: {}, states: { durationMinutes: "unknown" } } } }, 0)).toMatchObject({ patch: { facts: {}, states: { durationMinutes: "unknown" } } });
  });
  it("enriches pending forms from baby-shared options and the original source time without selecting facts", () => {
    const incomplete = event({ facts: { type: "BOTTLE", milkSource: "FORMULA" } });
    incomplete.sources = [{ kind: "chat", accountId: "identity", conversationId: "conversation", messageId: "message", eventKey: "0", sentAt: "2026-10-20T04:34:00.000Z", senderId: "identity" }];
    const preferences = { babyId: "baby-a", version: 2, updatedAt: "2026-10-23T00:00:00Z", notices: [], semantics: "", options: [{ key: "BOTTLE.milkAmount", activityType: "BOTTLE", field: "milkAmount", configuredValues: [180, 210], effectiveValues: [180, 210], source: "manual", version: 2, updatedAt: "2026-10-23T00:00:00Z", usingExampleFallback: false, examplesAreFacts: false, examplesAreRecommendations: false }] } as never;
    const form = buildPendingForm(question(incomplete), incomplete, preferences)!;
    expect(form.sourceSentAt).toBe("2026-10-20T04:34:00.000Z");
    expect(form.controls.find(item => item.field === "milkAmount")).toMatchObject({ optionsSource: "manual", options: [{ label: "180 ml", value: "180" }, { label: "210 ml", value: "210" }] });
    expect(form.controls.find(item => item.field === "startTime")?.options?.map(item => item.label)).toEqual(["按原消息时间", "提前 5 分钟", "提前 10 分钟"]);
    expect(validatePendingFormPresentation([{ ...question(incomplete), form }])).toEqual([]);
  });
  it("keeps an explicit test-record marker visible without changing the activity or missing-field form", () => {
    const marked = event({ facts: { type: "BOTTLE", startTime: "2026-10-23T08:00:00+08:00", milkItems: [{ id: "formula-1", milkSource: "FORMULA" }], notes: "[测试记录] 手工验收" } });
    const pending = question(marked);
    const form = buildPendingForm(pending, marked)!;
    expect(form.knownSummary).toContain("[测试记录]");
    expect(form.knownSummary).toContain("瓶喂");
    expect(form.activityType).toBe("BOTTLE");
    expect(pending.fields).toEqual(["milkAmount"]);
    expect(form.controls.map(control => control.field)).toEqual(["milkAmount"]);
    expect(confirmedReply([{ requestId: "request", status: "needs_information", events: [marked], questions: [pending], retryable: false }], [pending])).toContain("[测试记录]，瓶喂");
  });
  it("publishes authoritative duration alternatives and rejects scalar forms without valid server choices", () => {
    const preferences = { babyId: "baby-a", version: 2, updatedAt: "2026-10-23T00:00:00Z", notices: [], semantics: "", options: [{ key: "SLEEP.durationMinutes", activityType: "SLEEP", field: "durationMinutes", configuredValues: [25], effectiveValues: [25], source: "manual", version: 2, updatedAt: "2026-10-23T00:00:00Z", usingExampleFallback: false, examplesAreFacts: false, examplesAreRecommendations: false }] } as never;
    const started = event({ facts: { type: "SLEEP", startTime: "2026-10-23T08:00:00+08:00" } });
    const endForm = buildPendingForm(question(started), started, preferences)!;
    expect(question(started).fields).toEqual(["endTime"]);
    expect(endForm.controls.find(item => item.field === "durationMinutes")).toMatchObject({ options: [{ label: "25 分钟", value: "25" }] });
    expect(validatePendingFormPresentation([{ ...question(started), fields: ["endTime", "durationMinutes"], form: endForm }])).toEqual([]);

    const ended = event({ facts: { type: "SLEEP", endTime: "2026-10-23T08:25:00+08:00" } });
    const durationForm = buildPendingForm(question(ended), ended, preferences)!;
    expect(question(ended).fields).toEqual(["durationMinutes"]);
    expect(durationForm.controls.find(item => item.field === "durationMinutes")).toMatchObject({ options: [{ label: "25 分钟", value: "25" }] });
    expect(durationForm.progressControl).toBeUndefined();
    expect(validatePendingFormPresentation([{ ...question(ended), form: durationForm }])).toEqual([]);

    const malformed = structuredClone(durationForm);
    malformed.controls[0]!.options = [];
    expect(validatePendingFormPresentation([{ ...question(ended), form: malformed }])).toEqual(expect.arrayContaining([expect.stringContaining("缺少服务端数值选项")]));
    malformed.controls[0]!.options = [{ label: "坏值", value: "NaN" }];
    expect(validatePendingFormPresentation([{ ...question(ended), form: malformed }])).toEqual(expect.arrayContaining([expect.stringContaining("无效数值选项")]));
  });
  it("applies diaper defaults and never repeats an explicitly unknown field", () => {
    const diaper = event({ facts: { type: "DIAPER", startTime: "2026-10-23T08:00:00+08:00" } });
    expect(diaper).toMatchObject({ complete: true, facts: { hasPee: true, hasPoop: false, peeAmount: "LARGE" } });
    expect(question(diaper).fields).toEqual([]);
    const knownUnknown = event({ facts: { type: "BOTTLE", startTime: "2026-10-23T08:00:00+08:00", milkItems: [{ id: "milk-1", milkSource: "BREAST_MILK", milkAmount: 100 }] }, states: { burpSuccess: "unknown" } });
    expect(renderPendingQuestion(question(knownUnknown), knownUnknown)).not.toMatch(/拍嗝/);
    knownUnknown.projection = "synced"; knownUnknown.projected = { ...knownUnknown.facts, id: "event-1", babyId: "baby-a", type: "BOTTLE", startTime: "2026-10-23T08:00:00+08:00" };
    expect(confirmedReply([{ requestId: "request", status: "needs_information", events: [knownUnknown], questions: [], retryable: false }], [question(knownUnknown)])).toMatch(/母乳 100 毫升，合计 100 毫升/);
  });
  it("states the authoritative source-time, duration, default and optional-count policy", () => {
    expect(CHAT_INSTRUCTIONS).toMatch(/来源.*sentAt/);
    expect(CHAT_INSTRUCTIONS).toMatch(/亲喂、睡眠、抬头、户外才必须保留时长/);
    expect(CHAT_INSTRUCTIONS).toMatch(/有尿、无便、尿量大/);
    expect(CHAT_INSTRUCTIONS).toMatch(/未量化/);
  });
  it("turns duplicate, conflict and media review into typed meaningful choices and sanitizes legacy prose", () => {
    const duplicate = { ...question(event({ facts: { type: "BOTTLE", startTime: "2026-10-23T08:00:00+08:00", milkSource: "BREAST_MILK", milkAmount: 100 } })), duplicateCandidates: ["event-2"] };
    const conflict = { ...duplicate, id: "question-conflict", duplicateCandidates: [], conflicts: [{ code: "TIME_OVERLAP", fields: ["startTime" as const, "endTime" as const], message: "时间重叠", relatedEventId: "event-2" }] };
    const media = { kind: "media" as const, id: "media-1", sourceId: "source-1", babyId: "baby-a", eventIds: ["event-1"], source: { kind: "wechat" as const, accountId: "account", conversationId: "conversation", messageId: "message", sentAt: "2026-10-23T08:00:00Z", senderId: "sender", groupId: "group" }, media: [{ index: 0, kind: "image", state: "unavailable" as const, reason: "missing" }], state: "open" as const, resolution: "protected_upload_and_attach_or_backfill" as const };
    const choices = pendingReplyQuestions([duplicate, conflict, media]);
    expect(choices[0]?.choices.map(item => item.label)).toEqual(["与候选 1是同一件事", "不同事件", "自定义"]);
    expect(choices[0]?.choices[0]?.action).toMatchObject({ type: "reply", text: expect.stringContaining("event-2") });
    expect(choices[1]?.choices.map(item => item.label)).toEqual(["两件事确实同时发生", "自定义"]);
    expect(choices[1]?.choices[0]?.action).toEqual({ type: "reply", text: "确认当前记录与记录 event-2 确实同时发生" });
    expect(choices[2]?.choices.map(item => item.label)).toEqual(["补照片", "无法提供", "稍后处理"]);
    expect(safeHistoricalReply("告诉我奶量", [])).toContain("未经过当前发送检查");
    expect(safeHistoricalReply("今天共瓶喂 3 次。", [])).toContain("未经过当前发送检查");
    expect(safeHistoricalReply("还缺宝宝这次喝奶的量，麻烦说一声", [{ ...choices[0]!, id: "legacy" }])).toContain("未经过当前发送检查");
    expect(safeHistoricalReply("任意旧回复", [], undefined, "已整理你的说明。")).toBe("已整理你的说明。");
    expect(safeHistoricalReply("", [])).toBe("");
    expect(safeHistoricalReply("尚未确认保存；已整理你的说明。", [], { checked: true, version: 1 })).toBe("尚未确认保存；已整理你的说明。");
    expect(hiddenRequestIssues("告诉我奶量")).toHaveLength(1);
    expect(deterministicCandidateIssues({ text: "说明。", questions: [{ id: "q", prompt: "选择", choices: [{ id: "unknown", label: "不知道", action: { type: "reply", text: "不知道" } }, { id: "custom", label: "自定义", action: { type: "custom" } }] }] })).toEqual(expect.arrayContaining([expect.stringContaining("至少需要两个具体")]));
  });
});
