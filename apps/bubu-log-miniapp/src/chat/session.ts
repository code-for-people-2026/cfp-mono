import { ApiError, type BubuApi } from "../api/client";
import type { ChatPending, ChatTurn } from "./contracts";
import { ChatDraftStore, emptyDraft, newRequestId, type ChatDraft, type ChatRequest } from "./drafts";
type ChatApi = Pick<BubuApi, "getChatHistory" | "getPending" | "getChatRequest" | "sendChat">;
export interface ChatState { draft: ChatDraft; history: ChatTurn[]; pending: ChatPending[]; loading: boolean; busy: boolean; error: string }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "暂时没有完成，请重试。";

/** Owns recoverable submission state independently from the collapsible sheet. */
export class ChatSession {
  private state: ChatState;
  private listeners = new Set<() => void>();
  private alive = true;
  private locked = false;
  private readVersion = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private refreshes = new Set<string>();
  constructor(private readonly api: ChatApi, private readonly store: ChatDraftStore, readonly identityId: string, readonly babyId: string,
    private readonly callbacks: { refresh(): void; revoked(error: ApiError): void }) {
    this.state = { draft: store.read(identityId, babyId), history: [], pending: [], loading: true, busy: false, error: "" };
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
  selectTarget(change: Pick<ChatDraft, "selectedEventId" | "selectedLabel" | "question" | "mediaPendingId">): boolean {
    if (this.state.draft.pending || this.locked) { this.update({ error: "请先确认上次发送，再切换要修改的记录。" }); return false; }
    return this.save({ ...this.state.draft, selectedEventId: undefined, selectedLabel: undefined, question: undefined, mediaPendingId: undefined, ...change });
  }
  private failure(error: unknown) {
    if (!this.alive) return;
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      if (error.status === 401) this.store.clear(); else this.store.clearBaby(this.babyId);
      this.update({ draft: emptyDraft(), history: [], pending: [], error: error.message, busy: false });
      this.dispose(); this.callbacks.revoked(error); return;
    }
    this.update({ error: errorMessage(error) });
  }
  async load(): Promise<void> {
    if (!this.alive) return;
    const version = ++this.readVersion;
    this.update({ loading: true });
    try {
      const [history, pending] = await Promise.all([this.api.getChatHistory(this.babyId), this.api.getPending(this.babyId)]);
      if (!this.alive || version !== this.readVersion) return;
      this.update({ history: history.turns, pending: pending.filter(item => item.state === "open").map(item => {
        const enriched = history.pending.find(value => value.id === item.id && value.kind === item.kind && (value.kind === "media" || (item.kind === "fields" && value.version === item.version && value.eventVersion === item.eventVersion)));
        return enriched?.prompt ? { ...item, prompt: enriched.prompt } : item;
      }), error: "" });
      // The server owns unfinished turns even when this device lost its local
      // request registry (or another device started the same conversation).
      if (!this.state.draft.pending) {
        const unfinished = history.turns.find(turn => turn.status === "processing" || turn.status === "needs_recovery");
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
  private accept(turn: ChatTurn, updatePending = true) {
    if (!this.alive) return;
    if (turn.babyId !== this.babyId) { this.failure(new ApiError(403, "宝宝访问上下文已变化。")); return; }
    const history = [...this.state.history.filter(item => item.requestId !== turn.requestId), turn].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.update({ history, ...(updatePending ? { pending: turn.pending.filter(item => item.state === "open") } : {}) });
    if (turn.refreshRequired && !this.refreshes.has(`${turn.id}:${turn.updatedAt}`)) {
      this.refreshes.add(`${turn.id}:${turn.updatedAt}`); this.callbacks.refresh();
    }
    if (turn.requestId !== this.state.draft.pending?.requestId) return;
    if (turn.status === "completed") {
      const draft = this.state.draft;
      // A recovered server turn is independent from the local unsent draft,
      // even if the user happens to have typed the same words again.
      const cleared = this.save(draft.preserveDraftOnRecovery ? { ...draft, pending: undefined, preserveDraftOnRecovery: undefined } : emptyDraft(), true);
      this.update({ busy: false, ...(cleared ? { error: "" } : {}) });
      clearTimeout(this.timer);
    } else if (turn.status === "processing") {
      this.update({ busy: true, error: "" }); this.schedule();
    } else this.update({ busy: false, error: turn.error?.message || (turn.status === "needs_recovery" ? "保存尚未确认，请继续确认原请求。" : "这次发送未完成，草稿已保留。") });
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
    this.locked = true; this.update({ busy: true, error: "" });
    try { const turn = await this.api.sendChat(input); if (this.alive) this.accept(turn); }
    catch (error) {
      this.update({ busy: false });
      if (error instanceof ApiError && error.code === "CHAT_PREVIOUS_PENDING") {
        // A definitive rejection means this new request was never accepted.
        // Keep its text while recovering the actual blocking server turn.
        if (this.save({ ...this.state.draft, pending: undefined })) await this.load();
      } else this.failure(error);
    }
    finally { this.locked = false; }
  }
  async recover(retry = true): Promise<void> {
    const input = this.state.draft.pending;
    if (!this.alive || !input || this.locked) return;
    this.locked = true; this.update({ busy: true, error: "" });
    try {
      let turn = await this.api.getChatRequest(this.babyId, input.requestId);
      if (!this.alive) return;
      if (retry && (!turn || turn.status === "needs_recovery" || (turn.status === "failed" && turn.error?.retryable))) turn = await this.api.sendChat(input);
      if (!this.alive) return;
      if (turn) this.accept(turn);
      else this.update({ busy: false, error: "尚未查到上次发送，可以用原请求继续发送。" });
    } catch (error) { this.update({ busy: false }); this.failure(error); }
    finally { this.locked = false; }
  }
  /** A rejected/failed request can only be edited once the server explicitly says it cannot retry. */
  releaseRejected(): void {
    const id = this.state.draft.pending?.requestId;
    const turn = this.state.history.find(item => item.requestId === id);
    if (this.locked || turn?.status !== "failed" || turn.error?.retryable !== false) return;
    const draft = this.state.draft;
    this.save(draft.preserveDraftOnRecovery ? { ...draft, pending: undefined, preserveDraftOnRecovery: undefined } : { ...draft, pending: undefined, question: undefined, mediaPendingId: undefined, selectedLabel: undefined }); this.update({ error: "请核对最新待补问题或记录后重新发送。" });
  }
  dispose(): void { this.alive = false; clearTimeout(this.timer); this.readVersion++; this.listeners.clear(); }
}
