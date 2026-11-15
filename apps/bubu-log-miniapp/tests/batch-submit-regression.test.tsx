import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tarojs/components", () => ({ Button: "button", Input: "input", Picker: "picker", Text: "text", Textarea: "textarea", View: "view" }));
vi.mock("../src/api", () => ({ api: { getEventSources: vi.fn() }, ApiError: class ApiError extends Error {} }));

import { ChatDraftStore, type ChatRequest } from "../src/chat/drafts";
import { pendingFormKey, type PendingFormDraft } from "../src/chat/form";
import { PendingFormStepper } from "../src/chat/PendingFormStepper";
import { ChatSession } from "../src/chat/session";
import type { ChatHistory, ChatPending, ChatTurn, FieldPending, PendingEventForm, ReplyQuestion } from "../src/chat/contracts";
import type { ChoiceAnswerRef } from "../src/chat/drafts";

const babyId = "baby-regression", identityId = "caregiver-regression";
const now = "2026-11-15T01:00:00.000Z";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => { resolve = promiseResolve; reject = promiseReject; });
  return { promise, resolve, reject };
}

function completed(input: ChatRequest, patch: Partial<ChatTurn> = {}): ChatTurn {
  return {
    id: `turn-${input.requestId}`, requestId: input.requestId, babyId, createdAt: now, updatedAt: now,
    status: "completed", input, assistantText: "已保存", receipts: [], pending: [], refreshRequired: false,
    ...patch,
  };
}

function fieldQuestion(index: number, version = 1, eventVersion = 1): FieldPending {
  const eventId = `event-${index}`, questionId = `question-${index}`;
  const form: PendingEventForm = {
    eventId, eventVersion, questionId, questionVersion: version, title: `待补事件 ${index}`, knownSummary: "",
    controls: [{ field: "burpSuccess", kind: "boolean", label: "拍嗝结果", allowUnknown: true,
      options: [{ label: "是", value: "true" }, { label: "否", value: "false" }] }],
    conflictMessages: [], duplicateCandidateIds: [],
  };
  return {
    kind: "fields", id: questionId, babyId, eventId, version, eventVersion,
    fields: ["burpSuccess"], conflicts: [], duplicateCandidates: [], state: "open", form,
  };
}

function nodeText(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray((node as { children?: unknown[] }).children)) return "";
  return (node as { children: unknown[] }).children.map(nodeText).join("");
}

afterEach(() => { vi.useRealTimers(); });

describe("pending-event batch submit regression", () => {
  it("keeps one accepted form request immutable and blocks rapid resubmission through timeout recovery", async () => {
    const values = new Map<string, unknown>();
    const store = new ChatDraftStore({
      get: key => values.get(key),
      set: (key, value) => { values.set(key, structuredClone(value)); },
      remove: key => { values.delete(key); },
    }, "regression-origin");
    const accepted = deferred<ChatTurn>();
    const api = {
      getChatHistory: vi.fn(async (): Promise<ChatHistory> => ({ babyId, conversationId: "conversation", turns: [], pending: [], pendingCount: 0, automaticMessages: [] })),
      getPending: vi.fn(async (): Promise<ChatPending[]> => []),
      getChatRequest: vi.fn(async (): Promise<ChatTurn | null> => null),
      sendChat: vi.fn((_: ChatRequest) => accepted.promise),
    };
    const session = new ChatSession(api, store, identityId, babyId, { refresh: vi.fn(), revoked: vi.fn() });
    await session.load();
    const question = fieldQuestion(1);
    const formBatch = [{ eventId: question.eventId, question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion }, formAnswer: { facts: { burpSuccess: true } } }];
    const first = session.submitFormBatch("2026-11-15", formBatch);
    const duplicate = session.submitFormBatch("2026-11-15", [{ ...formBatch[0]!, formAnswer: { facts: { burpSuccess: false } } }]);
    const original = structuredClone(store.read(identityId, babyId).pending!);

    expect(api.sendChat).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({ busy: true, draft: { pending: original } });
    session.editForm(pendingFormKey(question.form!), { fields: { burpSuccess: { kind: "value", value: false } } });
    expect(store.read(identityId, babyId).pending).toEqual(original);

    accepted.reject(new Error("response timeout"));
    await Promise.all([first, duplicate]);
    expect(session.getSnapshot()).toMatchObject({ busy: false, error: "response timeout", draft: { pending: original } });

    await session.submitFormBatch("2026-11-15", [{ ...formBatch[0]!, formAnswer: { facts: { burpSuccess: false } } }]);
    expect(api.sendChat).toHaveBeenCalledTimes(1);
    await session.recover(false);
    expect(api.getChatRequest).toHaveBeenCalledWith(babyId, original.requestId);
    expect(api.sendChat).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({ busy: false, error: "尚未查到上次发送，可以用原请求继续发送。", draft: { pending: original } });

    api.sendChat.mockResolvedValueOnce(completed(original));
    await session.recover(true);
    expect(api.sendChat).toHaveBeenCalledTimes(2);
    expect(api.sendChat.mock.calls[1]![0]).toEqual(original);
    expect(session.getSnapshot().draft.pending).toBeUndefined();
    session.dispose();
  });

  it("completes five event steps as local drafts and performs only one submit at the end", async () => {
    const pending = [1, 2, 3, 4, 5].map(index => fieldQuestion(index));
    let drafts: Record<string, PendingFormDraft> = {};
    const onSubmit = vi.fn();
    let root!: ReactTestRenderer;
    const render = () => <PendingFormStepper pending={pending} drafts={drafts} busy={false}
      onDraft={(form, draft) => { drafts = { ...drafts, [pendingFormKey(form)]: draft }; }}
      onSubmit={onSubmit} onConversation={vi.fn()} onMedia={vi.fn()} />;
    const button = (label: string) => root.root.findAll(node => node.type === "button" && nodeText(node) === label)[0]!;
    const next = () => root.root.findAll(node => node.type === "button" && node.props.ariaLabel === "下一个待补充事件")[0]!;
    const position = () => nodeText(root.root.findAll(node => node.props.className === "bubu-chat-step-count")[0]!);

    await act(async () => { root = create(render()); });
    for (let index = 0; index < pending.length; index++) {
      await act(async () => { button("是").props.onClick(); root.update(render()); });
      await act(async () => { button(index === pending.length - 1 ? "提交 5 项" : "下一步").props.onClick(); });
      if (index < pending.length - 1) {
        expect.soft(onSubmit, `event ${index + 1} must remain local`).toHaveBeenCalledTimes(0);
        expect.soft(position(), `event ${index + 1} should advance locally`).toBe(`待补充 · ${index + 2} / 5`);
        if (position() === `待补充 · ${index + 1} / 5`) await act(async () => { next().props.onClick(); });
      }
    }
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toHaveLength(5);
    expect(onSubmit.mock.calls[0]![0].map((item: { eventId: string }) => item.eventId)).toEqual(pending.map(item => item.eventId));
    root.unmount();
  });

  it("jumps to the first incomplete event at final validation and sends nothing", async () => {
    const pending = [1, 2, 3].map(index => fieldQuestion(index));
    let drafts: Record<string, PendingFormDraft> = {};
    const onSubmit = vi.fn();
    let root!: ReactTestRenderer;
    const render = () => <PendingFormStepper pending={pending} drafts={drafts} busy={false}
      onDraft={(form, draft) => { drafts = { ...drafts, [pendingFormKey(form)]: draft }; }} onSubmit={onSubmit} onConversation={vi.fn()} onMedia={vi.fn()} />;
    const position = () => nodeText(root.root.findByProps({ className: "bubu-chat-step-count" }));
    await act(async () => { root = create(render()); });
    await act(async () => root.root.findByProps({ ariaLabel: "下一个待补充事件" }).props.onClick());
    await act(async () => root.root.findByProps({ ariaLabel: "下一个待补充事件" }).props.onClick());
    await act(async () => { root.root.find(node => node.type === "button" && nodeText(node) === "是").props.onClick(); root.update(render()); });
    await act(async () => root.root.find(node => node.type === "button" && nodeText(node) === "提交 3 项").props.onClick());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(position()).toBe("待补充 · 1 / 3");
    expect(nodeText(root.root.findByProps({ className: "bubu-chat-form-error" }))).toContain("请完成这一项");
    root.unmount();
  });

  it("keeps a conflict-only choice local and includes it in the one final batch", async () => {
    const pending = fieldQuestion(1);
    pending.fields = []; pending.form = { ...pending.form!, controls: [], conflictMessages: ["可能重复"] };
    const reply: ReplyQuestion = {
      id: "pending-choice", prompt: "这两条是同一次吗？", origin: { kind: "pending", selectedEventId: pending.eventId, question: { id: pending.id, questionVersion: pending.version, eventVersion: pending.eventVersion } },
      choices: [{ id: "different-events", label: "不是同一次", action: { type: "reply", text: "不是同一次" } }, { id: "same-event-other", label: "是同一次", action: { type: "reply", text: "是同一次" } }],
    };
    let selected: Record<string, ChoiceAnswerRef> = {};
    const onSubmit = vi.fn();
    let root!: ReactTestRenderer;
    const render = () => <PendingFormStepper pending={[pending]} drafts={{}} busy={false} onDraft={vi.fn()} onSubmit={onSubmit} onConversation={vi.fn()} onMedia={vi.fn()}
      questions={[reply]} selectedChoices={selected} choiceDrafts={{}}
      onSelectChoice={(form, value) => { selected = value ? { [pendingFormKey(form)]: value } : {}; }} onChoiceDraft={vi.fn()} onSubmitChoice={vi.fn()} onAttachChoice={vi.fn()} />;
    await act(async () => { root = create(render()); });
    await act(async () => { root.root.find(node => node.type === "button" && nodeText(node) === "不是同一次").props.onClick(); root.update(render()); });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(root.root.findAll(node => node.type === "button" && nodeText(node) === "提交 1 项")).toHaveLength(1);
    await act(async () => root.root.find(node => node.type === "button" && nodeText(node) === "提交 1 项").props.onClick());
    expect(onSubmit).toHaveBeenCalledWith([expect.objectContaining({ eventId: pending.eventId, choiceAnswer: expect.objectContaining({ questionId: reply.id, choiceId: "different-events" }) })]);
    root.unmount();
  });

  it.each(["saved", "needs_information"] as const)("clears every pinned draft covered by one %s receipt", async status => {
    const values = new Map<string, unknown>();
    const store = new ChatDraftStore({ get: key => values.get(key), set: (key, value) => { values.set(key, structuredClone(value)); }, remove: key => { values.delete(key); } }, "receipt-origin");
    const questions = [fieldQuestion(1), fieldQuestion(2)];
    const api = {
      getChatHistory: vi.fn(async (): Promise<ChatHistory> => ({ babyId, conversationId: "conversation", turns: [], pending: questions, pendingCount: 2, automaticMessages: [] })),
      getPending: vi.fn(async () => questions), getChatRequest: vi.fn(async () => null),
      sendChat: vi.fn(async (input: ChatRequest) => completed(input, { receipts: [{ status, events: questions.map(question => ({ id: question.eventId, version: question.eventVersion + 1 })) }] })),
    };
    const session = new ChatSession(api, store, identityId, babyId, { refresh: vi.fn(), revoked: vi.fn() });
    await session.load();
    for (const question of questions) session.editForm(pendingFormKey(question.form!), { fields: { burpSuccess: { kind: "value", value: true } } });
    await session.submitFormBatch("2026-11-15", questions.map(question => ({
      eventId: question.eventId, question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion }, formAnswer: { facts: { burpSuccess: true } },
    })));
    expect(api.sendChat).toHaveBeenCalledOnce();
    expect(store.read(identityId, babyId).formDrafts).toBeUndefined();
    session.dispose();
  });

  it("keeps every answer for one projection-pending receipt and reuses the original request", async () => {
    const values = new Map<string, unknown>();
    const store = new ChatDraftStore({ get: key => values.get(key), set: (key, value) => { values.set(key, structuredClone(value)); }, remove: key => { values.delete(key); } }, "projection-origin");
    const questions = [fieldQuestion(1), fieldQuestion(2)];
    const api = {
      getChatHistory: vi.fn(async (): Promise<ChatHistory> => ({ babyId, conversationId: "conversation", turns: [], pending: questions, pendingCount: 2, automaticMessages: [] })),
      getPending: vi.fn(async () => questions), getChatRequest: vi.fn(async () => null),
      sendChat: vi.fn(async (input: ChatRequest) => completed(input, { status: "needs_recovery", receipts: [{ status: "pending_projection", events: questions.map(question => ({ id: question.eventId, version: question.eventVersion + 1 })) }], batchProgress: { total: 2, completed: 0 } })),
    };
    const session = new ChatSession(api, store, identityId, babyId, { refresh: vi.fn(), revoked: vi.fn() });
    await session.load();
    for (const question of questions) session.editForm(pendingFormKey(question.form!), { fields: { burpSuccess: { kind: "value", value: true } } });
    await session.submitFormBatch("2026-11-15", questions.map(question => ({ eventId: question.eventId, question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion }, formAnswer: { facts: { burpSuccess: true } } })));
    const original = store.read(identityId, babyId).pending!;
    expect(Object.keys(store.read(identityId, babyId).formDrafts ?? {})).toHaveLength(2);
    await session.recover(true);
    expect(api.sendChat.mock.calls.map(call => call[0].requestId)).toEqual([original.requestId, original.requestId]);
    expect(Object.keys(store.read(identityId, babyId).formDrafts ?? {})).toHaveLength(2);
    session.dispose();
  });

  it("keeps a completed but unconfirmed batch recoverable through load and session recreation", async () => {
    const values = new Map<string, unknown>();
    const store = new ChatDraftStore({ get: key => values.get(key), set: (key, value) => { values.set(key, structuredClone(value)); }, remove: key => { values.delete(key); } }, "completed-conflict-origin");
    const originalQuestions = [fieldQuestion(1), fieldQuestion(2)];
    const currentQuestions = [fieldQuestion(1, 2, 2), fieldQuestion(2, 2, 2)];
    let latestQuestions = originalQuestions;
    let turns: ChatTurn[] = [];
    const api = {
      getChatHistory: vi.fn(async (): Promise<ChatHistory> => ({ babyId, conversationId: "conversation", turns, pending: latestQuestions, pendingCount: latestQuestions.length, automaticMessages: [] })),
      getPending: vi.fn(async () => latestQuestions), getChatRequest: vi.fn(async () => null),
      sendChat: vi.fn(async (input: ChatRequest) => {
        const result = completed(input, {
          assistantText: "全部保存好了",
          receipts: [{ status: "conflict", events: currentQuestions.map(question => ({ id: question.eventId, version: question.eventVersion })) }],
          pending: currentQuestions,
        });
        latestQuestions = currentQuestions; turns = [result]; return result;
      }),
    };
    const callbacks = { refresh: vi.fn(), revoked: vi.fn() };
    const session = new ChatSession(api, store, identityId, babyId, callbacks);
    await session.load();
    for (const question of originalQuestions) session.editForm(pendingFormKey(question.form!), { fields: { burpSuccess: { kind: "value", value: question.eventId === "event-1" } } }, {
      eventId: question.eventId, questionId: question.id, questionVersion: question.version, eventVersion: question.eventVersion, fields: ["burpSuccess"],
    });
    await session.submitFormBatch("2026-11-15", originalQuestions.map(question => ({
      eventId: question.eventId, question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion }, formAnswer: { facts: { burpSuccess: true } },
    })));
    expect(store.read(identityId, babyId)).toMatchObject({ reviewFormDrafts: true });
    expect(store.read(identityId, babyId).pending).toBeUndefined();
    expect(Object.keys(store.read(identityId, babyId).formDrafts ?? {})).toHaveLength(2);
    expect(session.getSnapshot().notice).toContain("没有全部确认");

    await session.load();
    expect(Object.keys(store.read(identityId, babyId).formDrafts ?? {}).sort()).toEqual(currentQuestions.map(question => pendingFormKey(question.form!)).sort());
    expect(store.read(identityId, babyId).reviewFormDrafts).toBe(true);
    session.dispose();

    const recreated = new ChatSession(api, store, identityId, babyId, callbacks);
    await recreated.load();
    expect(recreated.getSnapshot().draft.pending).toBeUndefined();
    expect(recreated.getSnapshot().draft.reviewFormDrafts).toBe(true);
    expect(Object.keys(recreated.getSnapshot().draft.formDrafts ?? {}).sort()).toEqual(currentQuestions.map(question => pendingFormKey(question.form!)).sort());
    expect(recreated.getSnapshot().notice).toContain("原答案已保留");
    recreated.dispose();
  });

  it("preserves and safely rebinds failed batch drafts after release and reload", async () => {
    const values = new Map<string, unknown>();
    const store = new ChatDraftStore({ get: key => values.get(key), set: (key, value) => { values.set(key, structuredClone(value)); }, remove: key => { values.delete(key); } }, "stale-origin");
    const originalQuestions = [fieldQuestion(1), fieldQuestion(2)];
    const currentQuestions = [fieldQuestion(1, 2, 2), fieldQuestion(2, 2, 2)];
    let latestQuestions = originalQuestions;
    let turns: ChatTurn[] = [];
    const api = {
      getChatHistory: vi.fn(async (): Promise<ChatHistory> => ({ babyId, conversationId: "conversation", turns, pending: latestQuestions, pendingCount: 2, automaticMessages: [] })),
      getPending: vi.fn(async () => latestQuestions), getChatRequest: vi.fn(async () => null),
      sendChat: vi.fn(async (input: ChatRequest) => {
        const failed = completed(input, { status: "failed", receipts: [{ status: "conflict", events: currentQuestions.map(question => ({ id: question.eventId, version: question.eventVersion })) }], pending: currentQuestions, error: { code: "QUESTION_STALE", message: "问题已更新", retryable: false } });
        latestQuestions = currentQuestions; turns = [failed]; return failed;
      }),
    };
    const session = new ChatSession(api, store, identityId, babyId, { refresh: vi.fn(), revoked: vi.fn() });
    await session.load();
    for (const question of originalQuestions) session.editForm(pendingFormKey(question.form!), { fields: { burpSuccess: { kind: "value", value: question.eventId === "event-1" } } }, {
      eventId: question.eventId, questionId: question.id, questionVersion: question.version, eventVersion: question.eventVersion, fields: ["burpSuccess"],
    });
    await session.submitFormBatch("2026-11-15", originalQuestions.map(question => ({ eventId: question.eventId, question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion }, formAnswer: { facts: { burpSuccess: true } } })));
    session.releaseRejected();
    await session.load();
    expect(store.read(identityId, babyId).pending).toBeUndefined();
    expect(Object.keys(store.read(identityId, babyId).formDrafts ?? {}).sort()).toEqual(currentQuestions.map(question => pendingFormKey(question.form!)).sort());
    expect(session.getSnapshot().notice).toContain("原答案已保留");
    session.dispose();
  });
});
