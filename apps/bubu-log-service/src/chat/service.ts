import { safetyCategory, safetyNotice } from "../safety/notice";
import { z } from "zod";
import type { PayloadRequest } from "payload";
import { AppError } from "../contracts";
import type { IdentityService, Principal } from "../identity";
import type { AttachmentService } from "../records/attachments";
import { hash } from "../records/persistence";
import type { CareEvent, PendingQuestion } from "../records/types";
import type { CarePreferencesView } from "../records/preferences";
import { chatInputSchema, structuredFormAnswerSchema, type AutomaticActivityMessage, type ChatError, type ChatHistory, type ChatInput, type ChatPending, type ChatProvider, type ChatReceipt, type ChatTurn, type ProviderContent, type ProviderMessage, type ProviderOutput, type ReplyChoice, type ReplyQuestion, type StructuredFormAnswer } from "./contracts";
import { ChatRepository, type ChatStep, type StoredTurn } from "./persistence";
import { ChatMcpClient, McpToolError, mutationTools } from "./mcp";
import { CHAT_INSTRUCTIONS, modelTools, prepareCall, validateStructuredAnswer } from "./policy";
import { buildPendingForm, confirmedReply, pendingReplyQuestions, structuredAnswerText, uncommittedReply, validatePendingFormPresentation } from "./presentation";
import { bindCandidateQuestions, deterministicCandidateIssues, hiddenRequestIssues, parseReplyCandidate, parseReplyVerdict, REPLY_OUTPUT_INSTRUCTIONS, REPLY_VALIDATOR_INSTRUCTIONS, replyCandidateJsonSchema, replyVerdictJsonSchema, safeHistoricalReply, validateRenderableQuestions, type ReplyCandidate } from "./reply-gate";

interface ChatServiceOptions { mcpUrl: string | URL; provider?: ChatProvider; fetch?: typeof fetch; safetySignal?: (babyId: string, id: string, text: string, at: string, req: PayloadRequest) => Promise<void>; authorizeModel?: (principal: Principal, babyId: string, images: boolean) => Promise<void> }
const outputSchema = z.object({ text: z.string().max(16000), calls: z.array(z.object({ id: z.string().min(1).max(200), name: z.string().max(100), arguments: z.record(z.string(), z.unknown()) }).strict()).max(8) }).strict();
const batchParseSchema = z.object({ answers: z.array(z.object({ questionId: z.string().min(1).max(200), patch: structuredFormAnswerSchema }).strict()).max(25) }).strict();
export const batchParseJsonSchema = z.toJSONSchema(batchParseSchema) as Record<string, unknown>;
function mergeStructuredAnswers(explicit: StructuredFormAnswer | undefined, parsed: StructuredFormAnswer | undefined): StructuredFormAnswer | undefined {
  if (!explicit) return parsed;
  if (!parsed) return explicit;
  const overlap = (left: object | undefined, right: object | undefined) => Object.keys(left || {}).some(key => Object.prototype.hasOwnProperty.call(right || {}, key));
  if (overlap(explicit.facts, parsed.facts) || overlap(explicit.states, parsed.states) || explicit.progress !== undefined && parsed.progress !== undefined) {
    throw new AppError(409, "CHAT_BATCH_PARSE_OVERWRITE", "补充说明试图改写已经明确选择的字段，未执行任何修改。");
  }
  const itemAnswers = new Map<string, NonNullable<StructuredFormAnswer["milkItemAnswers"]>[number]>();
  for (const answer of explicit.milkItemAnswers || []) itemAnswers.set(answer.milkItemId, structuredClone(answer));
  for (const answer of parsed.milkItemAnswers || []) {
    const known = itemAnswers.get(answer.milkItemId);
    if (known && (overlap(known.facts, answer.facts) || overlap(known.states, answer.states))) {
      throw new AppError(409, "CHAT_BATCH_PARSE_OVERWRITE", "补充说明试图改写已经明确选择的奶品答案，未执行任何修改。");
    }
    itemAnswers.set(answer.milkItemId, known ? {
      milkItemId: answer.milkItemId,
      ...((known.facts || answer.facts) ? { facts: { ...known.facts, ...answer.facts } } : {}),
      ...((known.states || answer.states) ? { states: { ...known.states, ...answer.states } } : {}),
    } : structuredClone(answer));
  }
  return {
    facts: { ...(explicit.facts || {}), ...(parsed.facts || {}) },
    ...((explicit.states || parsed.states) ? { states: { ...explicit.states, ...parsed.states } } : {}),
    ...(explicit.progress !== undefined ? { progress: explicit.progress } : parsed.progress !== undefined ? { progress: parsed.progress } : {}),
    ...(itemAnswers.size ? { milkItemAnswers: [...itemAnswers.values()] } : {}),
  };
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const dateInShanghai = (time: string) => new Date(Date.parse(time) + 8 * 3600_000).toISOString().slice(0, 10);
function pending(value: unknown): ChatPending[] {
  return list(value).filter(item => typeof object(item).id === "string" && object(item).state === "open").map(item => ({ ...object(item), kind: object(item).kind === "media" ? "media" : "fields" }) as ChatPending);
}
function prompted(questions: ChatPending[], events: unknown[], preferences?: CarePreferencesView): ChatPending[] {
  const result = questions.map(question => {
    // Old persisted pending rows may contain a prose `prompt`/derived `form`
    // from an earlier chat presentation. Never republish that text: rebuild the
    // only current presentation from authoritative pending state and events.
    const { prompt: _legacyPrompt, form: _legacyForm, ...base } = question as ChatPending & { prompt?: unknown; form?: unknown };
    void _legacyPrompt; void _legacyForm;
    const event = question.kind === "fields" ? events.find(item => object(item).id === question.eventId) as CareEvent | undefined : undefined;
    if (question.kind !== "fields") return base as ChatPending;
    let form: ReturnType<typeof buildPendingForm>;
    try { form = buildPendingForm(question, event, preferences); }
    catch { form = undefined; }
    const fields = form?.controls.some(control => control.field === "durationMinutes") && question.fields.includes("endTime") && !question.fields.includes("durationMinutes")
      ? [...question.fields, "durationMinutes" as const] : question.fields;
    const candidate = { ...base, fields, ...(form ? { form } : {}) } as ChatPending;
    if (!form || validatePendingFormPresentation([candidate]).length) return {
      ...base, prompt: "这项待补表单暂时无法显示。",
    } as ChatPending;
    return candidate;
  });
  return result;
}
function receipt(value: unknown): ChatReceipt | undefined {
  const item = object(value);
  if (typeof item.requestId === "string" && ["saved", "needs_information", "pending_projection", "conflict"].includes(String(item.status)) && Array.isArray(item.events) && Array.isArray(item.questions) && typeof item.retryable === "boolean") return value as ChatReceipt;
  if (item.kind === "media" && typeof item.id === "string" && typeof item.sourceId === "string" && ["resolved", "open"].includes(String(item.state)) && ["provided", "unknown"].includes(String(item.resolution))) return value as ChatReceipt;
  if (item.kind === "care_preferences_changed" && typeof item.requestId === "string" && typeof item.version === "number" && Array.isArray(item.changedKeys) && typeof item.text === "string" && object(item.preferences).babyId) return value as ChatReceipt;
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
  private async checkService(principal: Principal, babyId: string) {
    await this.authorized(principal, babyId, true, req => this.identity.assertService(babyId, "chat", req));
  }
  private publishServer(turn: StoredTurn, text: string, questions: ReplyQuestion[] = pendingReplyQuestions(turn.pending)) {
    const renderIssues = validateRenderableQuestions(questions);
    const proseIssues = hiddenRequestIssues(text);
    if (renderIssues.length || proseIssues.length) {
      const receiptText = confirmedReply(turn.receipts, []);
      turn.assistantText = [receiptText, "这次回复暂未完成；已确认的记录结果仍保留。"].filter(Boolean).join("\n");
      turn.replyQuestions = validateRenderableQuestions(pendingReplyQuestions(turn.pending)).length ? [] : pendingReplyQuestions(turn.pending);
    } else {
      turn.assistantText = text;
      turn.replyQuestions = questions;
    }
    turn.replyGate = { checked: true, kind: "server", version: 1 };
  }
  private publishModel(turn: StoredTurn, candidate: ReplyCandidate) {
    turn.assistantText = candidate.text;
    turn.replyQuestions = bindCandidateQuestions(candidate, { kind: "turn", turnId: turn.id, ...(turn.input.context.selectedEventId ? { selectedEventId: turn.input.context.selectedEventId } : {}), ...(turn.input.context.mediaPendingId ? { mediaPendingId: turn.input.context.mediaPendingId } : {}), ...(turn.input.question ? { question: turn.input.question } : {}) });
    turn.replyGate = { checked: true, kind: "model", version: 1 };
  }
  private async semanticIssues(principal: Principal, turn: StoredTurn, candidate: ReplyCandidate, signal: AbortSignal): Promise<string[]> {
    await this.checkService(principal, turn.babyId);
    await this.options.authorizeModel?.(principal, turn.babyId, false);
    const output = outputSchema.parse(await abortable(this.options.provider!.complete({
      instructions: REPLY_VALIDATOR_INSTRUCTIONS,
      messages: [{ role: "user", content: JSON.stringify({ type: "bubu_reply_candidate", candidate }) }],
      tools: [], responseFormat: { name: "bubu_reply_verdict", schema: replyVerdictJsonSchema }, signal,
    }), signal));
    await this.checkService(principal, turn.babyId);
    if (output.calls.length) return ["语义校验器错误地返回了工具调用"];
    try {
      const verdict = parseReplyVerdict(output.text);
      return verdict.verdict === "pass" ? [] : verdict.issues;
    } catch { return ["语义校验器没有返回严格 verdict JSON"]; }
  }
  private async gatedCandidate(principal: Principal, turn: StoredTurn, initial: string, signal: AbortSignal): Promise<ReplyCandidate | undefined> {
    let raw = initial;
    let priorIssues: string[] = [];
    for (let attempt = 0; attempt <= 2; attempt++) {
      let candidate: ReplyCandidate | undefined;
      const issues: string[] = [];
      try { candidate = parseReplyCandidate(raw); }
      catch { issues.push("回复不符合严格的 {text,questions} JSON Schema"); }
      if (candidate) {
        candidate = { ...candidate, text: uncommittedReply(candidate.text) };
        issues.push(...deterministicCandidateIssues(candidate));
        issues.push(...await this.semanticIssues(principal, turn, candidate, signal));
      }
      const specific = [...new Set(issues)];
      if (candidate && !specific.length) return candidate;
      priorIssues = specific;
      if (attempt === 2) break;
      await this.checkService(principal, turn.babyId);
      await this.options.authorizeModel?.(principal, turn.babyId, false);
      const regenerated = outputSchema.parse(await abortable(this.options.provider!.complete({
        instructions: `${REPLY_OUTPUT_INSTRUCTIONS}\n这是回复专用重新生成：tools 为空，禁止提出或模拟任何工具调用，禁止声称再次执行记录写入。`,
        messages: [{ role: "user", content: JSON.stringify({ type: "bubu_reply_regeneration", issues: specific, rejectedCandidate: raw.slice(0, 16000), confirmedReceiptText: confirmedReply(turn.receipts, []), currentPending: turn.pending }) }],
        tools: [], responseFormat: { name: "bubu_chat_reply", schema: replyCandidateJsonSchema }, signal,
      }), signal));
      await this.checkService(principal, turn.babyId);
      if (regenerated.calls.length) {
        raw = "";
        priorIssues = ["回复专用重新生成返回了工具调用，未执行这些调用"];
      } else raw = regenerated.text;
    }
    this.publishServer(turn, [confirmedReply(turn.receipts, []), "这次回复暂未完成；已确认的记录结果仍保留。"].filter(Boolean).join("\n"), pendingReplyQuestions(turn.pending));
    turn.modelContext = { ...(turn.modelContext || {}), replyGateFailureCount: priorIssues.length };
    return undefined;
  }
  private publicTurn(turn: StoredTurn, includeQuestions = true): ChatTurn {
    const { id, requestId, conversationId, babyId, createdAt, updatedAt, input, receipts, pending: questions, refreshRequired, batchProgress, error } = turn;
    // A process restart leaves a durable checkpoint, not an eternally spinning message.
    const status = turn.status === "processing" && !this.active.has(turn.id) ? "needs_recovery" : turn.status;
    const events = [...list(turn.modelContext?.events), ...receipts.flatMap(item => "events" in item ? item.events : [])];
    const trustedReply = turn.replySource === "safety" || turn.replyGate?.version === 1;
    const storedQuestions = includeQuestions && trustedReply ? (turn.replyQuestions || []) : [];
    const replyQuestions = validateRenderableQuestions(storedQuestions).length ? [] : storedQuestions;
    const assistantText = turn.replySource === "safety" ? turn.assistantText || "" : safeHistoricalReply(turn.assistantText || "", replyQuestions, turn.replyGate, confirmedReply(turn.receipts, questions));
    const preferences = object(turn.modelContext?.preferences) as unknown as CarePreferencesView;
    return { id, requestId, conversationId, babyId, createdAt, updatedAt, status, input, assistantText, replyQuestions, replySource: turn.replySource || "ai", receipts,
      pending: prompted(questions, events.reverse(), preferences?.babyId === babyId ? preferences : undefined), refreshRequired, ...(batchProgress ? { batchProgress } : {}), ...(error ? { error } : {}) };
  }
  private async persist(principal: Principal, turn: StoredTurn) {
    if (turn.status === "completed" && turn.replySource !== "safety" && !turn.replyGate?.checked) {
      this.publishServer(turn, [confirmedReply(turn.receipts, []), "这次回复暂未完成；已确认的记录结果仍保留。"].filter(Boolean).join("\n"));
    }
    turn.updatedAt = this.now();
    await this.authorized(principal, turn.babyId, true, async req => {
      // Publishing a completed reply and its eligibility check share one transaction.
      // Recovery checkpoints remain writable while the service is paused.
      if (turn.status === "completed") await this.identity.assertService(turn.babyId, "chat", req);
      await this.repository.put(turn, req);
    });
  }
  private async connect(principal: Principal, babyId: string, signal?: AbortSignal, readOnly = false) {
    const delegated = await this.identity.issueAgent(principal, babyId, "chat-agent", { readOnly });
    const client = new ChatMcpClient(this.options.mcpUrl, delegated.token, this.options.fetch, signal);
    try { await client.connect(); await (readOnly ? this.check(principal, babyId) : this.checkService(principal, babyId)); return client; }
    catch (error) { await client.close().catch(() => undefined); throw error; }
  }
  private async call(principal: Principal, turn: Pick<StoredTurn, "babyId">, client: ChatMcpClient, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    await (signal ? this.checkService(principal, turn.babyId) : this.check(principal, turn.babyId));
    if (signal?.aborted) throw new AppError(503, "CHAT_INTERRUPTED", "处理已暂停，可以继续处理。");
    const result = signal ? await abortable(client.call(name, args), signal) : await client.call(name, args);
    await (signal ? this.checkService(principal, turn.babyId) : this.check(principal, turn.babyId));
    return result;
  }
  async history(principal: Principal, babyId: string): Promise<ChatHistory> {
    const turns = await this.authorized(principal, babyId, false, req => this.repository.list(principal.subjectId, babyId, req));
    const client = await this.connect(principal, babyId, undefined, true);
    try {
      const rawQuestions = pending(await this.call(principal, { babyId }, client, "bubu_get_pending", { babyId }));
      const events = rawQuestions.length ? list(object(await this.call(principal, { babyId }, client, "bubu_query_events", { babyId, includeRetracted: true })).events) : [];
      const preferences = object(await this.call(principal, { babyId }, client, "bubu_get_care_preferences", { babyId })) as unknown as CarePreferencesView;
      const questions = prompted(rawQuestions, events, preferences);
      const activity = object(await this.call(principal, { babyId }, client, "bubu_get_record_activity", { babyId, limit: 100 }));
      const automaticMessages = list(activity.messages) as AutomaticActivityMessage[];
      await this.check(principal, babyId);
      const latestCompleted = [...turns].reverse().find(turn => turn.status === "completed");
      const latestQuestionTurn = latestCompleted && (latestCompleted.replyQuestions || []).length ? latestCompleted.id : undefined;
      const currentReplyQuestions = pendingReplyQuestions(rawQuestions, events as CareEvent[]);
      const publicTurns = turns.map(turn => this.publicTurn(turn, turn.id === latestQuestionTurn)).map(turn => ({ ...turn, replyQuestions: (turn.replyQuestions || []).filter(question => question.origin.kind === "turn") }));
      return { conversationId: this.conversation(principal, babyId), babyId, turns: publicTurns, pending: questions, pendingCount: questions.length, replyQuestions: currentReplyQuestions, automaticMessages,
        ...(preferences.firstWeekSummary ? { firstWeekNotice: preferences.firstWeekSummary } : {}) };
    } finally { await client.close().catch(() => undefined); }
  }
  async request(principal: Principal, babyId: string, requestId: string): Promise<ChatTurn | null> {
    return this.authorized(principal, babyId, false, async req => {
      const turn = await this.repository.get(principal.subjectId, babyId, this.turnId(principal, babyId, requestId), req);
      return turn ? this.publicTurn(turn) : null;
    });
  }
  private applyChoice(input: Omit<ChatInput, "babyId" | "requestId">, question: ReplyQuestion, choice: ReplyChoice): Omit<ChatInput, "babyId" | "requestId"> {
    const origin = question.origin;
    if (input.formAnswer) throw new AppError(400, "CHAT_CHOICE_INVALID", "选择题回答不能同时提交字段表单。");
    const context = {
      viewedDate: input.context.viewedDate,
      ...(origin.selectedEventId ? { selectedEventId: origin.selectedEventId } : {}),
      ...(origin.mediaPendingId ? { mediaPendingId: origin.mediaPendingId } : {}),
    };
    const common = { ...input, context, ...(origin.question ? { question: origin.question } : { question: undefined }) };
    if (choice.action.type === "reply") {
      if (input.attachmentIds.length) throw new AppError(400, "CHAT_CHOICE_INVALID", "这个选项不接收照片。");
      return { ...common, text: choice.action.text, attachmentIds: [] };
    }
    if (choice.action.type === "custom" || choice.action.type === "input") {
      if (!input.text.trim() || input.attachmentIds.length) throw new AppError(400, "CHAT_CHOICE_CUSTOM_REQUIRED", "选择自定义后需要填写文字回答。");
      return { ...common, text: input.text.trim(), attachmentIds: [] };
    }
    if (choice.action.type === "attach") {
      if (!input.attachmentIds.length) throw new AppError(400, "CHAT_CHOICE_ATTACHMENT_REQUIRED", "这个选项需要先选择照片。");
      return { ...common, text: choice.action.text, attachmentIds: input.attachmentIds };
    }
    if (input.attachmentIds.length) throw new AppError(400, "CHAT_CHOICE_INVALID", "照片引用选项不能再附加其他照片。");
    return { ...common, text: choice.action.text, attachmentIds: [...choice.action.attachmentIds] };
  }
  private async resolveTurnChoice(principal: Principal, input: ChatInput): Promise<ChatInput> {
    const answer = input.choiceAnswer;
    if (!answer?.originTurnId) return input;
    const resolved = await this.authorized(principal, input.babyId, false, async req => {
      const origin = await this.repository.get(principal.subjectId, input.babyId, answer.originTurnId!, req);
      if (!origin || origin.status !== "completed") throw new AppError(409, "CHAT_CHOICE_EXPIRED", "这组选项已经不可用，已保留当前草稿。");
      const newer = (await this.repository.list(principal.subjectId, input.babyId, req)).some(turn => turn.id !== origin.id && turn.requestId !== input.requestId && turn.status === "completed" && (turn.createdAt > origin.createdAt || turn.input.choiceAnswer?.originTurnId === origin.id));
      if (newer) throw new AppError(409, "CHAT_CHOICE_EXPIRED", "对话上下文已经更新，请按最新选项处理。");
      const question = (origin.replyQuestions || []).find(item => item.id === answer.questionId && item.origin.turnId === origin.id);
      const choice = question?.choices.find(item => item.id === answer.choiceId);
      if (!question || !choice) throw new AppError(409, "CHAT_CHOICE_EXPIRED", "这组选项已经变化，请按最新选项处理。");
      const { babyId: _babyId, requestId: _requestId, ...message } = input;
      void _babyId; void _requestId;
      const applied = this.applyChoice(message, question, choice);
      const eventVersion = question.origin.selectedEventId ? origin.versions[question.origin.selectedEventId] : undefined;
      return { ...applied, choiceAnswer: { ...applied.choiceAnswer!, ...(eventVersion ? { eventVersion } : {}) } };
    });
    return { babyId: input.babyId, requestId: input.requestId, ...resolved };
  }
  async submit(principal: Principal, raw: ChatInput): Promise<ChatTurn> {
    let input = chatInputSchema.parse(raw);
    input = await this.resolveTurnChoice(principal, input);
    const urgent = !input.formBatch && safetyCategory(input.text);
    const needsModel = !urgent && (input.formBatch ? input.formBatch.some(item => !!item.text) : !input.formAnswer);
    if (needsModel) await this.options.authorizeModel?.(principal, input.babyId, input.attachmentIds.length > 0);
    if (needsModel && !this.options.provider) throw new AppError(503, "CHAT_PROVIDER_NOT_CONFIGURED", "对话模型尚未配置，暂时不能发送。已保存的记录仍可查看。");
    if (this.closing) throw new AppError(503, "CHAT_INTERRUPTED", "服务正在重启，请稍后用原请求继续。");
    const { babyId, requestId, ...rawMessage } = input;
    // Existing ordinary turns fingerprint the complete parsed request. Keep that
    // shape so an upgrade cannot invalidate recovery. A typed form replaces prose
    // with the server-derived summary and fingerprints the normalized request.
    const message = input.formBatch ? { ...rawMessage, text: `统一提交 ${input.formBatch.length} 项待补回答。` }
      : input.formAnswer ? { ...rawMessage, text: structuredAnswerText(input.formAnswer) } : rawMessage;
    const id = this.turnId(principal, input.babyId, input.requestId);
    const fingerprint = input.formAnswer || input.formBatch ? hash({ ...input, text: message.text }) : hash(input);
    const turn = await this.authorized(principal, input.babyId, true, async req => {
      const previous = await this.repository.get(principal.subjectId, input.babyId, id, req);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new AppError(409, "CHAT_REQUEST_REUSED", "同一请求号不能用于不同内容，请核对原输入。");
        if (previous.status === "completed" || previous.error?.retryable === false || this.active.has(id)) return previous;
      }
      if (!urgent) await this.identity.assertService(input.babyId, "chat", req);
      const blocker = (await this.repository.list(principal.subjectId, input.babyId, req)).find(item => item.id !== id && ["processing", "needs_recovery"].includes(item.status));
      if (!urgent && blocker) throw new AppError(409, "CHAT_PREVIOUS_PENDING", "上一条还在处理或等待恢复，请先处理上一条。");
      const row: StoredTurn = previous ?? { id, identityId: principal.subjectId, conversationId: this.conversation(principal, babyId), babyId, requestId, fingerprint,
        createdAt: this.now(), updatedAt: this.now(), input: message, status: "processing", assistantText: "", replyQuestions: [], receipts: [], pending: [], refreshRequired: false,
        transcript: [], steps: [], rounds: 0, versions: {}, questionVersions: {}, };
      if (input.formBatch && !row.batchProgress) row.batchProgress = { total: input.formBatch.length, completed: 0 };
      row.status = urgent ? "completed" : "processing"; delete row.error;
      if (urgent) { row.replySource = "safety"; row.assistantText = safetyNotice; row.replyQuestions = []; row.replyGate = { checked: true, kind: "safety", version: 1 }; await this.options.safetySignal?.(input.babyId, id, input.text, row.createdAt, req); }
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
    if (value.babyId === turn.babyId && typeof value.version === "number" && Array.isArray(value.options) && turn.preferenceVersion === undefined) turn.preferenceVersion = value.version;
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
    let ambiguousReferences: Reference[] = [];
    let noReference = false;
    if (!references.length && selectedEvent && !imageLinkAction) {
      const selected = object(selectedEvent);
      references = list(selected.attachmentIds).filter((id): id is string => typeof id === "string").map(attachmentId => ({ attachmentId, source: "selected-event", eventId: String(selected.id) }));
      if (references.length > 3) { if (wantsImageInterpretation) ambiguousReferences = references.slice(0, 8); references = []; }
    }
    if (!references.length && !ambiguousReferences.length && wantsImageInterpretation && !selectedEvent) {
      const history = await this.authorized(principal, turn.babyId, false, req => this.repository.list(principal.subjectId, turn.babyId, req));
      const recent = history.filter(item => item.id !== turn.id && item.createdAt <= turn.createdAt && item.status === "completed" && item.input.attachmentIds.length).at(-1);
      if (recent) {
        if (recent.input.attachmentIds.length > 1 && !/这些|这几张|都|全部|一起/.test(turn.input.text)) ambiguousReferences = recent.input.attachmentIds.slice(0, 3).map(attachmentId => ({ attachmentId, source: "previous-turn", turnId: recent.id }));
        else references = recent.input.attachmentIds.slice(0, 3).map(attachmentId => ({ attachmentId, source: "previous-turn", turnId: recent.id }));
      } else noReference = true;
    }
    const origin = { kind: "turn" as const, turnId: turn.id, ...(turn.input.context.selectedEventId ? { selectedEventId: turn.input.context.selectedEventId } : {}) };
    const imageQuestion: ReplyQuestion | undefined = ambiguousReferences.length ? {
      id: `image-${turn.id}`, prompt: "这次要查看哪张照片？", origin,
      choices: [
        ...ambiguousReferences.map((reference, index) => ({ id: `reference-${index + 1}`, label: `第 ${index + 1} 张`, action: { type: "reference" as const, text: `查看所选的第 ${index + 1} 张照片`, attachmentIds: [reference.attachmentId] } })),
        { id: "attach-new", label: "添加新照片", action: { type: "attach" as const, text: "查看这次新选择的照片" } },
        { id: "skip-image", label: "暂不查看", action: { type: "reply" as const, text: "暂不查看照片" } },
      ],
    } : noReference ? {
      id: `image-${turn.id}`, prompt: "当前没有可确认对应的照片，要怎么继续？", origin,
      choices: [
        { id: "attach-new", label: "添加新照片", action: { type: "attach", text: "查看这次新选择的照片" } },
        { id: "text-only", label: "改用文字说明", action: { type: "reply", text: "不看照片，改用文字说明" } },
        { id: "handle-later", label: "稍后处理", action: { type: "reply", text: "照片稍后再处理" } },
      ],
    } : undefined;
    return { imageReferences: references, imageEvidenceOnly: turn.input.attachmentIds.length > 0 || (wantsImageInterpretation && references.length > 0), ...(imageQuestion ? { imageQuestion } : {}) };
  }
  private async context(principal: Principal, turn: StoredTurn, client: ChatMcpClient, signal: AbortSignal) {
    if (turn.modelContext) return;
    const { babyId } = turn;
    const rules = await this.call(principal, turn, client, "bubu_get_rules", { babyId }, signal);
    const preferences = object(await this.call(principal, turn, client, "bubu_get_care_preferences", { babyId }, signal)) as unknown as CarePreferencesView;
    this.observe(turn, preferences);
    const questions = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId }, signal));
    if (turn.input.choiceAnswer && !turn.input.choiceAnswer.originTurnId) {
      const answer = turn.input.choiceAnswer;
      const replyQuestion = pendingReplyQuestions(questions).find(item => item.id === answer.questionId);
      const choice = replyQuestion?.choices.find(item => item.id === answer.choiceId);
      if (!replyQuestion || !choice) throw new McpToolError("QUESTION_STALE", "选择题已经变化，请刷新后按当前选项处理。", false);
      const origin = replyQuestion.origin;
      if (origin.question && (turn.input.question?.id !== origin.question.id || turn.input.question.questionVersion !== origin.question.questionVersion || turn.input.question.eventVersion !== origin.question.eventVersion)) throw new McpToolError("QUESTION_STALE", "选择题版本已经变化，请刷新后按当前选项处理。", false);
      if (origin.mediaPendingId && turn.input.context.mediaPendingId !== origin.mediaPendingId) throw new McpToolError("QUESTION_STALE", "待补照片已经变化，请刷新后按当前选项处理。", false);
      turn.input = this.applyChoice(turn.input, replyQuestion, choice);
    }
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
      if (turn.input.choiceAnswer?.eventVersion && object(selectedEvent).version !== turn.input.choiceAnswer.eventVersion) throw new McpToolError("CHAT_CHOICE_EXPIRED", "所选记录已经变化，请按最新记录重新选择。", false);
      events.push(selectedEvent);
    }
    const question = turn.input.question;
    if (question) {
      const current = questions.find(item => item.kind === "fields" && item.id === question.id) as (PendingQuestion & { kind: "fields" }) | undefined;
      if (!current || current.version !== question.questionVersion || current.eventVersion !== question.eventVersion) throw new McpToolError("QUESTION_STALE", "问题已经变化，请刷新待补事项后核对新问题。", false);
      if (turn.input.formAnswer) validateStructuredAnswer(turn, current, turn.input.formAnswer, selectedId, selectedEvent as CareEvent);
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
      pending: questions, rules, preferences, events: uniqueEvents, summary: selectedDate.summary, ...imageContext };
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
      const image = await this.attachments.readForModel(principal, turn.babyId, id);
      await this.checkService(principal, turn.babyId);
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
  private async planBatch(principal: Principal, turn: StoredTurn, client: ChatMcpClient, signal: AbortSignal) {
    const batch = turn.input.formBatch;
    if (!batch || turn.steps.length) return;
    const questions = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId: turn.babyId }, signal));
    const events = list(object(await this.call(principal, turn, client, "bubu_query_events", { babyId: turn.babyId, includeRetracted: true }, signal)).events) as CareEvent[];
    turn.pending = questions;
    turn.modelContext = { type: "bubu_form_batch_context", events, pending: questions };
    this.observe(turn, { events, questions });

    const byQuestion = new Map<string, PendingQuestion>();
    for (const item of batch) {
      const current = questions.find(question => question.kind === "fields" && question.id === item.question.id) as PendingQuestion | undefined;
      const event = events.find(candidate => candidate.id === item.eventId);
      if (!current || current.state !== "open" || current.eventId !== item.eventId || current.version !== item.question.questionVersion || current.eventVersion !== item.question.eventVersion) {
        throw new McpToolError("QUESTION_STALE", "批量待补中的问题已经变化，请保留草稿并按当前问题重新核对。", false);
      }
      if (!event || event.lifecycle !== "active" || event.version !== item.question.eventVersion) throw new McpToolError("VERSION_CONFLICT", "批量待补中的记录已经变化，请保留草稿并刷新后核对。", false);
      byQuestion.set(item.question.id, current);
      if (item.formAnswer) validateStructuredAnswer(turn, current, item.formAnswer, item.eventId, event);
    }

    const parsed = new Map<string, StructuredFormAnswer>();
    const textItems = batch.filter(item => !!item.text);
    if (textItems.length) {
      await this.checkService(principal, turn.babyId);
      await this.options.authorizeModel?.(principal, turn.babyId, false);
      const output = outputSchema.parse(await abortable(this.options.provider!.complete({
        instructions: "你只把每项用户文字解析成对应待补问题允许的结构化字段。不得创建、合并、改目标、确认重复或确认时间重叠；不得补写用户没有表达的事实。explicitAnswer 是用户已经点击或填写的权威答案，绝不能在 patch 中重复、改写或重新解释它，只解析补充文字表达的其他允许字段。瓶喂逐项答案必须使用给定 milkItemId 和 milkItemAnswers；不能写根级奶量或奶源，不能触碰已知兄弟项。unknown 表示明确不知道，not_yet 表示尚未发生。严格返回指定 JSON，tools 为空。",
        messages: [{ role: "user", content: JSON.stringify({ type: "bubu_form_batch_parse", items: textItems.map(item => {
          const question = byQuestion.get(item.question.id)!;
          const event = events.find(candidate => candidate.id === item.eventId)!;
          return { eventId: item.eventId, questionId: item.question.id, text: item.text,
            allowedFields: [...new Set([...question.fields, ...question.conflicts.flatMap(conflict => conflict.fields)])],
            currentFacts: event.facts, currentProgress: event.progress, explicitAnswer: item.formAnswer };
        }) }) }],
        tools: [], responseFormat: { name: "bubu_form_batch_parse", schema: batchParseJsonSchema, strict: false }, signal,
      }), signal));
      await this.checkService(principal, turn.babyId);
      if (output.calls.length) throw new AppError(409, "CHAT_BATCH_PLAN_INVALID", "自定义待补解析请求了不允许的操作，未执行任何修改。");
      let decoded: z.output<typeof batchParseSchema>;
      try { decoded = batchParseSchema.parse(JSON.parse(output.text)); }
      catch { throw new AppError(409, "CHAT_BATCH_PLAN_INVALID", "自定义待补说明无法安全解析，未执行任何修改。"); }
      if (decoded.answers.length !== textItems.length || new Set(decoded.answers.map(answer => answer.questionId)).size !== decoded.answers.length) throw new AppError(409, "CHAT_BATCH_PLAN_INVALID", "自定义待补解析没有逐项对应原问题，未执行任何修改。");
      for (const answer of decoded.answers) {
        const original = textItems.find(item => item.question.id === answer.questionId);
        const question = original && byQuestion.get(answer.questionId);
        if (!original || !question) throw new AppError(409, "CHAT_BATCH_TARGET_MISMATCH", "自定义待补解析包含无关目标，未执行任何修改。");
        validateStructuredAnswer(turn, question, answer.patch, original.eventId, events.find(candidate => candidate.id === original.eventId));
        parsed.set(answer.questionId, answer.patch);
      }
    }

    const replyQuestions = pendingReplyQuestions(questions, events);
    const plans = batch.map(item => {
      const pins = { eventId: item.eventId, questionId: item.question.id, questionVersion: item.question.questionVersion, eventVersion: item.question.eventVersion };
      const current = byQuestion.get(item.question.id)!;
      const event = events.find(candidate => candidate.id === item.eventId)!;
      const answer = mergeStructuredAnswers(item.formAnswer, parsed.get(item.question.id));
      if (answer) validateStructuredAnswer(turn, current, answer, item.eventId, event);
      const choiceAnswer = item.choiceAnswer;
      if (!choiceAnswer) {
        if (current.conflicts.length || current.duplicateCandidates.length) throw new AppError(400, "CHAT_BATCH_CHOICE_REQUIRED", "这条记录还有冲突或重复核对，必须选择对应处理方式，不能只保存字段答案。");
        if (!answer) throw new AppError(400, "CHAT_BATCH_ANSWER_REQUIRED", "这项待补没有可提交的答案。");
        return { kind: "answer", ...pins, patch: { ...answer, facts: answer.facts || {} } };
      }
      if (choiceAnswer.eventVersion && choiceAnswer.eventVersion !== item.question.eventVersion) throw new AppError(409, "CHAT_BATCH_TARGET_MISMATCH", "选项绑定的记录版本与待补问题不一致。");
      const question = replyQuestions.find(candidate => candidate.id === choiceAnswer.questionId && candidate.origin.kind === "pending"
        && candidate.origin.selectedEventId === item.eventId && candidate.origin.question?.id === item.question.id
        && candidate.origin.question.questionVersion === item.question.questionVersion && candidate.origin.question.eventVersion === item.question.eventVersion);
      const choice = question?.choices.find(candidate => candidate.id === choiceAnswer.choiceId);
      if (!question || !choice) throw new McpToolError("QUESTION_STALE", "批量待补中的选项已经变化，请保留草稿并按当前选项重新核对。", false);
      if (choice.action.type === "custom" || choice.action.type === "input") {
        if (!answer) throw new AppError(400, "CHAT_BATCH_CUSTOM_REQUIRED", "选择更正或自定义后需要填写可解析的事实。");
        if (current.duplicateCandidates.length) throw new AppError(409, "CHAT_BATCH_DUPLICATE_CUSTOM_UNSUPPORTED", "疑似重复必须明确选择同一事件或不同事件，不能用自定义文字隐式合并。");
        return { kind: "answer", ...pins, patch: { ...answer, facts: answer.facts || {} } };
      }
      if (choice.id === "defer-conflict") {
        if (answer) throw new AppError(400, "CHAT_BATCH_DEFER_WITH_PATCH", "暂不处理冲突时不能同时提交字段修改；请改选明确处理方式。");
        return { kind: "defer", ...pins };
      }
      const patch = answer ? { patch: { ...answer, facts: answer.facts || {} } } : {};
      if (choice.id === "different-events") return { kind: "resolve_duplicate", ...pins, resolution: "distinct", ...patch };
      if (choice.id.startsWith("same-event-")) {
        if (answer) throw new AppError(409, "CHAT_BATCH_SAME_EVENT_PATCH_AMBIGUOUS", "合并为同一事件时不能同时提交额外字段，以免事实写入错误目标；请先单独核对合并目标。");
        const targetEventId = choice.id.slice("same-event-".length);
        const target = events.find(candidate => candidate.id === targetEventId);
        if (!target) throw new McpToolError("QUESTION_STALE", "重复候选记录已经变化，请刷新后重新核对。", false);
        return { kind: "resolve_duplicate", ...pins, resolution: "same", targetEventId, targetVersion: target.version };
      }
      if (choice.id.startsWith("confirm-overlap-")) {
        const conflictingEventId = choice.id.slice("confirm-overlap-".length);
        const conflictingEvent = events.find(candidate => candidate.id === conflictingEventId);
        if (!conflictingEvent) throw new McpToolError("QUESTION_STALE", "重叠记录已经变化，请刷新后重新核对。", false);
        return { kind: "confirm_overlap", ...pins, conflictingEvents: [{ eventId: conflictingEventId, expectedVersion: conflictingEvent.version }], reason: choice.action.text, ...patch };
      }
      const timeStrategies = {
        "repair-time-use-start-end": "use_start_end", "repair-time-use-start-duration": "use_start_duration",
        "repair-time-use-end-duration": "use_end_duration", "repair-time-end-next-day": "end_next_day",
        "repair-time-mark-ended": "mark_ended", "repair-time-keep-ongoing": "keep_ongoing",
      } as const;
      const strategy = timeStrategies[choice.id as keyof typeof timeStrategies];
      if (strategy) return { kind: "repair_time", ...pins, strategy, ...patch };
      throw new AppError(400, "CHAT_BATCH_CHOICE_UNSUPPORTED", "这个选项不能作为批量写操作提交，请单独核对或填写受支持的答案。");
    });
    turn.batchProgress = { total: batch.length, completed: 0 };
    await this.plan(principal, turn, { text: "", calls: [{ id: "form-batch-submit", name: "bubu_submit_pending_batch", arguments: { items: plans } }] });
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
      if (recovering && mutationTools.has(step.call.name) && step.call.name !== "bubu_resolve_media" && step.call.name !== "bubu_update_care_preferences") {
        try { result = await this.call(principal, turn, client, "bubu_get_request", { babyId: turn.babyId, requestId: step.arguments.requestId, retry: true }, signal); }
        catch (error) { if (!(error instanceof McpToolError && error.code === "REQUEST_NOT_FOUND")) throw error; }
      }
      if (result === undefined) {
        try { result = await this.call(principal, turn, client, step.call.name, step.arguments, signal); }
        catch (error) {
          if (!(error instanceof McpToolError && error.code === "QUESTION_STALE")) throw error;
          // A rejected stale answer did not write. End this turn with fresh questions;
          // never retry a changed question with a newer version on the user's behalf.
          turn.pending = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId: turn.babyId }, signal));
          step.result = { code: error.code, rejected: true }; step.state = "completed";
          turn.transcript.push({ role: "tool", toolCallId: step.call.id, content: JSON.stringify(step.result) });
          this.publishServer(turn, [confirmedReply(turn.receipts, turn.pending), "待补问题已经更新，当前版本显示在下方。"].filter(Boolean).join("\n"));
          if (turn.input.formBatch) {
            turn.status = "failed";
            turn.error = { code: "QUESTION_STALE", message: "批量待补中的问题已经变化；没有确认的草稿仍需保留。", retryable: false };
          } else { turn.status = "completed"; delete turn.error; }
          await this.persist(principal, turn); return false;
        }
      }
      const saved = receipt(result);
      if (mutationTools.has(step.call.name) && !saved) throw new McpToolError("CHAT_MCP_RESPONSE_INVALID", "记录服务没有返回有效保存回执，请继续处理原请求。", true);
      step.result = result;
      if (saved) this.rememberReceipt(turn, saved); else this.observe(turn, result);
      if (saved && step.call.name === "bubu_submit_pending_batch" && "status" in saved && saved.status !== "pending_projection" && saved.status !== "conflict" && turn.batchProgress) {
        turn.batchProgress = { ...turn.batchProgress, completed: turn.batchProgress.total };
      }
      if (saved && "status" in saved && saved.status === "pending_projection") {
        turn.status = "needs_recovery"; turn.error = { code: "CHAT_PROJECTION_PENDING", message: "记录或统计尚未确认完成，请继续处理。", retryable: true };
        this.publishServer(turn, confirmedReply(turn.receipts, turn.pending));
        await this.persist(principal, turn); return false;
      }
      step.state = "completed";
      turn.transcript.push({ role: "tool", toolCallId: step.call.id, content: JSON.stringify(result) });
      await this.persist(principal, turn);
      if (saved && "status" in saved && saved.status === "conflict") {
        turn.pending = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId: turn.babyId }, signal));
        this.publishServer(turn, confirmedReply(turn.receipts, turn.pending));
        if (turn.input.formBatch) {
          turn.status = "failed";
          turn.error = { code: "CHAT_BATCH_CONFLICT", message: "批量中的记录发生投影冲突；请按回执核对，未确认草稿不会标记为已保存。", retryable: false };
        } else turn.status = "completed";
        await this.persist(principal, turn); return false;
      }
    }
    return true;
  }
  private failure(error: unknown): ChatError {
    if (error instanceof McpToolError) return { code: error.code, message: error.message, retryable: error.retryable };
    if (error instanceof AppError) return { code: error.code, message: error.message, retryable: error.retryable ?? error.status >= 500 };
    if (error instanceof z.ZodError) return { code: "CHAT_PLAN_INVALID", message: "模型提出的操作不符合记录规则，请核对后重新说明。", retryable: false };
    return { code: "CHAT_SERVICE_UNAVAILABLE", message: "处理暂未完成，输入和已确认结果仍保留，请继续处理。", retryable: true };
  }
  private async run(principal: Principal, turn: StoredTurn, signal: AbortSignal): Promise<ChatTurn> {
    let client: ChatMcpClient | undefined;
    try {
      client = await abortable(this.connect(principal, turn.babyId, signal), signal);
      const tools = await abortable(client.tools(), signal); await this.checkService(principal, turn.babyId);
      if (turn.input.formBatch) {
        await this.planBatch(principal, turn, client, signal);
        if (!await this.execute(principal, turn, client, signal)) return this.publicTurn(turn);
        turn.pending = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId: turn.babyId }, signal));
        if (turn.batchProgress) turn.batchProgress = { ...turn.batchProgress, completed: turn.batchProgress.total };
        this.publishServer(turn, confirmedReply(turn.receipts, turn.pending)); turn.status = "completed"; delete turn.error;
        await this.persist(principal, turn); await this.check(principal, turn.babyId);
        return this.publicTurn(turn);
      }
      await this.context(principal, turn, client, signal);
      if (turn.modelContext?.imageQuestion) {
        this.publishServer(turn, "需要先确定本次使用的照片。", [turn.modelContext.imageQuestion as unknown as ReplyQuestion]); turn.status = "completed";
        await this.persist(principal, turn); return this.publicTurn(turn);
      }
      if (turn.input.formAnswer) {
        const form = turn.input.formAnswer;
        if (!turn.steps.length) await this.plan(principal, turn, { text: "", calls: [{ id: "structured-form-answer", name: "bubu_answer_pending", arguments: { questionId: turn.input.question!.id, patch: { ...form, facts: form.facts || {} } } }] });
        if (!await this.execute(principal, turn, client, signal)) return this.publicTurn(turn);
        turn.pending = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId: turn.babyId }, signal));
        this.publishServer(turn, confirmedReply(turn.receipts, turn.pending)); turn.status = "completed"; delete turn.error;
        await this.persist(principal, turn); await this.check(principal, turn.babyId);
        return this.publicTurn(turn);
      }
      while (true) {
        await this.checkService(principal, turn.babyId);
        if (!await this.execute(principal, turn, client, signal)) return this.publicTurn(turn);
        if (turn.rounds >= 10 || turn.steps.length >= 24) throw new AppError(409, "CHAT_STEP_LIMIT", "这一轮步骤较多，已确认结果仍保留。请查看记录后继续说明。");
        // A media receipt may close a question within this same turn. Tool
        // availability follows current MCP state, without refreshing write pins.
        turn.pending = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId: turn.babyId }, signal));
        const messages = await this.messages(principal, turn);
        await this.checkService(principal, turn.babyId);
        await this.options.authorizeModel?.(principal, turn.babyId, messages.some(message => Array.isArray(message.content) && message.content.some(item => item.type === "image_url")));
        const availableTools = modelTools(tools).filter(tool => tool.name !== "bubu_resolve_media" || turn.pending.some(question => question.kind === "media"));
        const output = outputSchema.parse(await abortable(this.options.provider!.complete({ instructions: CHAT_INSTRUCTIONS, messages, tools: availableTools, responseFormat: { name: "bubu_chat_reply", schema: replyCandidateJsonSchema }, signal }), signal));
        await this.checkService(principal, turn.babyId);
        if (output.calls.some(call => !tools.some(tool => tool.name === call.name))) throw new AppError(409, "CHAT_TOOL_FORBIDDEN", "模型请求了未授权工具，未执行修改。");
        if (output.calls.length) { await this.plan(principal, turn, output); continue; }
        turn.pending = pending(await this.call(principal, turn, client, "bubu_get_pending", { babyId: turn.babyId }, signal));
        const candidate = await this.gatedCandidate(principal, turn, output.text, signal);
        if (candidate) {
          if (turn.receipts.length) {
            const confirmed = confirmedReply(turn.receipts, turn.pending);
            const userAskedQuestion = /[？?]|(?:为什么|怎么|是什么|有什么区别|能不能|可以吗|是否)/.test(turn.input.text);
            const completeBottle = turn.receipts.some(receipt => "events" in receipt && receipt.events.some(event =>
              event.facts.type === "BOTTLE" && event.complete && !turn.pending.some(question => question.kind === "fields" && question.eventId === event.id)
            ));
            const bottleFollowUp = /奶量|多少\s*(?:毫升|ml)|奶源|母乳还是奶粉|几点|时间|时长|泡好|剩余|拍嗝/;
            const modelQuestions = bindCandidateQuestions(candidate, { kind: "turn", turnId: turn.id })
              .filter(question => !completeBottle || !bottleFollowUp.test(`${question.prompt} ${question.choices.map(choice => choice.label).join(" ")}`));
            const authoritativeQuestions = pendingReplyQuestions(turn.pending);
            const questions = [...authoritativeQuestions, ...(userAskedQuestion ? modelQuestions : [])]
              .filter((question, index, all) => all.findIndex(candidateQuestion => candidateQuestion.id === question.id) === index);
            this.publishServer(turn, [confirmed, ...(userAskedQuestion && candidate.text ? [candidate.text] : [])].filter(Boolean).join("\n"), questions);
          } else this.publishModel(turn, candidate);
        }
        turn.status = "completed"; delete turn.error;
        await this.persist(principal, turn);
        // The reply is committed history now; a later pause cannot downgrade it.
        await this.check(principal, turn.babyId);
        return this.publicTurn(turn);
      }
    } catch (error) {
      // Revoked/expired principals must not publish late model output or read a stale chat result.
      await this.check(principal, turn.babyId);
      turn.error = this.failure(error);
      turn.status = turn.error.retryable && ((error instanceof AppError && error.retryable === true) || turn.steps.some(step => step.state !== "completed" && mutationTools.has(step.call.name))) ? "needs_recovery" : "failed";
      this.publishServer(turn, [confirmedReply(turn.receipts, []), turn.error.message].filter(Boolean).join("\n"), pendingReplyQuestions(turn.pending));
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
