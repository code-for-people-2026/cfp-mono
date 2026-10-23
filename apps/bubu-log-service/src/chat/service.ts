import { z } from "zod";
import type { PayloadRequest } from "payload";
import { AppError } from "../contracts";
import type { IdentityService, Principal } from "../identity";
import type { AttachmentService } from "../records/attachments";
import { hash } from "../records/persistence";
import type { CareEvent, PendingQuestion } from "../records/types";
import { chatInputSchema, type ChatError, type ChatHistory, type ChatInput, type ChatPending, type ChatProvider, type ChatReceipt, type ChatTurn, type ProviderContent, type ProviderMessage, type ProviderOutput } from "./contracts";
import { ChatRepository, type ChatStep, type StoredTurn } from "./persistence";
import { ChatMcpClient, McpToolError, mutationTools } from "./mcp";
import { CHAT_INSTRUCTIONS, modelTools, prepareCall } from "./policy";
import { confirmedReply, renderPendingQuestion, uncommittedReply } from "./presentation";

interface ChatServiceOptions { mcpUrl: string | URL; provider?: ChatProvider; fetch?: typeof fetch }
const outputSchema = z.object({ text: z.string().max(16000), calls: z.array(z.object({ id: z.string().min(1).max(200), name: z.string().max(100), arguments: z.record(z.string(), z.unknown()) }).strict()).max(8) }).strict();
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const dateInShanghai = (time: string) => new Date(Date.parse(time) + 8 * 3600_000).toISOString().slice(0, 10);
function pending(value: unknown): ChatPending[] {
  return list(value).filter(item => typeof object(item).id === "string" && object(item).state === "open").map(item => ({ ...object(item), kind: object(item).kind === "media" ? "media" : "fields" }) as ChatPending);
}
function prompted(questions: ChatPending[], events: unknown[]): ChatPending[] {
  return questions.map(question => ({ ...question, prompt: renderPendingQuestion(question, question.kind === "fields" ? events.find(event => object(event).id === question.eventId) as CareEvent | undefined : undefined) }));
}
function receipt(value: unknown): ChatReceipt | undefined {
  const item = object(value);
  if (typeof item.requestId === "string" && ["saved", "needs_information", "pending_projection", "conflict"].includes(String(item.status)) && Array.isArray(item.events) && Array.isArray(item.questions) && typeof item.retryable === "boolean") return value as ChatReceipt;
  if (item.kind === "media" && typeof item.id === "string" && typeof item.sourceId === "string" && ["resolved", "open"].includes(String(item.state)) && ["provided", "unknown"].includes(String(item.resolution))) return value as ChatReceipt;
  return undefined;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new AppError(503, "CHAT_INTERRUPTED", "处理已暂停，输入和已确认结果仍保留，请继续处理。"));
    if (signal.aborted) { promise.catch(() => undefined); cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel)).catch(() => undefined);
  });
}

export class ChatService {
  private readonly repository: ChatRepository;
  private readonly active = new Map<string, Promise<ChatTurn>>();
  private readonly controllers = new Set<AbortController>();
  private closing = false;
  constructor(readonly identity: IdentityService, readonly attachments: AttachmentService, private readonly options: ChatServiceOptions) {
    this.repository = new ChatRepository(identity.store.payload);
  }
  private conversation(principal: Principal, babyId: string) { return `chat_${hash([principal.subjectId, babyId])}`; }
  private turnId(principal: Principal, babyId: string, requestId: string) { return `turn_${hash([principal.subjectId, babyId, requestId])}`; }
  private now() { return new Date(this.identity.now()).toISOString(); }
  private authorized<T>(principal: Principal, babyId: string, write: boolean, action: (req: PayloadRequest) => Promise<T>): Promise<T> {
    if (principal.kind !== "caregiver") throw new AppError(403, "CHAT_CAREGIVER_REQUIRED", "请本人登录后使用私人对话。");
    return this.identity.executeAuthorized(principal, babyId, write ? "records:write" : "records:read", (_scope, req) => action(req));
  }
  private async check(principal: Principal, babyId: string) { await this.authorized(principal, babyId, false, async () => undefined); }
  private publicTurn(turn: StoredTurn): ChatTurn {
    const { id, requestId, conversationId, babyId, createdAt, updatedAt, input, assistantText, receipts, pending: questions, refreshRequired, error } = turn;
    // A process restart leaves a durable checkpoint, not an eternally spinning message.
    const status = turn.status === "processing" && !this.active.has(turn.id) ? "needs_recovery" : turn.status;
    const events = [...list(turn.modelContext?.events), ...receipts.flatMap(item => "events" in item ? item.events : [])];
    return { id, requestId, conversationId, babyId, createdAt, updatedAt, status, input, assistantText, receipts, pending: prompted(questions, events.reverse()), refreshRequired, ...(error ? { error } : {}) };
  }
  private async persist(principal: Principal, turn: StoredTurn) {
    turn.updatedAt = this.now();
    await this.authorized(principal, turn.babyId, true, req => this.repository.put(turn, req));
  }
  private async connect(principal: Principal, babyId: string, signal?: AbortSignal, readOnly = false) {
    const delegated = await this.identity.issueAgent(principal, babyId, "chat-agent", { readOnly });
    const client = new ChatMcpClient(this.options.mcpUrl, delegated.token, this.options.fetch, signal);
    try { await client.connect(); await this.check(principal, babyId); return client; }
    catch (error) { await client.close().catch(() => undefined); throw error; }
  }
  private async call(principal: Principal, turn: Pick<StoredTurn, "babyId">, client: ChatMcpClient, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    await this.check(principal, turn.babyId);
    if (signal?.aborted) throw new AppError(503, "CHAT_INTERRUPTED", "处理已暂停，可以继续处理。");
    const result = signal ? await abortable(client.call(name, args), signal) : await client.call(name, args);
    await this.check(principal, turn.babyId);
    return result;
  }
  async history(principal: Principal, babyId: string): Promise<ChatHistory> {
    const turns = await this.authorized(principal, babyId, false, req => this.repository.list(principal.subjectId, babyId, req));
    const client = await this.connect(principal, babyId, undefined, true);
    try {
      const rawQuestions = pending(await this.call(principal, { babyId }, client, "bubu_get_pending", { babyId }));
      const events = rawQuestions.length ? list(object(await this.call(principal, { babyId }, client, "bubu_query_events", { babyId })).events) : [];
      const questions = prompted(rawQuestions, events);
      await this.check(principal, babyId);
      return { conversationId: this.conversation(principal, babyId), babyId, turns: turns.map(turn => this.publicTurn(turn)), pending: questions, pendingCount: questions.length };
    } finally { await client.close().catch(() => undefined); }
  }
  async request(principal: Principal, babyId: string, requestId: string): Promise<ChatTurn | null> {
    return this.authorized(principal, babyId, false, async req => {
      const turn = await this.repository.get(principal.subjectId, babyId, this.turnId(principal, babyId, requestId), req);
      return turn ? this.publicTurn(turn) : null;
    });
  }
  async submit(principal: Principal, raw: ChatInput): Promise<ChatTurn> {
    const input = chatInputSchema.parse(raw);
    if (!this.options.provider) throw new AppError(503, "CHAT_PROVIDER_NOT_CONFIGURED", "对话模型尚未配置，暂时不能发送。已保存的记录仍可查看。");
    if (this.closing) throw new AppError(503, "CHAT_INTERRUPTED", "服务正在重启，请稍后用原请求继续。");
    const id = this.turnId(principal, input.babyId, input.requestId), fingerprint = hash(input);
    const turn = await this.authorized(principal, input.babyId, true, async req => {
      const previous = await this.repository.get(principal.subjectId, input.babyId, id, req);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new AppError(409, "CHAT_REQUEST_REUSED", "同一请求号不能用于不同内容，请核对原输入。");
        if (previous.status === "completed" || previous.error?.retryable === false || this.active.has(id)) return previous;
      }
      const blocker = (await this.repository.list(principal.subjectId, input.babyId, req)).find(item => item.id !== id && ["processing", "needs_recovery"].includes(item.status));
      if (blocker) throw new AppError(409, "CHAT_PREVIOUS_PENDING", "上一条还在处理或等待恢复，请先处理上一条。");
      const { babyId, requestId, ...message } = input;
      const row: StoredTurn = previous ?? { id, identityId: principal.subjectId, conversationId: this.conversation(principal, babyId), babyId, requestId, fingerprint,
        createdAt: this.now(), updatedAt: this.now(), input: message, status: "processing", assistantText: "", receipts: [], pending: [], refreshRequired: false,
        transcript: [], steps: [], rounds: 0, versions: {}, questionVersions: {}, };
      row.status = "processing"; delete row.error;
      await this.repository.put(row, req);
      return row;
    });
    if (turn.status !== "completed" && turn.error?.retryable !== false && !this.active.has(id)) {
      const controller = new AbortController(); this.controllers.add(controller);
      const task = this.run(principal, turn, controller.signal).finally(() => { this.active.delete(id); this.controllers.delete(controller); });
      this.active.set(id, task); task.catch(() => undefined);
    }
    return this.publicTurn(turn);
  }
  async send(principal: Principal, input: ChatInput): Promise<ChatTurn> {
    const turn = await this.submit(principal, input);
    const running = this.active.get(turn.id);
    if (running) return running;
    return turn;
  }
  private observe(turn: StoredTurn, result: unknown, own = false) {
    const value = object(result);
    for (const raw of list(value.events)) {
      const event = object(raw);
      if (typeof event.id === "string" && typeof event.version === "number" && (own || turn.versions[event.id] === undefined)) turn.versions[event.id] = event.version;
    }
    for (const raw of [...list(value.questions), ...(Array.isArray(result) ? result : [])]) {
      const question = object(raw);
      if (question.kind !== "media" && typeof question.id === "string" && typeof question.version === "number" && typeof question.eventVersion === "number" && !turn.questionVersions[question.id]) {
        turn.questionVersions[question.id] = { questionVersion: question.version, eventVersion: question.eventVersion };
        if (typeof question.eventId === "string" && turn.versions[question.eventId] === undefined) turn.versions[question.eventId] = question.eventVersion;
      }
    }
  }
  private async imageReferences(principal: Principal, turn: StoredTurn, selectedEvent: unknown) {
    type Reference = { attachmentId: string; source: "current" | "selected-event" | "previous-turn"; turnId?: string; eventId?: string };
    let references: Reference[] = turn.input.attachmentIds.map(attachmentId => ({ attachmentId, source: "current", turnId: turn.id }));
    const refersToPhoto = /照片|图片|(?:这|那|上)张图|上一张|刚才那张|之前那张|看看.*图|图.*颜色/.test(turn.input.text);
    const imageLinkAction = /移除|删除|换成|替换|去掉|找不到|不能提供|无法提供|不知道/.test(turn.input.text);
    const wantsImageInterpretation = refersToPhoto && !imageLinkAction && !turn.input.context.mediaPendingId;
    let ambiguity: string | undefined;
    if (!references.length && selectedEvent && !imageLinkAction) {
      const selected = object(selectedEvent);
      references = list(selected.attachmentIds).filter((id): id is string => typeof id === "string").map(attachmentId => ({ attachmentId, source: "selected-event", eventId: String(selected.id) }));
      if (references.length > 3) { if (wantsImageInterpretation) ambiguity = "这条记录有多张照片，请重新选择本次要看的照片（最多三张）。"; references = []; }
    }
    if (!references.length && !ambiguity && wantsImageInterpretation && !selectedEvent) {
      const history = await this.authorized(principal, turn.babyId, false, req => this.repository.list(principal.subjectId, turn.babyId, req));
      const recent = history.filter(item => item.id !== turn.id && item.createdAt <= turn.createdAt && item.status === "completed" && item.input.attachmentIds.length).at(-1);
      if (recent) {
        if (recent.input.attachmentIds.length > 1 && !/这些|这几张|都|全部|一起/.test(turn.input.text)) ambiguity = "上一轮有多张照片，你想看哪一张？请重新选择，避免把照片对应错。";
        else references = recent.input.attachmentIds.slice(0, 3).map(attachmentId => ({ attachmentId, source: "previous-turn", turnId: recent.id }));
      } else ambiguity = "当前对话里还没有可以确认对应的照片，请选择要看的照片。";
    }
    return { imageReferences: references, imageEvidenceOnly: turn.input.attachmentIds.length > 0 || (wantsImageInterpretation && references.length > 0), ...(ambiguity ? { imageAmbiguity: ambiguity } : {}) };
  }
  private async context(principal: Principal, turn: StoredTurn, client: ChatMcpClient, signal: AbortSignal) {
    if (turn.modelContext) return;
    const { babyId } = turn;
    const rules = await this.call(principal, turn, client, "bubu_get_rules", { babyId }, signal);
    const questions = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId }, signal));
    const selectedDate = object(await this.call(principal, turn, client, "bubu_query_events", { babyId, date: turn.input.context.viewedDate, includeRetracted: true }, signal));
    const events = list(selectedDate.events);
    if (dateInShanghai(turn.createdAt) !== turn.input.context.viewedDate) events.push(...list(object(await this.call(principal, turn, client, "bubu_query_events", { babyId, date: dateInShanghai(turn.createdAt), includeRetracted: true }, signal)).events));
    let selectedEvent: unknown;
    const selectedId = turn.input.context.selectedEventId;
    if (selectedId) {
      selectedEvent = events.find(event => object(event).id === selectedId || object(event).legacyId === selectedId);
      if (!selectedEvent) {
        const all = object(await this.call(principal, turn, client, "bubu_query_events", { babyId, includeRetracted: true }, signal));
        selectedEvent = list(all.events).find(event => object(event).id === selectedId || object(event).legacyId === selectedId);
      }
      if (!selectedEvent) throw new AppError(404, "CHAT_EVENT_NOT_FOUND", "选中的记录已不可用，请刷新日历后重新选择。");
      events.push(selectedEvent);
    }
    const question = turn.input.question;
    if (question) {
      const current = questions.find(item => item.kind === "fields" && item.id === question.id) as (PendingQuestion & { kind: "fields" }) | undefined;
      if (!current || current.version !== question.questionVersion || current.eventVersion !== question.eventVersion) throw new McpToolError("QUESTION_STALE", "问题已经变化，请刷新待补事项后核对新问题。", false);
      const source = object(await this.call(principal, turn, client, "bubu_query_events", { babyId, eventId: current.eventId, includeRetracted: true }, signal)); events.push(...list(source.events));
    }
    const mediaQuestion = questions.find(item => item.kind === "media" && item.id === turn.input.context.mediaPendingId);
    if (turn.input.context.mediaPendingId && !mediaQuestion) throw new McpToolError("QUESTION_STALE", "待补照片已经变化，请刷新后核对。", false);
    if (mediaQuestion?.kind === "media") for (const eventId of mediaQuestion.eventIds) events.push(...list(object(await this.call(principal, turn, client, "bubu_query_events", { babyId, eventId, includeRetracted: true }, signal)).events));
    const uniqueEvents = [...new Map(events.map(event => [String(object(event).id), event])).values()];
    turn.pending = questions;
    const imageContext = await this.imageReferences(principal, turn, selectedEvent);
    turn.modelContext = { type: "bubu_chat_context", sentAt: turn.createdAt, timezone: "Asia/Shanghai", viewedDate: turn.input.context.viewedDate,
      ...(selectedEvent ? { selectedEvent } : {}), ...(question ? { question } : {}), ...(mediaQuestion ? { mediaQuestion } : {}),
      pending: questions, rules, events: uniqueEvents, summary: selectedDate.summary, ...imageContext };
    this.observe(turn, { events: uniqueEvents, questions });
    await this.persist(principal, turn);
  }
  private async messages(principal: Principal, turn: StoredTurn): Promise<ProviderMessage[]> {
    const history = await this.authorized(principal, turn.babyId, false, req => this.repository.list(principal.subjectId, turn.babyId, req));
    const previous: ProviderMessage[] = history.filter(item => item.id !== turn.id && item.createdAt <= turn.createdAt && item.status === "completed").slice(-12).flatMap(item => [
      { role: "user" as const, content: item.input.text.slice(0, 6000) }, { role: "assistant" as const, content: item.assistantText.slice(0, 4000) },
    ]);
    const images: Exclude<ProviderContent, string> = [];
    const references = list(turn.modelContext?.imageReferences);
    for (const reference of references) {
      const metadata = object(reference);
      if (typeof metadata.attachmentId !== "string") continue;
      const id = metadata.attachmentId;
      const image = await this.attachments.read(principal, turn.babyId, id);
      await this.check(principal, turn.babyId);
      images.push({ type: "text", text: JSON.stringify({ type: "bubu_image_reference", ...metadata }) });
      images.push({ type: "image_url" as const, image_url: { url: `data:${image.attachment.mime};base64,${image.bytes.toString("base64")}` } });
    }
    return [...previous,
      { role: "user", content: JSON.stringify(turn.modelContext) },
      { role: "user", content: [{ type: "text", text: JSON.stringify({ type: "bubu_user_input", text: turn.input.text, attachmentIds: turn.input.attachmentIds }) }, ...images] },
      ...turn.transcript];
  }
  private async plan(principal: Principal, turn: StoredTurn, output: ProviderOutput) {
    if (output.calls.filter(call => mutationTools.has(call.name)).length > 1) throw new AppError(409, "CHAT_PLAN_INVALID", "模型提出了未分步确认的修改，请重新核对后发送。");
    const used = new Set(turn.steps.map(step => step.call.id));
    if (output.calls.some(call => used.has(call.id)) || new Set(output.calls.map(call => call.id)).size !== output.calls.length) throw new AppError(502, "CHAT_PROVIDER_RESPONSE_INVALID", "模型调用标识重复，可以继续处理。");
    const start = turn.steps.length;
    const steps = output.calls.map((call, index): ChatStep => ({ call, arguments: prepareCall(turn, call, start + index), state: "planned" }));
    turn.transcript.push({ role: "assistant", content: output.text || null, toolCalls: output.calls });
    turn.steps.push(...steps); turn.rounds++;
    await this.persist(principal, turn);
  }
  private rememberReceipt(turn: StoredTurn, value: ChatReceipt) {
    const key = "requestId" in value ? value.requestId : value.id;
    const index = turn.receipts.findIndex(item => ("requestId" in item ? item.requestId : item.id) === key);
    if (index >= 0) turn.receipts[index] = value; else turn.receipts.push(value);
    turn.refreshRequired = true;
    this.observe(turn, value, true);
  }
  private async execute(principal: Principal, turn: StoredTurn, client: ChatMcpClient, signal: AbortSignal): Promise<boolean> {
    for (const step of turn.steps) {
      if (step.state === "completed") continue;
      const recovering = step.state === "calling";
      step.state = "calling"; await this.persist(principal, turn);
      let result: unknown;
      if (recovering && mutationTools.has(step.call.name) && step.call.name !== "bubu_resolve_media") {
        try { result = await this.call(principal, turn, client, "bubu_get_request", { babyId: turn.babyId, requestId: step.arguments.requestId, retry: true }, signal); }
        catch (error) { if (!(error instanceof McpToolError && error.code === "REQUEST_NOT_FOUND")) throw error; }
      }
      if (result === undefined) result = await this.call(principal, turn, client, step.call.name, step.arguments, signal);
      const saved = receipt(result);
      if (mutationTools.has(step.call.name) && !saved) throw new McpToolError("CHAT_MCP_RESPONSE_INVALID", "记录服务没有返回有效保存回执，请继续处理原请求。", true);
      step.result = result;
      if (saved) this.rememberReceipt(turn, saved); else this.observe(turn, result);
      if (saved && "status" in saved && saved.status === "pending_projection") {
        turn.status = "needs_recovery"; turn.error = { code: "CHAT_PROJECTION_PENDING", message: "记录或统计尚未确认完成，请继续处理。", retryable: true };
        turn.assistantText = confirmedReply(turn.receipts, turn.pending);
        await this.persist(principal, turn); return false;
      }
      step.state = "completed";
      turn.transcript.push({ role: "tool", toolCallId: step.call.id, content: JSON.stringify(result) });
      await this.persist(principal, turn);
      if (saved && "status" in saved && saved.status === "conflict") {
        turn.pending = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId: turn.babyId }, signal));
        turn.assistantText = confirmedReply(turn.receipts, turn.pending); turn.status = "completed";
        await this.persist(principal, turn); return false;
      }
    }
    return true;
  }
  private failure(error: unknown): ChatError {
    if (error instanceof McpToolError) return { code: error.code, message: error.message, retryable: error.retryable };
    if (error instanceof AppError) return { code: error.code, message: error.message, retryable: error.status >= 500 };
    if (error instanceof z.ZodError) return { code: "CHAT_PLAN_INVALID", message: "模型提出的操作不符合记录规则，请核对后重新说明。", retryable: false };
    return { code: "CHAT_SERVICE_UNAVAILABLE", message: "处理暂未完成，输入和已确认结果仍保留，请继续处理。", retryable: true };
  }
  private async run(principal: Principal, turn: StoredTurn, signal: AbortSignal): Promise<ChatTurn> {
    let client: ChatMcpClient | undefined;
    try {
      client = await abortable(this.connect(principal, turn.babyId, signal), signal);
      const tools = await abortable(client.tools(), signal); await this.check(principal, turn.babyId);
      await this.context(principal, turn, client, signal);
      if (typeof turn.modelContext?.imageAmbiguity === "string") {
        turn.assistantText = turn.modelContext.imageAmbiguity; turn.status = "completed";
        await this.persist(principal, turn); return this.publicTurn(turn);
      }
      while (true) {
        if (!await this.execute(principal, turn, client, signal)) return this.publicTurn(turn);
        if (turn.rounds >= 10 || turn.steps.length >= 24) throw new AppError(409, "CHAT_STEP_LIMIT", "这一轮步骤较多，已确认结果仍保留。请查看记录后继续说明。");
        const messages = await this.messages(principal, turn);
        await this.check(principal, turn.babyId);
        const output = outputSchema.parse(await abortable(this.options.provider!.complete({ instructions: CHAT_INSTRUCTIONS, messages, tools: modelTools(tools), signal }), signal));
        await this.check(principal, turn.babyId);
        if (output.calls.some(call => !tools.some(tool => tool.name === call.name))) throw new AppError(409, "CHAT_TOOL_FORBIDDEN", "模型请求了未授权工具，未执行修改。");
        if (output.calls.length) { await this.plan(principal, turn, output); continue; }
        turn.pending = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId: turn.babyId }, signal));
        turn.assistantText = turn.receipts.length ? confirmedReply(turn.receipts, turn.pending) : uncommittedReply(output.text);
        turn.status = "completed"; delete turn.error;
        await this.persist(principal, turn);
        await this.check(principal, turn.babyId);
        return this.publicTurn(turn);
      }
    } catch (error) {
      // Revoked/expired principals must not publish late model output or read a stale chat result.
      await this.check(principal, turn.babyId);
      turn.error = this.failure(error);
      turn.status = turn.error.retryable && turn.steps.some(step => step.state !== "completed" && mutationTools.has(step.call.name)) ? "needs_recovery" : "failed";
      turn.assistantText = [confirmedReply(turn.receipts, []), turn.error.message].filter(Boolean).join("\n");
      await this.persist(principal, turn);
      return this.publicTurn(turn);
    } finally { await client?.close().catch(() => undefined); }
  }
  async close(): Promise<void> {
    this.closing = true;
    for (const controller of this.controllers) controller.abort();
    // Provider and MCP waits are abortable even when an injected implementation ignores its signal.
    await Promise.allSettled([...this.active.values()]);
  }
}
