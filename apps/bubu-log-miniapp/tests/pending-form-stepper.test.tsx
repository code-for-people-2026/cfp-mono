import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tarojs/components", () => ({ Button: "button", Input: "input", Picker: "picker", Text: "text", Textarea: "textarea", View: "view" }));

const getEventSources = vi.hoisted(() => vi.fn());
vi.mock("../src/api", () => ({
  api: { getEventSources },
  ApiError: class ApiError extends Error {},
}));

import { PendingFormStepper } from "../src/chat/PendingFormStepper";
import type { EventSources, FieldPending, PendingEventForm } from "../src/chat/contracts";
import { pendingFormKey, type PendingFormDraft } from "../src/chat/form";

const progress = { field: "progress" as const, kind: "progress" as const, label: "进行状态", options: [{ label: "仍在进行", value: "ongoing" as const }, { label: "已经结束", value: "ended" as const }, { label: "不确定", value: "unknown" as const }] };
function eventForm(eventId: string, questionId: string, title: string): PendingEventForm {
  return {
    eventId, eventVersion: 2, questionId, questionVersion: 1, title, knownSummary: "", controls: [
      { field: "burpSuccess", kind: "boolean", label: "拍嗝结果", options: [{ label: "是", value: "true" }, { label: "否", value: "false" }], allowUnknown: true, allowNotYet: true },
      { field: "endTime", kind: "timestamp", label: "结束时间", allowUnknown: true },
      { field: "milkAmount", kind: "number", label: "实际喝入奶量", unit: "ml", allowUnknown: true },
    ], progressControl: progress, conflictMessages: [], duplicateCandidateIds: [],
  };
}
function question(eventId: string, form: PendingEventForm, version = 1): FieldPending {
  return { kind: "fields", id: form.questionId, babyId: "baby", eventId, version, eventVersion: 2, fields: form.controls.map(control => control.field), conflicts: [], duplicateCandidates: [], state: "open", form };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(value => { resolve = value; });
  return { promise, resolve };
}
let root: ReactTestRenderer;
let drafts: Record<string, PendingFormDraft>;
let textDrafts: Record<string, Record<string, string>>;
const onDraft = vi.fn(), onSubmit = vi.fn(), onConversation = vi.fn(), onMedia = vi.fn();
const onTextDraft = vi.fn();
const onFieldFocus = vi.fn(), onFieldBlur = vi.fn(), onFormChange = vi.fn();
const onRevoked = vi.fn();

function render(pending: FieldPending[], busy = false, source?: { babyId: string }) {
  root = create(<PendingFormStepper pending={pending} drafts={drafts} busy={busy} onDraft={onDraft} onSubmit={onSubmit} onConversation={onConversation} onMedia={onMedia}
    textDrafts={textDrafts} onTextDraft={onTextDraft}
    onFieldFocus={onFieldFocus} onFieldBlur={onFieldBlur} onFormChange={onFormChange}
    source={source ? { babyId: source.babyId, onRevoked } : undefined} />);
}
const rerender = (pending: FieldPending[], busy = false, source?: { babyId: string }) => root.update(<PendingFormStepper pending={pending} drafts={drafts} busy={busy} onDraft={onDraft} onSubmit={onSubmit} onConversation={onConversation} onMedia={onMedia}
  textDrafts={textDrafts} onTextDraft={onTextDraft}
  onFieldFocus={onFieldFocus} onFieldBlur={onFieldBlur} onFormChange={onFormChange}
  source={source ? { babyId: source.babyId, onRevoked } : undefined} />);
const nodeText = (node: unknown): string => {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray((node as { children?: unknown[] }).children)) return "";
  return (node as { children: unknown[] }).children.map(nodeText).join("");
};
const buttonText = (label: string) => {
  const match = root.root.findAll(node => node.type === "button" && nodeText(node) === label);
  if (match.length !== 1) throw new Error(`expected one ${label}, found ${match.length}`);
  return match[0]!;
};
const buttonAria = (label: string) => {
  const match = root.root.findAll(node => node.type === "button" && node.props.ariaLabel === label);
  if (match.length !== 1) throw new Error(`expected one aria ${label}, found ${match.length}`);
  return match[0]!;
};
const texts = (className: string) => root.root.findAll(node => node.props.className === className).map(nodeText);

beforeEach(() => {
  onDraft.mockClear(); onSubmit.mockClear(); onConversation.mockClear(); onMedia.mockClear();
  onTextDraft.mockClear();
  onFieldFocus.mockClear(); onFieldBlur.mockClear(); onFormChange.mockClear();
  onRevoked.mockClear(); getEventSources.mockReset();
  root?.unmount(); drafts = {}; textDrafts = {};
});

describe("PendingFormStepper", () => {
  it("submits shortcut and custom values together in one event step", async () => {
    const first = eventForm("event-1", "question-1", "PUMP");
    await act(async () => { render([question("event-1", first)]); });
    expect(root.root.findAll(node => node.props.className === "bubu-chat-form-error")).toHaveLength(0);
    await act(async () => { buttonText("是").props.onClick(); });
    onDraft.mock.calls.forEach(([, draft]) => { drafts = { ...drafts, [pendingFormKey(first)]: draft }; });
    await act(async () => rerender([question("event-1", first)]));
    await act(async () => { buttonText("否").props.onClick(); });
    onDraft.mock.calls.forEach(([, draft]) => { drafts = { ...drafts, [pendingFormKey(first)]: draft }; });
    await act(async () => rerender([question("event-1", first)]));
    await act(async () => { buttonText("15 分钟").props.onClick(); });
    onDraft.mock.calls.slice(2).forEach(([, draft]) => { drafts = { ...drafts, [pendingFormKey(first)]: draft }; });
    await act(async () => rerender([question("event-1", first)]));
    await act(async () => { buttonAria("实际喝入奶量自定义").props.onClick(); });
    onDraft.mock.calls.slice(3).forEach(([, draft]) => { drafts = { ...drafts, [pendingFormKey(first)]: draft }; });
    await act(async () => rerender([question("event-1", first)]));
    await act(async () => {
      const input = root.root.findAll(node => node.type === "input")[0]!;
      input.props.onInput({ detail: { value: "0" } });
    });
    onDraft.mock.calls.slice(4).forEach(([, draft]) => { drafts = { ...drafts, [pendingFormKey(first)]: draft }; });
    await act(async () => rerender([question("event-1", first)]));
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit).toHaveBeenCalledOnce();
    const [submitted] = onSubmit.mock.calls[0]![0];
    expect(submitted.question.id).toBe("question-1");
    expect(submitted.formAnswer).toEqual({ facts: { burpSuccess: false, durationMinutes: 15, milkAmount: 0 }, progress: "ended" });
    expect(root.root.findAll(node => nodeText(node) === "吸奶")).toHaveLength(1);
  });

  it("does not show validation before a submit attempt, then shows it after an empty attempt", async () => {
    const first = eventForm("event-1", "question-1", "瓶喂");
    await act(async () => { render([question("event-1", first)]); });
    expect(root.root.findAll(node => node.props.className === "bubu-chat-form-error")).toHaveLength(0);
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(root.root.findAll(node => node.props.className === "bubu-chat-form-error")).toHaveLength(1);
  });

  it("renders no stepper for an empty pending list", async () => {
    await act(async () => { render([]); });
    expect(root.toJSON()).toBeNull();
  });

  it("keeps the same event on version advance and advances to the next event when a later one completes", async () => {
    const first = eventForm("event-1", "question-1", "瓶喂"), second = eventForm("event-2", "question-2", "换尿布"), third = eventForm("event-3", "question-3", "睡眠");
    const originalFirst = question("event-1", first), originalSecond = question("event-2", second), originalThird = question("event-3", third);
    await act(async () => { render([originalFirst, originalSecond, originalThird]); });
    const nextFirst = question("event-1", first, 2);
    await act(async () => rerender([nextFirst, originalSecond, originalThird]));
    expect(nodeText(root.root.findAll(node => node.props.className === "bubu-chat-step-count")[0]!)).toBe("待补充 · 1 / 3");
    await act(async () => root.root.find(node => node.type === "button" && node.props.ariaLabel === "下一个待补充事件").props.onClick());
    expect(nodeText(root.root.findAll(node => node.props.className === "bubu-chat-step-count")[0]!)).toBe("待补充 · 2 / 3");
    await act(async () => rerender([originalFirst, originalThird]));
    expect(nodeText(root.root.findAll(node => node.props.className === "bubu-chat-step-title")[0]!)).toBe("睡眠");
    expect(nodeText(root.root.findAll(node => node.props.className === "bubu-chat-step-count")[0]!)).toBe("待补充 · 2 / 2");
  });

  it("keeps event-scoped inline text drafts while navigating and never redirects them to the composer", async () => {
    const first = eventForm("event-1", "question-1", "瓶喂"), second = eventForm("event-2", "question-2", "换尿布");
    await act(async () => { render([question("event-1", first), question("event-2", second)]); });
    await act(async () => { buttonText("补充说明").props.onClick(); });
    await act(async () => root.root.findByType("textarea").props.onInput({ detail: { value: "不知道" } }));
    expect(onTextDraft).toHaveBeenCalledWith(first, "supplement", "不知道");
    textDrafts[pendingFormKey(first)] = { supplement: "不知道" };
    await act(async () => rerender([question("event-1", first), question("event-2", second)]));
    await act(async () => root.root.find(node => node.type === "button" && node.props.ariaLabel === "下一个待补充事件").props.onClick());
    await act(async () => root.root.find(node => node.type === "button" && node.props.ariaLabel === "上一个待补充事件").props.onClick());
    expect(root.root.findByType("textarea").props.value).toBe("不知道");
    await act(async () => rerender([question("event-1", first)]));
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit.mock.calls[0]![0][0]).toMatchObject({ question: { id: "question-1" }, text: "补充说明：不知道" });
    expect(onConversation).not.toHaveBeenCalled();
  });

  it("mounts no blank editor, rejects an unselected form, and records explicit shortcuts", async () => {
    const form = eventForm("event-1", "question-1", "BOTTLE");
    await act(async () => { render([question("event-1", form)]); });
    const inputs = root.root.findAll(node => node.type === "input");
    expect(inputs).toHaveLength(0);
    expect(root.root.findAll(node => String(node.type) === "picker")).toHaveLength(0);
    expect(onDraft).not.toHaveBeenCalled();

    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(root.root.findAll(node => node.props.className === "bubu-chat-form-error")).toHaveLength(1);

    await act(async () => { buttonText("15 分钟").props.onClick(); });
    expect(onDraft).toHaveBeenCalledTimes(1);
    expect(onDraft).toHaveBeenNthCalledWith(1, form, { fields: { durationMinutes: { kind: "value", value: 15 } }, progress: "ended" });
    onDraft.mock.calls.forEach(([draftForm, draft]) => { drafts = { ...drafts, [pendingFormKey(draftForm)]: draft }; });
    await act(async () => { rerender([question("event-1", form)]); });

    await act(async () => { buttonText("90 ml").props.onClick(); });
    expect(onDraft).toHaveBeenCalledTimes(2);
    expect(onDraft).toHaveBeenNthCalledWith(2, form, {
      fields: {
        durationMinutes: { kind: "value", value: 15 },
        milkAmount: { kind: "value", value: 90 },
      },
      progress: "ended",
    });
  });

  it("opens focused custom editors only on request and reports stable focus anchors", async () => {
    const first = eventForm("event-1", "question-1", "BOTTLE"), second = eventForm("event-2", "question-2", "PUMP");
    await act(async () => { render([question("event-1", first), question("event-2", second)]); });
    expect(root.root.findAll(node => node.type === "input")).toHaveLength(0);
    await act(async () => { buttonAria("时长自定义").props.onClick(); });
    onDraft.mock.calls.forEach(([draftForm, draft]) => { drafts = { ...drafts, [pendingFormKey(draftForm)]: draft }; });
    await act(async () => rerender([question("event-1", first), question("event-2", second)]));
    await act(async () => { buttonAria("实际喝入奶量自定义").props.onClick(); });
    onDraft.mock.calls.forEach(([draftForm, draft]) => { drafts = { ...drafts, [pendingFormKey(draftForm)]: draft }; });
    await act(async () => rerender([question("event-1", first), question("event-2", second)]));
    const inputs = root.root.findAll(node => node.type === "input");
    expect(inputs).toHaveLength(2);
    expect(inputs.every(input => input.props.adjustPosition === false)).toBe(true);
    expect(inputs.every(input => input.props.focus === true)).toBe(true);

    const duration = inputs.find(input => input.props.ariaLabel === "时长分钟")!;
    const durationAnchor = root.root.find(node => node.props.className === "bubu-chat-form-field" && node.props.id?.endsWith("-durationMinutes")).props.id;
    await act(async () => duration.props.onFocus());
    expect(onFieldFocus).toHaveBeenLastCalledWith(durationAnchor);
    await act(async () => duration.props.onBlur());
    expect(onFieldBlur).toHaveBeenLastCalledWith(durationAnchor);

    const milk = inputs.find(input => input.props.ariaLabel !== "时长分钟")!;
    const milkAnchor = root.root.find(node => node.props.className === "bubu-chat-form-field" && node.props.id?.endsWith("-milkAmount")).props.id;
    expect(milkAnchor).not.toBe(durationAnchor);
    await act(async () => milk.props.onFocus());
    expect(onFieldFocus).toHaveBeenLastCalledWith(milkAnchor);
    await act(async () => root.root.find(node => node.type === "button" && node.props.ariaLabel === "下一个待补充事件").props.onClick());
    expect(onFormChange).toHaveBeenCalled();
  });

  it("opens and submits a custom numeric answer without retaining a hidden shortcut", async () => {
    const form: PendingEventForm = {
      eventId: "event-custom", eventVersion: 2, questionId: "question-custom", questionVersion: 1,
      title: "BOTTLE", activityType: "BOTTLE", knownSummary: "", conflictMessages: [], duplicateCandidateIds: [],
      controls: [{ field: "milkAmount", kind: "number", label: "实际喝入奶量", unit: "ml", allowUnknown: true }],
    };
    await act(async () => { render([question("event-custom", form)]); });
    expect(root.root.findAll(node => node.type === "input")).toHaveLength(0);

    await act(async () => { buttonText("120 ml").props.onClick(); });
    drafts[pendingFormKey(form)] = onDraft.mock.calls.at(-1)![1];
    await act(async () => rerender([question("event-custom", form)]));
    await act(async () => { buttonAria("实际喝入奶量自定义").props.onClick(); });
    expect(onDraft.mock.calls.at(-1)![1]).toEqual({ fields: {} });
    drafts[pendingFormKey(form)] = onDraft.mock.calls.at(-1)![1];
    await act(async () => rerender([question("event-custom", form)]));

    const input = root.root.findByType("input");
    expect(input.props.value).toBe("");
    await act(async () => input.props.onInput({ detail: { value: "137" } }));
    drafts[pendingFormKey(form)] = onDraft.mock.calls.at(-1)![1];
    await act(async () => rerender([question("event-custom", form)]));
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit.mock.calls.at(-1)![0][0]).toMatchObject({ question: { id: "question-custom" }, formAnswer: { facts: { milkAmount: 137 } } });
  });

  it("keeps ongoing separate and sends explicit unknown through the inline natural-language path", async () => {
    const form: PendingEventForm = {
      eventId: "event-duration", eventVersion: 2, questionId: "question-duration", questionVersion: 1,
      title: "SLEEP", activityType: "SLEEP", knownSummary: "", conflictMessages: [], duplicateCandidateIds: [],
      controls: [{ field: "durationMinutes", kind: "duration", label: "时长", unit: "minutes", allowUnknown: true }], progressControl: progress,
    };
    drafts[pendingFormKey(form)] = { fields: { durationMinutes: { kind: "value", value: 60 }, endTime: { kind: "timestamp", date: "2026-11-13", time: "20:00" } }, progress: "ended" };
    await act(async () => { render([question("event-duration", form)]); });
    await act(async () => { buttonText("仍在进行").props.onClick(); });
    expect(onDraft.mock.calls.at(-1)![1]).toEqual({ fields: {}, progress: "ongoing" });
    drafts[pendingFormKey(form)] = onDraft.mock.calls.at(-1)![1];
    await act(async () => rerender([question("event-duration", form)]));
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit.mock.calls.at(-1)![0][0].formAnswer).toEqual({ facts: {}, states: { durationMinutes: "unknown" }, progress: "ongoing" });

    await act(async () => { buttonText("补充说明").props.onClick(); });
    await act(async () => root.root.findByType("textarea").props.onInput({ detail: { value: "不知道" } }));
    textDrafts[pendingFormKey(form)] = { supplement: "不知道" };
    await act(async () => rerender([question("event-duration", form)]));
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit.mock.calls.at(-1)![0][0]).toMatchObject({ question: { id: "question-duration" }, text: "进行状态：仍在进行\n补充说明：不知道" });
  });

  it("uses server numeric options instead of generic examples and never preselects one", async () => {
    const form: PendingEventForm = {
      eventId: "event-server", eventVersion: 2, questionId: "question-server", questionVersion: 1,
      title: "SLEEP", activityType: "SLEEP", knownSummary: "", conflictMessages: [], duplicateCandidateIds: [],
      controls: [{ field: "durationMinutes", kind: "duration", label: "时长", unit: "minutes", allowUnknown: true,
        options: [{ label: "宝宝常用 7 分钟", value: "7" }, { label: "宝宝常用 13 分钟", value: "13" }] }], progressControl: progress,
    };
    await act(async () => { render([question("event-server", form)]); });
    expect(buttonText("宝宝常用 7 分钟")).toBeTruthy();
    expect(buttonText("宝宝常用 13 分钟")).toBeTruthy();
    expect(root.root.findAll(node => node.type === "button" && nodeText(node) === "30 分钟")).toHaveLength(0);
    expect(root.root.findAll(node => String(node.props.className).includes("bubu-chat-choice selected"))).toHaveLength(0);
    expect(onDraft).not.toHaveBeenCalled();

    await act(async () => { buttonText("宝宝常用 13 分钟").props.onClick(); });
    drafts[pendingFormKey(form)] = onDraft.mock.calls.at(-1)![1];
    await act(async () => rerender([question("event-server", form)]));
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit.mock.calls.at(-1)![0][0].formAnswer).toEqual({ facts: { durationMinutes: 13 }, progress: "ended" });
  });

  it("uses distinct generic duration choices for each duration activity", async () => {
    const expected: Record<string, string[]> = {
      BREASTFEED: ["5 分钟", "10 分钟", "15 分钟", "20 分钟", "30 分钟"],
      SLEEP: ["30 分钟", "60 分钟", "90 分钟", "120 分钟"],
      HEAD_LIFT: ["1 分钟", "3 分钟", "5 分钟", "10 分钟"],
      OUTDOOR: ["15 分钟", "30 分钟", "45 分钟", "60 分钟"],
    };
    for (const [activityType, labels] of Object.entries(expected)) {
      const form: PendingEventForm = {
        eventId: `event-${activityType}`, eventVersion: 2, questionId: `question-${activityType}`, questionVersion: 1,
        title: activityType, activityType, knownSummary: "", conflictMessages: [], duplicateCandidateIds: [],
        controls: [{ field: "durationMinutes", kind: "duration", label: "时长", unit: "minutes", allowUnknown: true }], progressControl: progress,
      };
      await act(async () => { if (root) root.unmount(); render([question(form.eventId, form)]); });
      const labelsInForm = root.root.findAll(node => node.type === "button" && String(node.props.className).startsWith("bubu-chat-choice")).map(nodeText).filter(label => label !== "自定义");
      expect(labelsInForm).toEqual(labels);
      expect(onDraft).not.toHaveBeenCalled();
    }
  });

  it("restores custom zero and false drafts after a remount without converting either value", async () => {
    const form: PendingEventForm = {
      eventId: "event-recovery", eventVersion: 2, questionId: "question-recovery", questionVersion: 1,
      title: "BOTTLE", activityType: "BOTTLE", knownSummary: "", conflictMessages: [], duplicateCandidateIds: [], controls: [
        { field: "burpSuccess", kind: "boolean", label: "拍嗝结果", options: [{ label: "是", value: "true" }, { label: "否", value: "false" }], allowUnknown: true },
        { field: "milkAmount", kind: "number", label: "实际喝入奶量", unit: "ml", allowUnknown: true },
      ],
    };
    drafts[pendingFormKey(form)] = { fields: { burpSuccess: { kind: "value", value: false }, milkAmount: { kind: "value", value: "0" } } };
    await act(async () => { render([question("event-recovery", form)]); });
    expect(root.root.findByType("input").props.value).toBe("0");
    expect(buttonText("否").props.className).toContain("selected");
    expect(onDraft).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); render([question("event-recovery", form)]); });
    expect(root.root.findByType("input").props.value).toBe("0");
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit.mock.calls.at(-1)![0][0].formAnswer).toEqual({ facts: { burpSuccess: false, milkAmount: 0 } });
  });

  it("uses only an authoritative message timestamp and otherwise requires a custom time choice", async () => {
    const control = { field: "startTime" as const, kind: "timestamp" as const, label: "发生时间", allowUnknown: true as const };
    const form: PendingEventForm = {
      eventId: "event-time", eventVersion: 2, questionId: "question-time", questionVersion: 1,
      title: "BATH", activityType: "BATH", sourceSentAt: "2026-11-13T12:34:00.000Z", knownSummary: "", conflictMessages: [], duplicateCandidateIds: [], controls: [control],
    };
    await act(async () => { render([question("event-time", form)]); });
    expect(buttonText("按原消息时间")).toBeTruthy();
    expect(root.root.findAll(node => String(node.type) === "picker")).toHaveLength(0);
    await act(async () => { buttonText("按原消息时间").props.onClick(); });
    drafts[pendingFormKey(form)] = onDraft.mock.calls.at(-1)![1];
    await act(async () => rerender([question("event-time", form)]));
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit.mock.calls.at(-1)![0][0].formAnswer).toEqual({ facts: { startTime: "2026-11-13T20:34:00.000+08:00" } });

    const unknownTime = { ...form, eventId: "event-no-time", questionId: "question-no-time", sourceSentAt: undefined };
    onDraft.mockClear();
    await act(async () => { root.unmount(); render([question("event-no-time", unknownTime)]); });
    expect(root.root.findAll(node => node.type === "button" && nodeText(node) === "按原消息时间")).toHaveLength(0);
    expect(buttonText("自定义")).toBeTruthy();
    expect(root.root.findAll(node => node.type === "button" && nodeText(node) === "不知道")).toHaveLength(0);
    expect(root.root.findAll(node => String(node.type) === "picker")).toHaveLength(0);
  });

  it("opens custom date and time pickers and submits their exact Shanghai value", async () => {
    const form: PendingEventForm = {
      eventId: "event-picker", eventVersion: 2, questionId: "question-picker", questionVersion: 1,
      title: "BATH", activityType: "BATH", knownSummary: "", conflictMessages: [], duplicateCandidateIds: [],
      controls: [{ field: "startTime", kind: "timestamp", label: "发生时间", allowUnknown: true }],
    };
    await act(async () => { render([question("event-picker", form)]); });
    await act(async () => { buttonText("自定义").props.onClick(); });
    drafts[pendingFormKey(form)] = onDraft.mock.calls.at(-1)![1];
    await act(async () => rerender([question("event-picker", form)]));
    let pickers = root.root.findAll(node => String(node.type) === "picker");
    expect(pickers).toHaveLength(2);
    await act(async () => pickers.find(picker => picker.props.mode === "date")!.props.onChange({ detail: { value: "2026-11-14" } }));
    drafts[pendingFormKey(form)] = onDraft.mock.calls.at(-1)![1];
    await act(async () => rerender([question("event-picker", form)]));
    pickers = root.root.findAll(node => String(node.type) === "picker");
    await act(async () => pickers.find(picker => picker.props.mode === "time")!.props.onChange({ detail: { value: "08:09" } }));
    drafts[pendingFormKey(form)] = onDraft.mock.calls.at(-1)![1];
    await act(async () => rerender([question("event-picker", form)]));
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit.mock.calls.at(-1)![0][0].formAnswer).toEqual({ facts: { startTime: "2026-11-14T08:09:00.000+08:00" } });
  });

  it("sends selected structured values and field-scoped custom text in one version-bound answer", async () => {
    const form: PendingEventForm = {
      eventId: "event-mixed", eventVersion: 2, questionId: "question-mixed", questionVersion: 1,
      title: "BOTTLE", activityType: "BOTTLE", knownSummary: "[测试记录] 混合补充", conflictMessages: [], duplicateCandidateIds: [], controls: [
        { field: "milkSource", kind: "enum", label: "奶的来源", allowUnknown: true, options: [{ label: "母乳", value: "BREAST_MILK" }, { label: "配方奶", value: "FORMULA" }] },
        { field: "milkAmount", kind: "number", label: "实际喝入奶量", unit: "ml", allowUnknown: true },
      ],
    };
    await act(async () => { render([question("event-mixed", form)]); });
    expect(texts("bubu-chat-step-meta")).toContain("[测试记录] 混合补充");
    await act(async () => { buttonText("150 ml").props.onClick(); });
    drafts[pendingFormKey(form)] = onDraft.mock.calls.at(-1)![1];
    await act(async () => rerender([question("event-mixed", form)]));
    await act(async () => { buttonAria("奶的来源自定义").props.onClick(); });
    expect(onDraft.mock.calls.at(-1)![1]).toEqual({ fields: { milkAmount: { kind: "value", value: 150 } } });
    await act(async () => root.root.findByType("textarea").props.onInput({ detail: { value: "羊奶" } }));
    expect(onTextDraft).toHaveBeenCalledWith(form, "milkSource", "羊奶");
    textDrafts[pendingFormKey(form)] = { milkSource: "羊奶" };
    await act(async () => rerender([question("event-mixed", form)]));
    await act(async () => { buttonText("补充说明").props.onClick(); });
    expect(root.root.findByType("textarea").props.value).toBe("");
    await act(async () => { buttonAria("奶的来源自定义").props.onClick(); });
    expect(root.root.findByType("textarea").props.value).toBe("羊奶");
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0][0]).toMatchObject({ question: { id: "question-mixed", questionVersion: 1, eventVersion: 2 }, text: "实际喝入奶量：150 ml\n奶的来源：羊奶" });
    expect(onConversation).not.toHaveBeenCalled();
  });

  it("drops only superseded same-field custom text before the single save", async () => {
    const form: PendingEventForm = {
      eventId: "event-supersede", eventVersion: 2, questionId: "question-supersede", questionVersion: 1,
      title: "BOTTLE", activityType: "BOTTLE", knownSummary: "", conflictMessages: [], duplicateCandidateIds: [], controls: [
        { field: "milkSource", kind: "enum", label: "奶的来源", allowUnknown: true, options: [{ label: "母乳", value: "BREAST_MILK" }, { label: "配方奶", value: "FORMULA" }] },
        { field: "milkAmount", kind: "number", label: "实际喝入奶量", unit: "ml", allowUnknown: true },
      ],
    };
    const key = pendingFormKey(form);
    drafts[key] = { fields: { milkAmount: { kind: "value", value: 150 } } };
    textDrafts[key] = { milkSource: "羊奶", supplement: "夜间补充" };
    await act(async () => { render([question("event-supersede", form)]); });
    await act(async () => { buttonText("配方奶").props.onClick(); });
    expect(onTextDraft).toHaveBeenCalledWith(form, "milkSource", "");
    expect(onTextDraft).not.toHaveBeenCalledWith(form, "supplement", "");
    drafts[key] = onDraft.mock.calls.at(-1)![1];
    textDrafts[key] = { supplement: "夜间补充" };
    await act(async () => rerender([question("event-supersede", form)]));
    await act(async () => { buttonText("提交 1 项").props.onClick(); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sent = onSubmit.mock.calls[0]![0][0].text as string;
    expect(sent).toContain("奶的来源：配方奶");
    expect(sent).toContain("实际喝入奶量：150 ml");
    expect(sent).toContain("补充说明：夜间补充");
    expect(sent).not.toContain("羊奶");

    onTextDraft.mockClear();
    textDrafts[key] = { milkAmount: "旧奶量文本", supplement: "仍然保留" };
    await act(async () => rerender([question("event-supersede", form)]));
    await act(async () => { buttonAria("实际喝入奶量自定义").props.onClick(); });
    expect(onTextDraft).toHaveBeenCalledWith(form, "milkAmount", "");
    expect(onTextDraft).not.toHaveBeenCalledWith(form, "supplement", "");
  });

  it("keeps long enum choices as wrapping pills and hides activity selection when activity is known", async () => {
    const form: PendingEventForm = {
      eventId: "event-enum", eventVersion: 2, questionId: "question-enum", questionVersion: 1,
      title: "SUPPLEMENT", activityType: "SUPPLEMENT", knownSummary: "", conflictMessages: [], duplicateCandidateIds: [], controls: [
        { field: "type", kind: "enum", label: "活动类型", allowUnknown: true, options: [{ label: "补剂", value: "SUPPLEMENT" }] },
        { field: "supplementType", kind: "enum", label: "补剂类型", allowUnknown: true, options: Array.from({ length: 7 }, (_, index) => ({ label: `选项 ${index + 1}`, value: `OPTION_${index + 1}` })) },
      ],
    };
    await act(async () => { render([question("event-enum", form)]); });
    expect(root.root.findAll(node => String(node.type) === "picker")).toHaveLength(0);
    expect(root.root.findAll(node => node.type === "button" && nodeText(node).startsWith("选项 "))).toHaveLength(7);
    expect(root.root.findAll(node => nodeText(node) === "活动类型")).toHaveLength(0);
    expect(root.root.findAll(node => node.type === "button" && nodeText(node) === "不知道")).toHaveLength(0);
    const enumButtons = root.root.findAll(node => node.type === "button" && String(node.props.className).startsWith("bubu-chat-choice"));
    expect(nodeText(enumButtons.at(-1)!)).toBe("自定义");
    await act(async () => { buttonAria("补剂类型自定义").props.onClick(); });
    expect(root.root.findByType("textarea").props.ariaLabel).toBe("补剂类型自定义内容");
  });

  it("renders original messages whenever source props exist, including without a known summary", async () => {
    const form = eventForm("event-1", "question-1", "瓶喂");
    const messages: EventSources = {
      babyId: "baby-2", eventId: "event-1", unavailableCount: 0,
      messages: [{ id: "message-1", kind: "chat", senderId: "sender", sentAt: "2026-11-13T12:00:00.000Z", text: "完整原文" }],
    };
    getEventSources.mockResolvedValue(messages);
    await act(async () => { render([question("event-1", form)], false, { babyId: "baby-2" }); });
    expect(root.root.findAll(node => nodeText(node).startsWith("已确认："))).toHaveLength(0);
    expect(getEventSources).not.toHaveBeenCalled();

    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(getEventSources).toHaveBeenCalledWith("baby-2", "event-1");
    expect(texts("bubu-chat-original-text")).toEqual(["完整原文"]);
  });

  it("remounts original messages when the requested event changes", async () => {
    const firstForm = eventForm("event-1", "question-1", "瓶喂"), secondForm = eventForm("event-2", "question-2", "吸奶");
    const pendingFirst = deferred<EventSources>();
    getEventSources.mockReturnValueOnce(pendingFirst.promise).mockResolvedValueOnce({
      babyId: "baby", eventId: "event-2", unavailableCount: 0, messages: [],
    });
    await act(async () => { render([question("event-1", firstForm)], false, { babyId: "baby" }); });
    await act(async () => { buttonText("查看原消息").props.onClick(); });

    await act(async () => { rerender([question("event-2", secondForm)], false, { babyId: "baby" }); });
    expect(root.root.findAll(node => node.props.className === "bubu-chat-original-body")).toHaveLength(0);
    await act(async () => { pendingFirst.resolve({ babyId: "baby", eventId: "event-1", unavailableCount: 0, messages: [] }); });
    expect(root.root.findAll(node => node.props.className === "bubu-chat-original-body")).toHaveLength(0);

    await act(async () => { buttonText("查看原消息").props.onClick(); });
    expect(getEventSources).toHaveBeenNthCalledWith(2, "baby", "event-2");
  });
});
