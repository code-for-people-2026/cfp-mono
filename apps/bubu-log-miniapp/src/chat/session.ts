import { ApiError, type BubuApi } from "../api/client";
import type { AutomaticActivityMessage, ChatPending, ChatTurn, FieldPending, FirstWeekNotice, ReplyChoice, ReplyQuestion, StructuredFormAnswer } from "./contracts";
import { ChatDraftStore, emptyDraft, newRequestId, replyChoiceKey, type ChatDraft, type ChatRequest, type ChoiceAnswerRef, type FormBatchItem, type FormDraftBinding } from "./drafts";
import { isPendingFormDraft, pendingQuestionKey, type PendingFormDraft } from "./form";

type ChatApi = Pick<BubuApi, "getChatHistory" | "getPending" | "getChatRequest" | "sendChat">;
export interface ChatState {
  draft: ChatDraft; history: ChatTurn[]; automaticMessages: AutomaticActivityMessage[]; pending: ChatPending[]; replyQuestions: ReplyQuestion[];
  firstWeekNotice?: FirstWeekNotice;
  loading: boolean; busy: boolean; confirming: boolean; error: string; notice: string;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "暂时没有完成，请重试。";
const cloneFormAnswer = (answer: StructuredFormAnswer): StructuredFormAnswer => ({
  facts: { ...answer.facts },
  ...(answer.states ? { states: { ...answer.states } } : {}),
  ...(answer.progress ? { progress: answer.progress } : {}),
  ...(answer.milkItemAnswers ? { milkItemAnswers: answer.milkItemAnswers.map(item => ({
    milkItemId: item.milkItemId,
    ...(item.facts ? { facts: { ...item.facts } } : {}),
    ...(item.states ? { states: { ...item.states } } : {}),
  })) } : {}),
});

/** Owns recoverable submission state independently from the collapsible sheet. */
export class ChatSession {
  private state: ChatState;
  private listeners = new Set<() => void>();
  private alive = true;
  private locked = false;
  private readVersion = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private refreshes = new Set<string>();
  private completedRequests = new Set<string>();

  constructor(private readonly api: ChatApi, private readonly store: ChatDraftStore, readonly identityId: string, readonly babyId: string,
    private readonly callbacks: { refresh(): void; revoked(error: ApiError): void }) {
    this.state = { draft: store.read(identityId, babyId), history: [], automaticMessages: [], pending: [], replyQuestions: [], loading: true, busy: false, confirming: false, error: "", notice: "" };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<ChatState>) { if (!this.alive) return; this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()); }
  private save(draft: ChatDraft, confirmed = false): boolean {
    if (!this.alive) return false;
    try { this.store.save(this.identityId, this.babyId, draft); this.update({ draft }); return true; }
    catch { this.update({ error: confirmed ? "这次发送已确认，但本机草稿暂时无法清理；请再次确认上次发送，不必重复录入。" : "草稿暂时无法保存，请检查设备存储后重试；尚未发送。" }); return false; }
  }

  edit(change: Partial<ChatDraft>): void { if (!this.state.draft.pending && !this.locked) this.save({ ...this.state.draft, ...change }); }
  editForm(key: string, value: PendingFormDraft, binding?: FormDraftBinding): void {
    if (this.state.draft.pending || this.locked || !isPendingFormDraft(value)) return;
    const formDrafts = { ...(this.state.draft.formDrafts ?? {}), [key]: value };
    this.save({ ...this.state.draft, formDrafts, ...(binding ? { formDraftBindings: { ...(this.state.draft.formDraftBindings ?? {}), [key]: binding } } : {}) });
  }
  editFormText(key: string, context: string, text: string, binding?: FormDraftBinding): void {
    if (!this.alive || this.state.draft.pending || this.locked || text.length > 6000) return;
    const current = this.state.draft.formTextDrafts ?? {};
    const currentForm = current[key] ?? {};
    const nextForm = text ? { ...currentForm, [context]: text } : Object.fromEntries(Object.entries(currentForm).filter(([entry]) => entry !== context));
    const formTextDrafts = Object.keys(nextForm).length ? { ...current, [key]: nextForm } : Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key));
    this.save({ ...this.state.draft, formTextDrafts: Object.keys(formTextDrafts).length ? formTextDrafts : undefined, ...(binding ? { formDraftBindings: { ...(this.state.draft.formDraftBindings ?? {}), [key]: binding } } : {}) });
  }
  selectChoice(value?: ChoiceAnswerRef): boolean {
    if (this.state.draft.pending || this.locked) return false;
    return this.save({ ...this.state.draft, selectedChoice: value });
  }
  editChoice(value: ChoiceAnswerRef, text: string): void {
    if (this.state.draft.pending || this.locked || text.length > 6000) return;
    this.save({ ...this.state.draft, selectedChoice: value, choiceDrafts: { ...(this.state.draft.choiceDrafts ?? {}), [replyChoiceKey(value)]: text } });
  }
  selectFormChoice(key: string, value?: ChoiceAnswerRef, binding?: FormDraftBinding): boolean {
    if (this.state.draft.pending || this.locked) return false;
    const current = this.state.draft.batchChoices ?? {};
    const batchChoices = value ? { ...current, [key]: value } : Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key));
    return this.save({ ...this.state.draft, batchChoices: Object.keys(batchChoices).length ? batchChoices : undefined, ...(binding ? { formDraftBindings: { ...(this.state.draft.formDraftBindings ?? {}), [key]: binding } } : {}) });
  }
  editFormChoice(value: ChoiceAnswerRef, text: string): void {
    if (this.state.draft.pending || this.locked || text.length > 6000) return;
    this.save({ ...this.state.draft, choiceDrafts: { ...(this.state.draft.choiceDrafts ?? {}), [replyChoiceKey(value)]: text } });
  }
  selectTarget(change: Pick<ChatDraft, "selectedEventId" | "selectedLabel" | "question" | "mediaPendingId">): boolean {
    if (this.state.draft.pending || this.locked) { this.update({ error: "请先确认上次发送，再切换要修改的记录。" }); return false; }
    return this.save({ ...this.state.draft, selectedEventId: undefined, selectedLabel: undefined, question: undefined, mediaPendingId: undefined, ...change });
  }

  private failure(error: unknown) {
    if (!this.alive) return;
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      if (error.status === 401) this.store.clear(); else this.store.clearBaby(this.babyId);
      this.update({ draft: emptyDraft(), history: [], automaticMessages: [], pending: [], replyQuestions: [], firstWeekNotice: undefined, error: error.message, notice: "", busy: false, confirming: false });
      this.dispose(); this.callbacks.revoked(error); return;
    }
    this.update({ error: errorMessage(error), notice: "" });
  }

  private exactPending(raw: ChatPending, enriched: ChatPending[]): ChatPending | undefined {
    return enriched.find(value => value.id === raw.id && value.kind === raw.kind && value.state === raw.state
      && (raw.kind === "media" || (value.kind === "fields" && raw.kind === "fields" && value.version === raw.version && value.eventVersion === raw.eventVersion)));
  }

  private retainPrivateDraft(pending: ChatPending[]): { draft: ChatDraft; notice: string } {
    const draft = this.state.draft, active = draft.pending;
    // Raw question pins—not optional presentation metadata—decide whether an
    // unsent form is still current. A read race must not erase user input.
    const allowedForms = new Set(pending.flatMap(item => item.kind === "fields" ? [pendingQuestionKey(item.id, item.version, item.eventId, item.eventVersion)] : []));
    if (active?.question && active.context.selectedEventId) {
      allowedForms.add(pendingQuestionKey(active.question.id, active.question.questionVersion, active.context.selectedEventId, active.question.eventVersion));
    }
    for (const item of active?.formBatch ?? []) allowedForms.add(pendingQuestionKey(item.question.id, item.question.questionVersion, item.eventId, item.question.eventVersion));
    const exactQuestion = !!draft.question && pending.some(item => item.kind === "fields" && item.id === draft.question?.id && item.version === draft.question?.questionVersion && item.eventVersion === draft.question?.eventVersion);
    const needsQuestionReset = !!draft.question && !exactQuestion && !active;
    const formDrafts = { ...(draft.formDrafts ?? {}) }, formTextDrafts = { ...(draft.formTextDrafts ?? {}) };
    const batchChoices = { ...(draft.batchChoices ?? {}) }, bindings = { ...(draft.formDraftBindings ?? {}) };
    const staleKeys = () => [...new Set([...Object.keys(formDrafts), ...Object.keys(formTextDrafts), ...Object.keys(batchChoices)])].filter(key => !allowedForms.has(key));
    let rebound = 0;
    if (draft.reviewFormDrafts) for (const oldKey of staleKeys()) {
      const binding = bindings[oldKey];
      const current = binding && pending.find((item): item is FieldPending => item.kind === "fields" && item.eventId === binding.eventId
        && item.fields.length === binding.fields.length && item.fields.every(field => binding.fields.includes(field)));
      if (!binding || !current) continue;
      const newKey = pendingQuestionKey(current.id, current.version, current.eventId, current.eventVersion);
      if (formDrafts[oldKey] && formDrafts[newKey] || formTextDrafts[oldKey] && formTextDrafts[newKey] || batchChoices[oldKey] && batchChoices[newKey]) continue;
      if (formDrafts[oldKey]) formDrafts[newKey] = formDrafts[oldKey]!;
      if (formTextDrafts[oldKey]) formTextDrafts[newKey] = formTextDrafts[oldKey]!;
      if (batchChoices[oldKey]) batchChoices[newKey] = batchChoices[oldKey]!;
      bindings[newKey] = { eventId: current.eventId, questionId: current.id, questionVersion: current.version, eventVersion: current.eventVersion, fields: [...current.fields] };
      delete formDrafts[oldKey]; delete formTextDrafts[oldKey]; delete batchChoices[oldKey]; delete bindings[oldKey]; rebound++;
    }
    const remainingStale = staleKeys();
    if (!draft.reviewFormDrafts) {
      for (const stale of remainingStale) { delete formDrafts[stale]; delete formTextDrafts[stale]; delete batchChoices[stale]; delete bindings[stale]; }
    }
    const changed = rebound > 0 || remainingStale.length > 0 || needsQuestionReset;
    if (!changed) return {
      draft,
      notice: draft.reviewFormDrafts ? "这批内容还有项目未确认，原答案已保留，请逐项复核后重新提交。" : "",
    };
    const next: ChatDraft = {
      ...draft,
      formDrafts: Object.keys(formDrafts).length ? formDrafts : undefined,
      formTextDrafts: Object.keys(formTextDrafts).length ? formTextDrafts : undefined,
      batchChoices: Object.keys(batchChoices).length ? batchChoices : undefined,
      formDraftBindings: Object.keys(bindings).length ? bindings : undefined,
      reviewFormDrafts: draft.reviewFormDrafts ? true : undefined,
      ...(needsQuestionReset ? { question: undefined, selectedLabel: undefined } : {}),
    };
    const notice = draft.reviewFormDrafts
      ? remainingStale.length
        ? "待补问题已经变化。未确认的原草稿仍保留，请按当前问题逐项复核；无法安全对应的内容没有自动覆盖。"
        : "原答案已保留到同一事件的当前问题，请逐项复核后再提交。"
      : remainingStale.length ? "待补问题已更新或关闭，旧版本的未发送表单已移除。" : "";
    return { draft: next, notice };
  }

  async load(): Promise<void> {
    if (!this.alive) return;
    const version = ++this.readVersion;
    this.update({ loading: true });
    try {
      // Fetch history first, then pending: pending is therefore the later
      // authoritative snapshot and cannot resurrect a question solved meanwhile.
      const history = await this.api.getChatHistory(this.babyId);
      const pending = await this.api.getPending(this.babyId);
      if (!this.alive || version !== this.readVersion) return;
      const authoritative = pending.filter(item => item.state === "open").map(item => this.exactPending(item, history.pending.filter(value => value.state === "open")) ?? item);
      const reconciled = this.retainPrivateDraft(authoritative);
      if (reconciled.draft !== this.state.draft) this.save(reconciled.draft);
      const replyQuestions = (history.replyQuestions ?? []).filter(question => {
        if (question.origin.question) return authoritative.some(item => item.kind === "fields" && item.id === question.origin.question?.id && item.version === question.origin.question.questionVersion && item.eventVersion === question.origin.question.eventVersion);
        if (question.origin.mediaPendingId) return authoritative.some(item => item.kind === "media" && item.id === question.origin.mediaPendingId);
        return true;
      });
      this.update({ history: history.turns, automaticMessages: history.automaticMessages, pending: authoritative, replyQuestions, firstWeekNotice: history.firstWeekNotice, error: "", notice: reconciled.notice });
      // The server owns unfinished turns even when this device lost its local
      // request registry (or another device started the same conversation).
      if (!this.state.draft.pending) {
        const unfinished = history.turns.find(turn => (turn.status === "processing" || turn.status === "needs_recovery") && !this.completedRequests.has(turn.requestId));
        if (unfinished) this.adopt(unfinished);
      }
      const request = this.state.draft.pending;
      if (request) {
        const turn = history.turns.find(turn => turn.requestId === request.requestId);
        if (turn) this.accept(turn, false);
        else void this.recover(false);
      }
    } catch (error) { if (version === this.readVersion) this.failure(error); }
    finally { if (version === this.readVersion) this.update({ loading: false }); }
  }

  private mergePending(turn: ChatTurn, latest: ChatPending[]): ChatPending[] {
    const open = latest.filter(item => item.state === "open");
    // A completed turn carries the complete authoritative pending set. Keeping
    // absent local items would make an ordinary natural answer resurrect a form.
    if (turn.status === "completed") return open;
    return open.length ? open : this.state.pending;
  }

  private accept(turn: ChatTurn, updatePending = true) {
    if (!this.alive) return;
    if (turn.babyId !== this.babyId) { this.failure(new ApiError(403, "宝宝访问上下文已变化。")); return; }
    const history = [...this.state.history.filter(item => item.requestId !== turn.requestId), turn].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (turn.status === "completed") this.completedRequests.add(turn.requestId);
    this.update({ history, ...(updatePending ? { pending: this.mergePending(turn, turn.pending.filter(item => item.state === "open")) } : {}) });
    if (turn.refreshRequired && !this.refreshes.has(`${turn.id}:${turn.updatedAt}`)) {
      this.refreshes.add(`${turn.id}:${turn.updatedAt}`); this.callbacks.refresh();
    }
    if (turn.requestId !== this.state.draft.pending?.requestId) return;
    if (turn.status === "completed") {
      const draft = this.state.draft, submittedForm = turn.input.question && turn.input.context.selectedEventId
        && (turn.input.formAnswer || (turn.input.text && !turn.input.choiceAnswer))
        ? pendingQuestionKey(turn.input.question.id, turn.input.question.questionVersion, turn.input.context.selectedEventId, turn.input.question.eventVersion)
        : undefined;
      const durableReceipts = turn.receipts.filter(receipt => !("kind" in receipt)
        && (receipt.status === "saved" || receipt.status === "needs_information"));
      const savedBatch = (turn.input.formBatch ?? []).filter(item => durableReceipts.some(receipt => !("kind" in receipt)
        && receipt.events?.some(event => event.id === item.eventId && event.version > item.question.eventVersion)));
      const hasUnconfirmedBatch = !!turn.input.formBatch?.length && savedBatch.length < turn.input.formBatch.length;
      const savedFormKeys = new Set(savedBatch.map(item => pendingQuestionKey(item.question.id, item.question.questionVersion, item.eventId, item.question.eventVersion)));
      if (submittedForm) savedFormKeys.add(submittedForm);
      const retainedForms = draft.formDrafts && savedFormKeys.size ? Object.fromEntries(Object.entries(draft.formDrafts).filter(([key]) => !savedFormKeys.has(key))) : draft.formDrafts;
      const retainedFormTexts = draft.formTextDrafts && savedFormKeys.size ? Object.fromEntries(Object.entries(draft.formTextDrafts).filter(([key]) => !savedFormKeys.has(key))) : draft.formTextDrafts;
      const submittedChoice = turn.input.choiceAnswer ? replyChoiceKey(turn.input.choiceAnswer) : undefined;
      const savedChoiceKeys = new Set(savedBatch.flatMap(item => item.choiceAnswer ? [replyChoiceKey(item.choiceAnswer)] : []));
      if (submittedChoice) savedChoiceKeys.add(submittedChoice);
      const retainedChoices = draft.choiceDrafts && savedChoiceKeys.size ? Object.fromEntries(Object.entries(draft.choiceDrafts).filter(([key]) => !savedChoiceKeys.has(key))) : draft.choiceDrafts;
      const retainedBatchChoices = draft.batchChoices && savedFormKeys.size ? Object.fromEntries(Object.entries(draft.batchChoices).filter(([key]) => !savedFormKeys.has(key))) : draft.batchChoices;
      const retainedBindings = draft.formDraftBindings && savedFormKeys.size ? Object.fromEntries(Object.entries(draft.formDraftBindings).filter(([key]) => !savedFormKeys.has(key))) : draft.formDraftBindings;
      const base = draft.preserveDraftOnRecovery
        ? { ...draft, pending: undefined, preserveDraftOnRecovery: undefined, reviewFormDrafts: hasUnconfirmedBatch ? true : undefined, selectedChoice: undefined, formDrafts: retainedForms && Object.keys(retainedForms).length ? retainedForms : undefined, formTextDrafts: retainedFormTexts && Object.keys(retainedFormTexts).length ? retainedFormTexts : undefined, batchChoices: retainedBatchChoices && Object.keys(retainedBatchChoices).length ? retainedBatchChoices : undefined, formDraftBindings: retainedBindings && Object.keys(retainedBindings).length ? retainedBindings : undefined, choiceDrafts: retainedChoices && Object.keys(retainedChoices).length ? retainedChoices : undefined }
        : { ...emptyDraft(), reviewFormDrafts: hasUnconfirmedBatch ? true : undefined, formDrafts: retainedForms, formTextDrafts: retainedFormTexts && Object.keys(retainedFormTexts).length ? retainedFormTexts : undefined, batchChoices: retainedBatchChoices && Object.keys(retainedBatchChoices).length ? retainedBatchChoices : undefined, formDraftBindings: retainedBindings && Object.keys(retainedBindings).length ? retainedBindings : undefined, choiceDrafts: retainedChoices && Object.keys(retainedChoices).length ? retainedChoices : undefined };
      // A recovered server turn is independent from the local unsent draft,
      // even if the user happens to have typed the same words again.
      const cleared = this.save(base, true);
      this.update({
        busy: false, confirming: false,
        ...(cleared ? { error: "", notice: hasUnconfirmedBatch ? "这批内容没有全部确认，原答案已保留，请逐项复核后重新提交。" : "" } : {}),
      });
      clearTimeout(this.timer);
    } else if (turn.status === "processing") {
      this.update({ busy: true, confirming: true, error: "" }); this.schedule();
    } else this.update({ busy: false, confirming: false, error: turn.error?.message || (turn.status === "needs_recovery" ? "保存尚未确认，请继续确认原请求。" : "这次发送未完成，草稿已保留。") });
  }

  private adopt(turn: ChatTurn): boolean {
    if (this.state.draft.pending || turn.babyId !== this.babyId) return false;
    return this.save({ ...this.state.draft, preserveDraftOnRecovery: true, pending: { babyId: this.babyId, requestId: turn.requestId, ...turn.input } });
  }

  async recoverTurn(turnId: string): Promise<void> {
    if (!this.alive || this.locked || this.state.draft.pending) return;
    const turn = this.state.history.find(item => item.id === turnId);
    if (!turn || !(turn.status === "processing" || turn.status === "needs_recovery" || (turn.status === "failed" && turn.error?.retryable))) return;
    if (this.adopt(turn)) await this.recover(true);
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.recover(false); }, 1800);
  }

  async send(viewedDate: string): Promise<void> {
    if (!this.alive || this.locked || this.state.loading) return;
    if (this.state.draft.pending) return this.recover(true);
    const draft = this.state.draft;
    if ((!draft.text.trim() && !draft.attachmentIds.length) || draft.text.length > 6000) return;
    const input: ChatRequest = { babyId: this.babyId, requestId: newRequestId(), text: draft.text.trim(), attachmentIds: [...draft.attachmentIds],
      context: { viewedDate, ...(draft.selectedEventId ? { selectedEventId: draft.selectedEventId } : {}), ...(draft.mediaPendingId ? { mediaPendingId: draft.mediaPendingId } : {}) }, ...(draft.question ? { question: draft.question } : {}) };
    if (!this.save({ ...draft, pending: input, preserveDraftOnRecovery: undefined })) return;
    this.locked = true; this.update({ busy: true, confirming: false, error: "" });
    let finished = false;
    try {
      const turn = await this.api.sendChat(input);
      if (this.alive) this.accept(turn);
      finished = turn.status === "completed";
    }
    catch (error) {
      this.update({ busy: false, confirming: false });
      if (error instanceof ApiError && error.code === "CHAT_PREVIOUS_PENDING") {
        // A definitive rejection means this new request was never accepted.
        // Keep its text while recovering the actual blocking server turn.
        if (this.save({ ...this.state.draft, pending: undefined })) await this.load();
      } else this.failure(error);
    }
    finally {
      this.locked = false;
      if (finished) await this.load();
    }
  }

  async submitForm(viewedDate: string, question: FieldPending, answer: StructuredFormAnswer): Promise<void> {
    if (!this.alive || this.locked || this.state.loading || this.state.draft.pending) return;
    const draft = this.state.draft;
    const input: ChatRequest = {
      babyId: this.babyId, requestId: newRequestId(), text: "", attachmentIds: [],
      context: { viewedDate, selectedEventId: question.eventId },
      question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion },
      formAnswer: cloneFormAnswer(answer),
    };
    if (!this.save({ ...draft, pending: input, preserveDraftOnRecovery: true })) return;
    this.locked = true; this.update({ busy: true, confirming: false, error: "" });
    let finished = false;
    try {
      const turn = await this.api.sendChat(input);
      if (this.alive) this.accept(turn);
      finished = turn.status === "completed";
    } catch (error) {
      this.update({ busy: false, confirming: false });
      if (error instanceof ApiError && error.code === "CHAT_PREVIOUS_PENDING") {
        if (this.save({ ...this.state.draft, pending: undefined })) await this.load();
      } else this.failure(error);
    } finally {
      this.locked = false;
      if (finished) await this.load();
    }
  }

  async submitFormText(viewedDate: string, question: FieldPending, text: string): Promise<void> {
    if (!this.alive || this.locked || this.state.loading || this.state.draft.pending) return;
    const answer = text.trim();
    if (!answer || answer.length > 6000) return;
    const draft = this.state.draft;
    const input: ChatRequest = {
      babyId: this.babyId, requestId: newRequestId(), text: answer, attachmentIds: [],
      context: { viewedDate, selectedEventId: question.eventId },
      question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion },
    };
    if (!this.save({ ...draft, pending: input, preserveDraftOnRecovery: true })) return;
    this.locked = true; this.update({ busy: true, confirming: false, error: "" });
    let finished = false;
    try {
      const turn = await this.api.sendChat(input);
      if (this.alive) this.accept(turn);
      finished = turn.status === "completed";
    } catch (error) {
      this.update({ busy: false, confirming: false });
      if (error instanceof ApiError && error.code === "CHAT_PREVIOUS_PENDING") {
        if (this.save({ ...this.state.draft, pending: undefined })) await this.load();
      } else this.failure(error);
    } finally {
      this.locked = false;
      if (finished) await this.load();
    }
  }

  async submitFormBatch(viewedDate: string, formBatch: FormBatchItem[]): Promise<void> {
    if (!this.alive || this.locked || this.state.loading || this.state.draft.pending || !formBatch.length || formBatch.length > 25) return;
    const draft = this.state.draft;
    const input: ChatRequest = {
      babyId: this.babyId, requestId: newRequestId(), text: "", attachmentIds: [], context: { viewedDate },
      formBatch: formBatch.map(item => ({
        eventId: item.eventId, question: { ...item.question },
        ...(item.formAnswer ? { formAnswer: cloneFormAnswer(item.formAnswer) } : {}),
        ...(item.text !== undefined ? { text: item.text } : {}), ...(item.choiceAnswer ? { choiceAnswer: { ...item.choiceAnswer } } : {}),
      })),
    };
    if (!this.save({ ...draft, pending: input, preserveDraftOnRecovery: true, reviewFormDrafts: undefined })) return;
    this.locked = true; this.update({ busy: true, confirming: false, error: "" });
    try {
      const turn = await this.api.sendChat(input);
      if (this.alive) this.accept(turn);
    } catch (error) {
      this.update({ busy: false, confirming: false });
      if (error instanceof ApiError && error.code === "CHAT_PREVIOUS_PENDING") {
        if (this.save({ ...this.state.draft, pending: undefined })) await this.load();
      } else this.failure(error);
    } finally { this.locked = false; }
  }

  async submitChoice(viewedDate: string, question: ReplyQuestion, choice: ReplyChoice, attachmentIds: string[] = []): Promise<void> {
    if (!this.alive || this.locked || this.state.loading || this.state.draft.pending) return;
    const selected: ChoiceAnswerRef = { questionId: question.id, choiceId: choice.id, ...(question.origin.turnId ? { originTurnId: question.origin.turnId } : {}) };
    const customText = this.state.draft.choiceDrafts?.[replyChoiceKey(selected)]?.trim() ?? "";
    if ((choice.action.type === "custom" || choice.action.type === "input") && !customText) { this.update({ error: "请先填写自定义回答。" }); return; }
    if (choice.action.type === "attach" && !attachmentIds.length) { this.update({ error: "请先选择要补充的照片。" }); return; }
    const input: ChatRequest = {
      babyId: this.babyId, requestId: newRequestId(), text: choice.action.type === "custom" || choice.action.type === "input" ? customText : "", attachmentIds,
      context: { viewedDate, ...(question.origin.selectedEventId ? { selectedEventId: question.origin.selectedEventId } : {}), ...(question.origin.mediaPendingId ? { mediaPendingId: question.origin.mediaPendingId } : {}) },
      ...(question.origin.question ? { question: question.origin.question } : {}), choiceAnswer: selected,
    };
    if (!this.save({ ...this.state.draft, selectedChoice: selected, pending: input, preserveDraftOnRecovery: true })) return;
    this.locked = true; this.update({ busy: true, confirming: false, error: "" });
    let finished = false;
    try {
      const turn = await this.api.sendChat(input);
      if (this.alive) this.accept(turn);
      finished = turn.status === "completed";
    } catch (error) {
      this.update({ busy: false, confirming: false });
      if (error instanceof ApiError && error.code === "CHAT_PREVIOUS_PENDING") {
        if (this.save({ ...this.state.draft, pending: undefined })) await this.load();
      } else this.failure(error);
    } finally {
      this.locked = false;
      if (finished) await this.load();
    }
  }

  async recover(retry = true): Promise<void> {
    const input = this.state.draft.pending;
    if (!this.alive || !input || this.locked) return;
    this.locked = true; this.update({ busy: true, confirming: true, error: "" });
    let finished = false;
    try {
      let turn = await this.api.getChatRequest(this.babyId, input.requestId);
      if (!this.alive) return;
      if (retry && (!turn || turn.status === "needs_recovery" || (turn.status === "failed" && turn.error?.retryable))) turn = await this.api.sendChat(input);
      if (!this.alive) return;
      if (turn) { this.accept(turn); finished = turn.status === "completed"; }
      else this.update({ busy: false, confirming: false, error: "尚未查到上次发送，可以用原请求继续发送。" });
    } catch (error) { this.update({ busy: false, confirming: false }); this.failure(error); }
    finally {
      this.locked = false;
      if (finished && !input.formBatch) await this.load();
    }
  }

  /** A rejected/failed request can only be edited once the server explicitly says it cannot retry. */
  releaseRejected(): void {
    const input = this.state.draft.pending;
    const turn = this.state.history.find(item => item.requestId === input?.requestId);
    if (this.locked || turn?.status !== "failed" || turn.error?.retryable !== false) return;
    const draft = this.state.draft;
    const submittedForm = input?.formAnswer && input.question && input.context.selectedEventId
      ? pendingQuestionKey(input.question.id, input.question.questionVersion, input.context.selectedEventId, input.question.eventVersion)
      : undefined;
    const formDrafts = draft.formDrafts && submittedForm ? Object.fromEntries(Object.entries(draft.formDrafts).filter(([key]) => key !== submittedForm)) : draft.formDrafts;
    this.save(draft.preserveDraftOnRecovery
      ? { ...draft, pending: undefined, preserveDraftOnRecovery: undefined, ...(input?.formBatch ? { reviewFormDrafts: true } : {}), formDrafts: formDrafts && Object.keys(formDrafts).length ? formDrafts : undefined }
      : { ...draft, pending: undefined, question: undefined, mediaPendingId: undefined, selectedLabel: undefined });
    this.update({ confirming: false, error: input?.formBatch ? "这批保存没有全部确认，原草稿已保留；请按当前待补问题逐项复核。" : "请核对最新待补问题或记录后重新发送。" });
  }

  dispose(): void { this.alive = false; clearTimeout(this.timer); this.readVersion++; this.listeners.clear(); }
}
