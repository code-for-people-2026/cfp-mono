import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { AppError } from "../contracts";
import { agentPlanSchema, collectorRequestId, collectorWriteTools, sourceMessageSchema, type AgentPlan, type CollectorBatch, type CollectorJob } from "./service";
import type { SourcePage, SourceRead, SourceReader } from "./types";
import type { SourceRef } from "../records/types";
import type { AttachmentMime } from "../records/attachments";
import type { MediaResolver } from "./media";
import type { MediaResolution } from "./types";
import { hash } from "../records/persistence";
import { answerSchema, eventMutation, identifier, recordSchema, updateSchema } from "../records/schemas";
import { collectorAgentInstructions } from "./prompt";

/** @public MCP transport boundary for downstream agent bridges and integration fixtures. */
export interface McpGateway { call(name: string, args: Record<string, unknown>): Promise<unknown>; tools(): Promise<unknown[]> }
interface ImageUploadMedia { bytes: Uint8Array; mime: AttachmentMime }
interface ImageUploader { uploadImage(babyId: string, bytes: Uint8Array, mime: AttachmentMime, requestId: string, source: SourceRef, original?: ImageUploadMedia): Promise<{ id: string }> }
const collectorUploadClientCodes = new Set([
  "COLLECTOR_RECEIPT_UNAVAILABLE",
  "COLLECTOR_UPLOAD_FAILED",
  "COLLECTOR_UPLOAD_RECOVERY_UNSUPPORTED",
  "COLLECTOR_UPLOAD_REPAIR_REQUIRED",
  "COLLECTOR_UPLOAD_IDEMPOTENCY_CONFLICT",
]);
/** Transport failures carry only allow-listed client codes plus sanitized HTTP status/server code. */
class CollectorUploadError extends AppError {
  readonly serverCode: string | undefined;
  constructor(httpStatus: number, serverCode: string | undefined, clientCode: string) {
    const status = httpStatus === 0 || !Number.isInteger(httpStatus) || httpStatus < 400 || httpStatus > 599 ? 503 : httpStatus;
    const message = collectorUploadClientCodes.has(clientCode) ? clientCode : "COLLECTOR_UPLOAD_FAILED";
    const code = /^[A-Z0-9_]{1,100}$/.test(serverCode ?? "") ? serverCode : message;
    super(status, code!, message, status >= 500);
    this.serverCode = typeof code === "string" && code !== message ? code : undefined;
  }
}
/** Sanitized MCP failure boundary: preserve AppError routing without exposing server text. */
export class McpToolError extends AppError {
  readonly mcpCode: string;
  constructor(readonly tool: string, failure?: string | { code?: unknown; status?: unknown; retryable?: unknown }) {
    const value = typeof failure === "string" ? { code: failure } : failure;
    const code = typeof value?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(value.code) ? value.code : "MCP_TOOL_FAILED";
    const retryable = value?.retryable === true;
    const parsedStatus = typeof value?.status === "number" && Number.isInteger(value.status) && value.status >= 400 && value.status <= 599 ? value.status : undefined;
    super(parsedStatus ?? (retryable ? 503 : 409), code, code === "VERSION_CONFLICT" ? "VERSION_CONFLICT" : "MCP_TOOL_FAILED", retryable);
    this.mcpCode = code;
  }
}
export class CollectorMcpClient implements McpGateway {
  readonly client = new Client({ name: "bubu-controlled-collector", version: "1.0.0" });
  constructor(readonly url: URL, readonly token: () => Promise<string>) {
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) throw new Error("MCP_HTTPS_REQUIRED");
  }
  async connect() {
    // Resolve credentials for each HTTP request, so operators can rotate the file.
    const transport = new StreamableHTTPClientTransport(this.url, { fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${await this.token()}`);
      headers.set("X-Bubu-Client", "native");
      return fetch(url, { ...init, headers, redirect: "error" });
    } });
    await this.client.connect(transport);
  }
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional() }).passthrough().parse(await this.client.callTool({ name, arguments: args }));
    const text = result.content?.find(item => item.type === "text")?.text;
    let value: unknown = result.structuredContent;
    if (value === undefined && text) { try { value = JSON.parse(text); } catch { value = undefined; } }
    if (result.isError) {
      const failure = z.object({ code: z.unknown().optional(), retryable: z.unknown().optional(), status: z.unknown().optional() }).passthrough().safeParse(value);
      throw new McpToolError(name, failure.success ? failure.data : {});
    }
    if (value === undefined) throw new Error("MCP_RESULT_INVALID");
    return value;
  }
  async tools() { return (await this.client.listTools()).tools; }
  private async json(response: Response): Promise<unknown> {
    try { return await response.json(); }
    catch { return undefined; }
  }
  private serverCode(value: unknown): string | undefined {
    const code = z.object({ code: z.string().regex(/^[A-Z0-9_]{1,100}$/) }).passthrough().safeParse(value);
    return code.success ? code.data.code : undefined;
  }
  private async lookupReceipt(babyId: string, requestId: string, source: SourceRef): Promise<{ supported: false } | { supported: true; receipt: UploadReceipt }> {
    const url = new URL("/api/app/attachments/receipt", this.url); url.searchParams.set("babyId", babyId);
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", redirect: "error", headers: {
        Authorization: `Bearer ${await this.token()}`, "X-Bubu-Client": "native", "Content-Type": "application/json",
      }, body: JSON.stringify({ requestId, source }), signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new CollectorUploadError(0, undefined, "COLLECTOR_RECEIPT_UNAVAILABLE");
    }
    const payload = await this.json(response);
    if (response.ok) {
      const receipt = uploadReceiptEnvelopeSchema.safeParse(payload);
      if (receipt.success) return { supported: true, receipt: receipt.data.data };
      throw new CollectorUploadError(response.status, this.serverCode(payload), "COLLECTOR_RECEIPT_UNAVAILABLE");
    }
    if (response.status === 404 && this.serverCode(payload) === "NOT_FOUND") return { supported: false };
    throw new CollectorUploadError(response.status, this.serverCode(payload), "COLLECTOR_RECEIPT_UNAVAILABLE");
  }
  private repairCandidate(receipt: NeedsRepairReceipt, current: ImageUploadMedia, source: SourceRef, original?: ImageUploadMedia): ImageUploadMedia | undefined {
    const candidates = original ? [original, current] : [current];
    return candidates.find(candidate => {
      const sha256 = createHash("sha256").update(candidate.bytes).digest("hex");
      if (receipt.requestFingerprint) {
        return candidate.mime === receipt.mime && hash([sha256, candidate.mime, source]) === receipt.requestFingerprint;
      }
      return candidate.mime === receipt.mime && sha256 === receipt.sha256;
    });
  }
  private async postImage(babyId: string, candidate: ImageUploadMedia, requestId: string, source: SourceRef): Promise<Response> {
    const url = new URL("/api/app/attachments", this.url); url.searchParams.set("babyId", babyId);
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", redirect: "error", headers: {
        Authorization: `Bearer ${await this.token()}`, "X-Bubu-Client": "native", "Content-Type": candidate.mime,
        "X-Bubu-Request-Id": requestId, "X-Bubu-Source": encodeURIComponent(JSON.stringify(source)),
      }, body: new Uint8Array(candidate.bytes), signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new CollectorUploadError(0, undefined, "COLLECTOR_UPLOAD_FAILED");
    }
    return response;
  }
  private async uploadResponse(response: Response): Promise<{ id: string }> {
    const parsed = z.object({ data: z.object({ id: attachmentIdSchema }) }).passthrough().safeParse(await this.json(response));
    if (!parsed.success || !parsed.data.data.id) throw new CollectorUploadError(response.status, undefined, "COLLECTOR_UPLOAD_FAILED");
    return parsed.data.data;
  }
  async uploadImage(babyId: string, bytes: Uint8Array, mime: AttachmentMime, requestId: string, source: SourceRef, original?: ImageUploadMedia) {
    const receipt = await this.lookupReceipt(babyId, requestId, source);
    const current = { bytes, mime };
    if (!receipt.supported) {
      const response = await this.postImage(babyId, current, requestId, source);
      if (response.ok) return this.uploadResponse(response);
      const code = this.serverCode(await this.json(response));
      if (response.status === 409 && code === "ATTACHMENT_IDEMPOTENCY_CONFLICT") {
        throw new CollectorUploadError(response.status, code, "COLLECTOR_UPLOAD_RECOVERY_UNSUPPORTED");
      }
      throw new CollectorUploadError(response.status, code, "COLLECTOR_UPLOAD_FAILED");
    }
    if (receipt.receipt.state === "verified") return { id: receipt.receipt.attachment.id };
    const firstCandidate = receipt.receipt.state === "absent"
      ? current
      : this.repairCandidate(receipt.receipt, current, source, original);
    if (!firstCandidate) throw new CollectorUploadError(409, undefined, "COLLECTOR_UPLOAD_REPAIR_REQUIRED");
    const response = await this.postImage(babyId, firstCandidate, requestId, source);
    if (response.ok) return this.uploadResponse(response);
    const code = this.serverCode(await this.json(response));
    if (response.status !== 409 || code !== "ATTACHMENT_IDEMPOTENCY_CONFLICT") {
      throw new CollectorUploadError(response.status, code, "COLLECTOR_UPLOAD_FAILED");
    }

    // Only this exact race gets one more lookup. A repair receipt permits one
    // bounded candidate selection/POST, after which conflicts fail closed.
    const recovered = await this.lookupReceipt(babyId, requestId, source);
    if (!recovered.supported) throw new CollectorUploadError(response.status, code, "COLLECTOR_UPLOAD_RECOVERY_UNSUPPORTED");
    if (recovered.receipt.state === "verified") return { id: recovered.receipt.attachment.id };
    if (recovered.receipt.state === "absent") throw new CollectorUploadError(response.status, code, "COLLECTOR_UPLOAD_IDEMPOTENCY_CONFLICT");
    const repaired = this.repairCandidate(recovered.receipt, current, source, original);
    if (!repaired) throw new CollectorUploadError(409, undefined, "COLLECTOR_UPLOAD_REPAIR_REQUIRED");
    const repairResponse = await this.postImage(babyId, repaired, requestId, source);
    if (repairResponse.ok) return this.uploadResponse(repairResponse);
    const repairCode = this.serverCode(await this.json(repairResponse));
    if (repairResponse.status === 409 && repairCode === "ATTACHMENT_IDEMPOTENCY_CONFLICT") {
      throw new CollectorUploadError(repairResponse.status, repairCode, "COLLECTOR_UPLOAD_IDEMPOTENCY_CONFLICT");
    }
    throw new CollectorUploadError(repairResponse.status, repairCode, "COLLECTOR_UPLOAD_FAILED");
  }
  async close() { await this.client.close(); }
}

const attachmentIdSchema = z.string().regex(/^att_[a-f0-9]{64}$/);
interface VerifiedReceipt { state: "verified"; attachment: { id: string } }
interface NeedsRepairReceipt { state: "needsRepair"; id: string; mime: AttachmentMime; sha256: string; requestFingerprint?: string }
type UploadReceipt = { state: "absent" } | VerifiedReceipt | NeedsRepairReceipt;
const uploadReceiptSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("absent") }).strict(),
  z.object({ state: z.literal("verified"), attachment: z.object({ id: attachmentIdSchema }).passthrough() }).strict(),
  z.object({ state: z.literal("needsRepair"), id: attachmentIdSchema, mime: z.enum(["image/jpeg", "image/png", "image/webp"]), sha256: z.string().regex(/^[a-f0-9]{64}$/), requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
]);
const uploadReceiptEnvelopeSchema = z.object({ data: uploadReceiptSchema }).passthrough();

interface Command { executable: string; args?: string[]; cwd?: string; timeoutMs?: number; env?: Record<string, string> }
/** No shell, inherited secrets, raw stderr, or credentials in the Agent task. */
async function invokeJson(command: Command, input: unknown): Promise<unknown> {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV || "production", PATH: process.env.PATH, HOME: process.env.HOME, LANG: "en_US.UTF-8", ...command.env };
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args || [], { cwd: command.cwd, env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; let overflow = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), command.timeoutMs || 90_000);
    child.stdout.on("data", chunk => { output += String(chunk); if (Buffer.byteLength(output) > 4 * 1024 * 1024) { overflow = true; child.kill("SIGKILL"); } });
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(new Error("COLLECTOR_COMMAND_UNAVAILABLE")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0 || overflow) return reject(new Error(overflow ? "COLLECTOR_OUTPUT_LIMIT" : "COLLECTOR_COMMAND_FAILED"));
      try { resolve(JSON.parse(output)); } catch { reject(new Error("COLLECTOR_COMMAND_INVALID_JSON")); }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}

const sourcePageSchema = z.object({ messages: z.array(sourceMessageSchema).max(500), nextCursor: z.record(z.string(), z.number().int().nonnegative()), hasMore: z.boolean() }).strict();
export class WechatSourceReader implements SourceReader {
  constructor(readonly command: Command, readonly options: { fixtureManifest: string } | { configPath: string; allowLive: true }) {}
  async read(input: SourceRead): Promise<SourcePage> {
    return sourcePageSchema.parse(await invokeJson(this.command, { ...input, ...this.options }));
  }
}
export interface AgentTask {
  protocol: "bubu-collector-agent/v1";
  instructions: string;
  batchId: string;
  messages: CollectorBatch["messages"];
  media: MediaResolution[];
  mediaOnly?: Record<string, string[]>;
  existingEvents: unknown;
  pendingQuestions: unknown;
  rules?: unknown;
  tools: unknown[];
  resultSchema: unknown;
  /** Present only for an operator-authorized reconsideration of server-verified uncommitted conflicts. */
  recovery?: { plans: AgentPlan["plans"] };
}
export interface AgentExecutor { execute(task: AgentTask): Promise<AgentPlan> }
export class CommandAgentExecutor implements AgentExecutor {
  constructor(readonly command: Command) {}
  async execute(task: AgentTask) { return agentPlanSchema.parse(await invokeJson(this.command, task)); }
}

function sourcesFor(batch: CollectorBatch, sourceIds: string[], eventKey: string): SourceRef[] {
  return sourceIds.map(sourceId => {
    const source = batch.messages?.find(message => message.sourceId === sourceId);
    if (!source) throw new Error("COLLECTOR_SOURCE_MISMATCH");
    return { kind: "wechat", accountId: source.accountId, conversationId: source.chatId,
      messageId: `${source.databaseId}/${source.tableName}/${source.localId}`, eventKey,
      sentAt: source.sentAt, senderId: source.senderId || "unknown", collectedAt: batch.startedAt, groupId: source.groupId,
      ...(source.media.length ? { mediaIds: source.media.map((_, index) => `${source.sourceId}:media:${index}`) } : {}) };
  });
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("COLLECTOR_ARGUMENTS_INVALID");
  return value as Record<string, unknown>;
}
/** Source provenance and identity scope are transport-owned, never model supplied. */
export function preparePlanCall(batch: CollectorBatch, plan: AgentPlan["plans"][number]) {
  const args: Record<string, unknown> & { babyId: string; requestId: string } = { ...plan.arguments, babyId: batch.babyId, requestId: collectorRequestId(batch.id, plan.key) };
  for (const forbidden of ["principal", "actor", "token", "groupId", "sources", "requestAuthorization"]) delete (args as Record<string, unknown>)[forbidden];
  if (plan.tool === "bubu_record_events") {
    if (!Array.isArray(args.events) || args.events.length < 1 || args.events.length > 25) throw new Error("COLLECTOR_EVENTS_REQUIRED");
    args.events = args.events.map((value, index) => {
      const event = object(value);
      return { facts: event.facts, ...(event.states ? { states: event.states } : {}), ...(event.progress ? { progress: event.progress } : {}), ...(event.intent ? { intent: event.intent } : {}),
        ...(event.evidence ? { evidence: event.evidence } : {}), ...(event.attachmentIds ? { attachmentIds: event.attachmentIds } : {}), sources: sourcesFor(batch, plan.sourceIds, `${plan.key}:${index}`) };
    });
  } else if (plan.tool === "bubu_update_event" || plan.tool === "bubu_answer_pending") {
    Object.assign(args, { sources: sourcesFor(batch, plan.sourceIds, plan.key) });
  }
  const schemas = {
    bubu_record_events: recordSchema, bubu_update_event: updateSchema,
    bubu_retract_event: eventMutation, bubu_restore_event: eventMutation,
    bubu_undo_event: eventMutation.extend({ revisionId: identifier }), bubu_answer_pending: answerSchema,
    bubu_attach_images: eventMutation.extend({ attachmentIds: z.array(identifier).max(10) }),
    bubu_resolve_duplicate: eventMutation.extend({ resolution: z.enum(["distinct", "same"]), targetEventId: identifier.optional(), targetVersion: z.number().int().positive().optional() }),
  };
  // Validate the complete transport-owned arguments before persisting an
  // immutable plan, so malformed model output does not poison batch retries.
  schemas[plan.tool].parse(args);
  return { tool: plan.tool, arguments: args };
}

interface BatchResponse { skipped?: boolean; reason?: string; job: CollectorJob; batch?: CollectorBatch }
function runningBatch(value: unknown): CollectorBatch {
  const response = value as BatchResponse;
  if (response.skipped || !response.batch) throw new Error("COLLECTOR_PAUSED");
  return response.batch;
}
export class CollectorRunner {
  constructor(readonly mcp: McpGateway, readonly source: SourceReader, readonly agent: AgentExecutor, readonly images?: { resolver: MediaResolver; uploader: ImageUploader }) {}
  private async agentTask(batch: CollectorBatch): Promise<Omit<AgentTask, "instructions">> {
    const existingEvents = await this.mcp.call("bubu_query_events", { babyId: batch.babyId, includeRetracted: true });
    const pendingQuestions = await this.mcp.call("bubu_get_pending", { babyId: batch.babyId });
    const rules = await this.mcp.call("bubu_get_rules", { babyId: batch.babyId });
    const tools = (await this.mcp.tools()).filter(value => collectorWriteTools.includes(object(value).name as typeof collectorWriteTools[number]));
    return { protocol: "bubu-collector-agent/v1", batchId: batch.id, messages: batch.messages || [], media: batch.media || [],
      mediaOnly: batch.mediaOnly, existingEvents, pendingQuestions, rules, tools, resultSchema: z.toJSONSchema(agentPlanSchema) };
  }
  async once(babyId: string, jobId: string): Promise<{ skipped?: string; batchId?: string; completed?: boolean }> {
    const runId = randomUUID();
    const start = await this.mcp.call("bubu_collector", { action: "begin", babyId, jobId, runId }) as BatchResponse;
    if (start.skipped) return { skipped: start.reason };
    let batch = start.batch!;
    if (!batch) throw new Error("COLLECTOR_BATCH_REQUIRED");
    const leased = { babyId, jobId, batchId: batch.id, runId };
    let heartbeatError: unknown;
    let activePlanKey: string | undefined;
    const heartbeat = setInterval(() => { void this.mcp.call("bubu_collector", { action: "heartbeat", ...leased }).then(runningBatch).catch(error => { heartbeatError = error; }); }, 30_000);
    try {
      if (!batch.messages) {
        const page = await this.source.read({ accountId: start.job.accountId, chatId: start.job.chatId, cursor: batch.cursor, limit: 100, ...(batch.range ? { range: batch.range } : {}) });
        batch = runningBatch(await this.mcp.call("bubu_collector", { action: "stage", ...leased, page }));
      }
      if (!batch.plan) {
        if (!batch.media && batch.messages!.some(message => message.media.length)) {
          const resolutions: MediaResolution[] = [];
          for (const message of batch.messages!) for (let index = 0; index < message.media.length; index++) {
            runningBatch(await this.mcp.call("bubu_collector", { action: "heartbeat", ...leased }));
            const resolved = this.images ? await this.images.resolver.resolve(message, index) : { available: false as const, reason: "MEDIA_RESOLVER_NOT_CONFIGURED" };
            if (!resolved.available) resolutions.push({ sourceId: message.sourceId, index, state: "unavailable", reason: resolved.reason });
            else {
              runningBatch(await this.mcp.call("bubu_collector", { action: "heartbeat", ...leased }));
              const source = sourcesFor(batch, [message.sourceId], `media:${index}`)[0]!;
              // Stable across batch replay/backfill and renewed credentials.
              delete source.collectedAt;
              const attachment = await this.images!.uploader.uploadImage(babyId, resolved.bytes, resolved.mime, `collector-media-${hash([message.sourceId, index])}`, source,
                resolved.original ? { bytes: resolved.original.bytes, mime: resolved.original.mime } : undefined);
              resolutions.push({ sourceId: message.sourceId, index, state: "uploaded", attachmentId: attachment.id });
            }
          }
          batch = runningBatch(await this.mcp.call("bubu_collector", { action: "media", ...leased, resolutions }));
        }
        const task = await this.agentTask(batch);
        const eventList = z.object({ events: z.array(z.object({ id: z.string(), lifecycle: z.string() }).passthrough()) }).parse(task.existingEvents).events;
        const messages = batch.messages!.filter(message => !batch.mediaOnly?.[message.sourceId] ||
          (batch.media?.some(media => media.sourceId === message.sourceId && media.state === "uploaded") && eventList.some(event => event.lifecycle === "active" && batch.mediaOnly![message.sourceId]!.includes(event.id))));
        runningBatch(await this.mcp.call("bubu_collector", { action: "heartbeat", ...leased }));
        const plan = messages.length ? await this.agent.execute({
          ...task,
          messages,
          instructions: collectorAgentInstructions,
        }) : { plans: [], ignored: [] };
        for (const item of plan.plans) preparePlanCall(batch, item);
        batch = runningBatch(await this.mcp.call("bubu_collector", { action: "plan", ...leased, plan }));
      }
      const recoveryPlans = (batch.plan?.plans || []).filter(plan => batch.recovery?.[plan.key]?.authorizedAt && !batch.recovery?.[plan.key]?.replannedAt);
      if (recoveryPlans.length) {
        const task = await this.agentTask(batch);
        const replacements = await this.agent.execute({
          ...task,
          recovery: { plans: recoveryPlans },
          instructions: `${collectorAgentInstructions} RECOVERY ONLY: Reconsider exactly the server-authorized conflicting plans in recovery, in their supplied order, and return exactly one replacement plan for each in that same order; do not add plans for any other source. First read the supplied latest existingEvents, pendingQuestions, and current attachments; human edits and current versions are authoritative. Preserve all original sourceIds, tool semantics, and the original event/question target. Use a new unique plan key so persisted arguments never reuse a prior request key. Do not replay the stale expectedVersion, overwrite human changes, remove current attachments, restore retracted facts, ignore an intended conflicting source, or invent missing facts.`,
        });
        if (replacements.plans.length !== recoveryPlans.length || replacements.ignored.length) throw new Error("COLLECTOR_RECOVERY_PLAN_INVALID");
        const mapped = recoveryPlans.map((old, index) => ({ oldPlanKey: old.key, plan: replacements.plans[index]! }));
        for (const item of mapped) preparePlanCall(batch, item.plan);
        batch = runningBatch(await this.mcp.call("bubu_collector", { action: "replan", ...leased, replacements: mapped }));
      }
      for (const plan of batch.plan!.plans) {
        if (heartbeatError) throw heartbeatError;
        if (batch.receipts[plan.key]) continue;
        activePlanKey = plan.key;
        runningBatch(await this.mcp.call("bubu_collector", { action: "heartbeat", ...leased }));
        const call = preparePlanCall(batch, plan);
        // The server's receipt verifier checks its durable operation record before
        // accepting this receipt; merely exporting text cannot complete a batch.
        await this.mcp.call(call.tool, call.arguments);
        await this.mcp.call("bubu_collector", { action: "receipt", ...leased, planKey: plan.key, requestId: call.arguments.requestId });
        activePlanKey = undefined;
      }
      if (heartbeatError) throw heartbeatError;
      const result = await this.mcp.call("bubu_collector", { action: "finish", ...leased }) as BatchResponse;
      if (result.skipped) return { skipped: result.reason, batchId: batch.id };
      return { completed: true, batchId: batch.id };
    } catch (error) {
      const code = error instanceof AppError ? error.code : error instanceof Error ? error.message : "";
      const conflictPlanKey = error instanceof McpToolError && error.mcpCode === "VERSION_CONFLICT" ? activePlanKey : undefined;
      await this.mcp.call("bubu_collector", { action: "fail", ...leased, code: /^[A-Z0-9_]{1,80}$/.test(code) ? code : "COLLECTOR_RUN_FAILED", ...(conflictPlanKey ? { conflictPlanKey } : {}) }).catch(() => undefined);
      throw error;
    } finally { clearInterval(heartbeat); }
  }
}

/** Real timer loop; job enablement and nextRunAt are enforced on the server. */
export async function scheduleCollector(runner: CollectorRunner, options: { babyId: string; jobId: string; pollMs?: number; signal: AbortSignal; onResult?: (result: unknown) => void }) {
  const pollMs = options.pollMs ?? 10_000;
  if (pollMs < 1000 || pollMs > 60_000) throw new Error("COLLECTOR_POLL_INVALID");
  while (!options.signal.aborted) {
    try { const result = await runner.once(options.babyId, options.jobId); if (!result.skipped) options.onResult?.(result); }
    catch (error) { options.onResult?.({ failed: true, code: error instanceof AppError ? error.code : "COLLECTOR_RUN_FAILED", ...(error instanceof AppError ? { retryable: error.retryable ?? error.status >= 500 } : {}) }); }
    if (!options.signal.aborted) await new Promise<void>(resolve => {
      const abort = () => { clearTimeout(timer); options.signal.removeEventListener("abort", abort); resolve(); };
      const timer = setTimeout(abort, pollMs);
      options.signal.addEventListener("abort", abort, { once: true });
    });
  }
}
