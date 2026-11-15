import type { SessionStorage } from "../api/session";
import type { StructuredFormAnswer } from "./contracts";
import { isPendingFormDraft, type PendingFormDraft } from "./form";

export interface QuestionRef { id: string; questionVersion: number; eventVersion: number }
export interface ChoiceAnswerRef { questionId: string; choiceId: string; originTurnId?: string; eventVersion?: number }
export interface FormBatchItem {
  eventId: string; question: QuestionRef;
  formAnswer?: StructuredFormAnswer; text?: string; choiceAnswer?: ChoiceAnswerRef;
}
export interface FormDraftBinding { eventId: string; questionId: string; questionVersion: number; eventVersion: number; fields: string[] }
export interface ChatContext { viewedDate: string; selectedEventId?: string; mediaPendingId?: string }
export interface ChatRequest {
  babyId: string; requestId: string; text: string; attachmentIds: string[];
  context: ChatContext; question?: QuestionRef; formAnswer?: StructuredFormAnswer; choiceAnswer?: ChoiceAnswerRef; formBatch?: FormBatchItem[];
}
export interface ChatDraft {
  text: string; attachmentIds: string[]; selectedEventId?: string; selectedLabel?: string;
  question?: QuestionRef; mediaPendingId?: string; formDrafts?: Record<string, PendingFormDraft>; pending?: ChatRequest; preserveDraftOnRecovery?: boolean;
  selectedChoice?: ChoiceAnswerRef; batchChoices?: Record<string, ChoiceAnswerRef>; choiceDrafts?: Record<string, string>; formTextDrafts?: Record<string, Record<string, string>>;
  formDraftBindings?: Record<string, FormDraftBinding>; reviewFormDrafts?: boolean;
}
export const emptyDraft = (): ChatDraft => ({ text: "", attachmentIds: [] });
export function newRequestId(): string {
  // Idempotency identifier, never an authentication credential.
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
const attachmentId = /^att_[a-f0-9]{64}$/;
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function question(value: unknown): value is QuestionRef {
  return object(value) && typeof value.id === "string" && Number.isSafeInteger(value.questionVersion) && Number(value.questionVersion) > 0 && Number.isSafeInteger(value.eventVersion) && Number(value.eventVersion) > 0;
}
function choiceAnswer(value: unknown): value is ChoiceAnswerRef {
  return object(value) && typeof value.questionId === "string" && !!value.questionId && typeof value.choiceId === "string" && !!value.choiceId && (value.originTurnId === undefined || typeof value.originTurnId === "string") && (value.eventVersion === undefined || (Number.isSafeInteger(value.eventVersion) && Number(value.eventVersion) > 0));
}
function ids(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 3 && value.every(id => typeof id === "string" && attachmentId.test(id)); }
function context(value: unknown): value is ChatContext {
  return object(value) && typeof value.viewedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.viewedDate) && (value.selectedEventId === undefined || typeof value.selectedEventId === "string") && (value.mediaPendingId === undefined || typeof value.mediaPendingId === "string");
}
function milkItemAnswers(value: unknown): boolean {
  if (!Array.isArray(value) || !value.length || value.length > 20) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!object(item) || typeof item.milkItemId !== "string" || !item.milkItemId || item.milkItemId.length > 200 || ids.has(item.milkItemId)) return false;
    ids.add(item.milkItemId);
    const facts = item.facts, states = item.states;
    if (facts !== undefined && (!object(facts) || Object.keys(facts).some(key => !["milkSource", "milkDescription", "milkAmount"].includes(key)))) return false;
    if (states !== undefined && (!object(states) || Object.keys(states).some(key => !["milkSourceState", "milkAmountState"].includes(key)))) return false;
    if (object(facts)) {
      if (facts.milkSource !== undefined && facts.milkSource !== "BREAST_MILK" && facts.milkSource !== "FORMULA") return false;
      if (facts.milkDescription !== undefined && (typeof facts.milkDescription !== "string" || !facts.milkDescription.trim() || facts.milkDescription.length > 100)) return false;
      if (facts.milkSource !== undefined && facts.milkDescription !== undefined) return false;
      if (facts.milkAmount !== undefined && facts.milkAmount !== null && (typeof facts.milkAmount !== "number" || !Number.isFinite(facts.milkAmount) || facts.milkAmount < 0 || facts.milkAmount > 100000)) return false;
    }
    if (object(states) && [states.milkSourceState, states.milkAmountState].some(state => state !== undefined && !["known", "pending", "unknown"].includes(String(state)))) return false;
    const factCount = object(facts) ? Object.keys(facts).length : 0, stateCount = object(states) ? Object.keys(states).length : 0;
    if (!factCount && !stateCount) return false;
  }
  return true;
}
function formAnswer(value: unknown): value is StructuredFormAnswer {
  return object(value) && object(value.facts) && (value.states === undefined || object(value.states)) &&
    (value.progress === undefined || (typeof value.progress === "string" && ["ongoing", "ended", "unknown"].includes(value.progress))) &&
    (value.milkItemAnswers === undefined || milkItemAnswers(value.milkItemAnswers));
}
function formDraftBinding(value: unknown): value is FormDraftBinding {
  return object(value) && typeof value.eventId === "string" && !!value.eventId && typeof value.questionId === "string" && !!value.questionId
    && Number.isSafeInteger(value.questionVersion) && Number(value.questionVersion) > 0 && Number.isSafeInteger(value.eventVersion) && Number(value.eventVersion) > 0
    && Array.isArray(value.fields) && value.fields.length <= 50 && value.fields.every(field => typeof field === "string" && !!field);
}
function formBatch(value: unknown): value is FormBatchItem[] {
  if (!Array.isArray(value) || !value.length || value.length > 25) return false;
  const events = new Set<string>(), questions = new Set<string>();
  let textLength = 0;
  for (const item of value) {
    if (!object(item) || typeof item.eventId !== "string" || !item.eventId || !question(item.question)) return false;
    if (events.has(item.eventId) || questions.has(item.question.id)) return false;
    events.add(item.eventId); questions.add(item.question.id);
    const modes = Number(item.formAnswer !== undefined) + Number(item.text !== undefined) + Number(item.choiceAnswer !== undefined);
    if (modes !== 1 || (item.formAnswer !== undefined && !formAnswer(item.formAnswer)) || (item.choiceAnswer !== undefined && (!choiceAnswer(item.choiceAnswer) || item.choiceAnswer.originTurnId !== undefined))) return false;
    if (item.text !== undefined) {
      if (typeof item.text !== "string" || !item.text.trim() || item.text.length > 6000) return false;
      textLength += item.text.length;
    }
  }
  return textLength <= 12000;
}
export function isChatRequest(value: unknown, babyId: string): value is ChatRequest {
  if (!object(value) || value.babyId !== babyId || typeof value.requestId !== "string" || value.requestId.length < 8 || value.requestId.length > 128 || typeof value.text !== "string" || value.text.length > 6000 || !ids(value.attachmentIds) || !context(value.context) || (value.question !== undefined && !question(value.question)) || (value.formAnswer !== undefined && !formAnswer(value.formAnswer)) || (value.choiceAnswer !== undefined && !choiceAnswer(value.choiceAnswer)) || (value.formBatch !== undefined && !formBatch(value.formBatch))) return false;
  if (value.formBatch !== undefined && (value.attachmentIds.length || value.formAnswer !== undefined || value.question !== undefined || value.choiceAnswer !== undefined || value.context.selectedEventId !== undefined || value.context.mediaPendingId !== undefined)) return false;
  return true;
}
export const replyChoiceKey = (value: ChoiceAnswerRef) => `${value.originTurnId ?? "pending"}:${value.questionId}:${value.choiceId}`;

/** Only drafts and immutable request identifiers persist. Server history remains authoritative. */
export class ChatDraftStore {
  private readonly root: string;
  constructor(private readonly storage: SessionStorage, origin: string) { this.root = `bubu-chat-v1:${origin}`; }
  private index(): string[] { const value = this.storage.get(`${this.root}:index`); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.startsWith(`${this.root}:scope:`)) : []; }
  private key(identityId: string, babyId: string) { return `${this.root}:scope:${encodeURIComponent(identityId)}:${encodeURIComponent(babyId)}`; }
  read(identityId: string, babyId: string): ChatDraft {
    try {
      const saved = this.storage.get(this.key(identityId, babyId));
      if (!object(saved) || typeof saved.text !== "string" || saved.text.length > 100_000 || !ids(saved.attachmentIds) || (saved.question !== undefined && !question(saved.question)) || (saved.pending !== undefined && !isChatRequest(saved.pending, babyId))) return emptyDraft();
      const formDrafts = object(saved.formDrafts) ? Object.fromEntries(Object.entries(saved.formDrafts).filter(([key, value]) => !!key && key.length <= 500 && isPendingFormDraft(value)).slice(0, 100)) : undefined;
      const choiceDrafts = object(saved.choiceDrafts) ? Object.fromEntries(Object.entries(saved.choiceDrafts).filter(([key, value]) => !!key && key.length <= 500 && typeof value === "string" && value.length <= 6000).slice(0, 30)) : undefined;
      const batchChoices = object(saved.batchChoices) ? Object.fromEntries(Object.entries(saved.batchChoices).filter(([key, value]) => !!key && key.length <= 500 && choiceAnswer(value)).slice(0, 100)) : undefined;
      const formDraftBindings = object(saved.formDraftBindings) ? Object.fromEntries(Object.entries(saved.formDraftBindings).filter(([key, value]) => !!key && key.length <= 500 && formDraftBinding(value)).slice(0, 100)) : undefined;
      const formTextDrafts = object(saved.formTextDrafts) ? Object.fromEntries(Object.entries(saved.formTextDrafts).flatMap(([key, value]) => {
        if (!key || key.length > 500 || !object(value)) return [];
        const contexts = Object.fromEntries(Object.entries(value).filter(([context, textValue]) => !!context && context.length <= 100 && typeof textValue === "string" && textValue.length <= 6000).slice(0, 30));
        return Object.keys(contexts).length ? [[key, contexts]] : [];
      }).slice(0, 100)) : undefined;
      return { text: saved.text, attachmentIds: saved.attachmentIds,
        ...(typeof saved.selectedEventId === "string" ? { selectedEventId: saved.selectedEventId } : {}),
        ...(typeof saved.selectedLabel === "string" ? { selectedLabel: saved.selectedLabel.slice(0, 150) } : {}),
        ...(typeof saved.mediaPendingId === "string" ? { mediaPendingId: saved.mediaPendingId } : {}),
        ...(saved.question ? { question: saved.question as unknown as QuestionRef } : {}),
        ...(formDrafts && Object.keys(formDrafts).length ? { formDrafts: formDrafts as Record<string, PendingFormDraft> } : {}),
        ...(saved.selectedChoice && choiceAnswer(saved.selectedChoice) ? { selectedChoice: saved.selectedChoice } : {}),
        ...(batchChoices && Object.keys(batchChoices).length ? { batchChoices: batchChoices as Record<string, ChoiceAnswerRef> } : {}),
        ...(choiceDrafts && Object.keys(choiceDrafts).length ? { choiceDrafts: choiceDrafts as Record<string, string> } : {}),
        ...(formTextDrafts && Object.keys(formTextDrafts).length ? { formTextDrafts: formTextDrafts as Record<string, Record<string, string>> } : {}),
        ...(formDraftBindings && Object.keys(formDraftBindings).length ? { formDraftBindings: formDraftBindings as Record<string, FormDraftBinding> } : {}),
        ...(saved.pending ? { pending: saved.pending as unknown as ChatRequest } : {}),
        ...(saved.preserveDraftOnRecovery === true ? { preserveDraftOnRecovery: true } : {}), ...(saved.reviewFormDrafts === true ? { reviewFormDrafts: true } : {}) };
    } catch { return emptyDraft(); }
  }
  save(identityId: string, babyId: string, draft: ChatDraft): void {
    const key = this.key(identityId, babyId);
    // Write the registry first so interruption cannot leave an untracked private draft.
    this.storage.set(`${this.root}:index`, [...new Set([...this.index(), key])]);
    this.storage.set(key, draft);
  }
  clearBaby(babyId: string): void { this.remove(key => key.endsWith(`:${encodeURIComponent(babyId)}`)); }
  clear(): void { this.remove(() => true); }
  reconcile(identityId: string, babyIds: string[]): void {
    const allowed = new Set(babyIds.map(babyId => this.key(identityId, babyId)));
    this.remove(key => !allowed.has(key));
  }
  private remove(matches: (key: string) => boolean): void {
    const keys = this.index();
    for (const key of keys) if (matches(key)) this.storage.remove(key);
    this.storage.set(`${this.root}:index`, keys.filter(key => !matches(key)));
  }
}
