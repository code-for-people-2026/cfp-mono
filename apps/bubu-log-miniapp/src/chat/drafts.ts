import type { SessionStorage } from "../api/session";

export interface QuestionRef { id: string; questionVersion: number; eventVersion: number }
export interface ChatContext { viewedDate: string; selectedEventId?: string; mediaPendingId?: string }
export interface ChatRequest {
  babyId: string; requestId: string; text: string; attachmentIds: string[];
  context: ChatContext; question?: QuestionRef;
}
export interface ChatDraft {
  text: string; attachmentIds: string[]; selectedEventId?: string; selectedLabel?: string;
  question?: QuestionRef; mediaPendingId?: string; pending?: ChatRequest; preserveDraftOnRecovery?: boolean;
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
function ids(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 3 && value.every(id => typeof id === "string" && attachmentId.test(id)); }
function context(value: unknown): value is ChatContext {
  return object(value) && typeof value.viewedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.viewedDate) && (value.selectedEventId === undefined || typeof value.selectedEventId === "string") && (value.mediaPendingId === undefined || typeof value.mediaPendingId === "string");
}
function request(value: unknown, babyId: string): value is ChatRequest {
  return object(value) && value.babyId === babyId && typeof value.requestId === "string" && value.requestId.length >= 8 && value.requestId.length <= 128 && typeof value.text === "string" && value.text.length <= 6000 && ids(value.attachmentIds) && context(value.context) && (value.question === undefined || question(value.question));
}

/** Only drafts and immutable request identifiers persist. Server history remains authoritative. */
export class ChatDraftStore {
  private readonly root: string;
  constructor(private readonly storage: SessionStorage, origin: string) { this.root = `bubu-chat-v1:${origin}`; }
  private index(): string[] { const value = this.storage.get(`${this.root}:index`); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.startsWith(`${this.root}:scope:`)) : []; }
  private key(identityId: string, babyId: string) { return `${this.root}:scope:${encodeURIComponent(identityId)}:${encodeURIComponent(babyId)}`; }
  read(identityId: string, babyId: string): ChatDraft {
    try {
      const saved = this.storage.get(this.key(identityId, babyId));
      if (!object(saved) || typeof saved.text !== "string" || saved.text.length > 100_000 || !ids(saved.attachmentIds) || (saved.question !== undefined && !question(saved.question)) || (saved.pending !== undefined && !request(saved.pending, babyId))) return emptyDraft();
      return { text: saved.text, attachmentIds: saved.attachmentIds,
        ...(typeof saved.selectedEventId === "string" ? { selectedEventId: saved.selectedEventId } : {}),
        ...(typeof saved.selectedLabel === "string" ? { selectedLabel: saved.selectedLabel.slice(0, 150) } : {}),
        ...(typeof saved.mediaPendingId === "string" ? { mediaPendingId: saved.mediaPendingId } : {}),
        ...(saved.question ? { question: saved.question as unknown as QuestionRef } : {}),
        ...(saved.pending ? { pending: saved.pending as unknown as ChatRequest } : {}),
        ...(saved.preserveDraftOnRecovery === true ? { preserveDraftOnRecovery: true } : {}) };
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
