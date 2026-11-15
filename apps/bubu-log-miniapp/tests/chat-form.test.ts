import { describe, expect, it } from "vitest";
import type { ChatFormControl, ChatPending, FieldPending, PendingEventForm } from "../src/chat/contracts";
import { buildPendingFormAnswer, clearPendingFieldValue, clearPendingFormProgress, groupPendingEvents, setPendingFieldValue, setPendingFormProgress } from "../src/chat/form";

const baseForm = { eventId: "event-1", eventVersion: 7, questionId: "question-1", questionVersion: 3, title: "瓶喂", knownSummary: "14:00 开始", conflictMessages: [], duplicateCandidateIds: [] };
const booleanControl: ChatFormControl = { field: "burpSuccess", kind: "boolean", label: "拍嗝结果", options: [{ label: "是", value: "true" }, { label: "否", value: "false" }], allowUnknown: true, allowNotYet: true };
const numberControl: ChatFormControl = { field: "milkAmount", kind: "number", label: "实际喝入奶量", unit: "ml", allowUnknown: true };
const endControl: ChatFormControl = { field: "endTime", kind: "timestamp", label: "结束时间", allowUnknown: true };
const durationControl: ChatFormControl = { field: "durationMinutes", kind: "duration", label: "时长", unit: "minutes", allowUnknown: true };
const progressControl = { field: "progress" as const, kind: "progress" as const, label: "进行状态", options: [{ label: "仍在进行", value: "ongoing" as const }, { label: "已经结束", value: "ended" as const }, { label: "不确定", value: "unknown" as const }] };

function form(controls: PendingEventForm["controls"]): PendingEventForm {
  return { ...baseForm, controls, ...(controls.some(control => control.field === "endTime" || control.field === "durationMinutes") ? { progressControl } : {}) };
}

describe("pending event forms", () => {
  it("builds real booleans, explicit zero, a duration alternative, and unknown states", () => {
    const answer = buildPendingFormAnswer(form([booleanControl, numberControl, endControl]), {
      fields: { burpSuccess: { kind: "value", value: false }, milkAmount: { kind: "value", value: "0" }, durationMinutes: { kind: "value", value: "15" } },
    }).answer;
    expect(answer).toEqual({ facts: { burpSuccess: false, milkAmount: 0, durationMinutes: 15 }, progress: "ended" });
    expect(buildPendingFormAnswer(form([booleanControl]), { fields: { burpSuccess: { kind: "value", value: true } } }).answer?.facts.burpSuccess).toBe(true);
    expect(buildPendingFormAnswer(form([endControl]), { fields: {}, progress: "unknown" }).answer).toEqual({ facts: {}, states: { endTime: "unknown" }, progress: "unknown" });
  });

  it("never turns blank input into zero and preserves an entered zero", () => {
    expect(buildPendingFormAnswer(form([numberControl]), { fields: { milkAmount: { kind: "value", value: "  " } } })).toEqual({ error: "请输入有效的实际喝入奶量。" });
    expect(buildPendingFormAnswer(form([numberControl]), { fields: { milkAmount: { kind: "value", value: " 0 " } } }).answer?.facts).toEqual({ milkAmount: 0 });
  });

  it("merges a same-item amount and inline literal source regardless of control order", () => {
    const amount: ChatFormControl = { field: "milkAmount", draftKey: "milkAmount:item-1", milkItemId: "item-1", milkItemLabel: "待确认奶品", kind: "number", label: "实际喝入奶量", unit: "ml", allowUnknown: true };
    const source: ChatFormControl = { field: "milkSource", draftKey: "milkSource:item-1", milkItemId: "item-1", milkItemLabel: "待确认奶品", kind: "enum", label: "奶品", options: [{ label: "母乳", value: "BREAST_MILK" }, { label: "奶粉", value: "FORMULA" }], allowUnknown: true };
    for (const controls of [[amount, source], [source, amount]]) {
      expect(buildPendingFormAnswer(form(controls), { fields: { "milkAmount:item-1": { kind: "value", value: "75" } } }, { "milkSource:item-1": "羊奶" }).answer).toEqual({
        facts: {}, milkItemAnswers: [{ milkItemId: "item-1", facts: { milkAmount: 75, milkDescription: "羊奶" } }],
      });
    }
    expect(buildPendingFormAnswer(form([source]), { fields: {} }, { "milkSource:item-1": "不知道" }).answer).toEqual({
      facts: {}, milkItemAnswers: [{ milkItemId: "item-1", states: { milkSourceState: "unknown" } }],
    });
    expect(buildPendingFormAnswer(form([source]), { fields: {} }, { "milkSource:item-1": "不清楚" }).answer).toEqual({
      facts: {}, milkItemAnswers: [{ milkItemId: "item-1", states: { milkSourceState: "unknown" } }],
    });
    expect(buildPendingFormAnswer(form([source]), { fields: {} }, { "milkSource:item-1": "羊奶" }).answer).toEqual({
      facts: {}, milkItemAnswers: [{ milkItemId: "item-1", facts: { milkDescription: "羊奶" } }],
    });
  });

  it("accepts only a real Shanghai calendar timestamp and the authoritative duration alternative", () => {
    expect(buildPendingFormAnswer(form([endControl]), { fields: { endTime: { kind: "timestamp", date: "2026-02-30", time: "08:00" } } }).error).toContain("结束时间");
    expect(buildPendingFormAnswer(form([endControl]), { fields: { endTime: { kind: "timestamp", date: "2026-10-23", time: "08:09" } } }).answer?.facts.endTime).toBe("2026-10-23T08:09:00.000+08:00");
    expect(buildPendingFormAnswer(form([durationControl]), { fields: { endTime: { kind: "timestamp", date: "2026-10-23", time: "08:09" } } }).answer?.facts).toEqual({ endTime: "2026-10-23T08:09:00.000+08:00" });
  });

  it("switching between time, duration, and unknown clears the other temporal value", () => {
    let draft = setPendingFieldValue({ fields: {} }, "durationMinutes", { kind: "value", value: 20 });
    draft = setPendingFieldValue(draft, "endTime", { kind: "timestamp", date: "2026-10-23", time: "08:00" });
    expect(draft.fields.durationMinutes).toBeUndefined();
    draft = setPendingFieldValue(draft, "durationMinutes", { kind: "value", value: "20" });
    expect(draft.fields.endTime).toBeUndefined();
    draft = setPendingFieldValue(draft, "endTime", { kind: "unknown" });
    expect(draft.fields).toEqual({ endTime: { kind: "unknown" } });
    expect(clearPendingFieldValue(draft, "endTime").fields).toEqual({});
  });

  it("cannot retain a hidden completed time when switching to ongoing, and can clear progress for custom editing", () => {
    const completed = { fields: { endTime: { kind: "timestamp" as const, date: "2026-10-23", time: "08:00" }, durationMinutes: { kind: "value" as const, value: 30 } }, progress: "ended" as const };
    expect(setPendingFormProgress(completed, "ongoing")).toEqual({ fields: {}, progress: "ongoing" });
    expect(clearPendingFormProgress(setPendingFormProgress(completed, "unknown"))).toEqual({ fields: {} });
  });

  it("groups every unambiguous item for one event, while ambiguous media remains separate", () => {
    const field = { kind: "fields" as const, id: "q1", babyId: "baby", eventId: "event-1", version: 1, eventVersion: 2, fields: ["milkAmount"], conflicts: [], duplicateCandidates: [], state: "open" as const };
    const mediaForEvent = (id: string): ChatPending => ({ kind: "media", id, babyId: "baby", eventIds: ["event-1"], state: "open", media: [{ index: 0, state: "unavailable" }] });
    const groups = groupPendingEvents([mediaForEvent("media-a"), field as FieldPending, mediaForEvent("media-b"), { kind: "media", id: "media-multi", babyId: "baby", eventIds: ["event-1", "event-2"], state: "open", media: [{ index: 0, state: "unavailable" }] }]);
    expect(groups.map(group => [group.key, group.fields.length, group.media.map(item => item.id)])).toEqual([
      ["event:event-1", 1, ["media-a", "media-b"]],
      ["media:media-multi", 0, ["media-multi"]],
    ]);
  });
});
