import { AgentCard, TaskState } from "@a2a-js/sdk";
import { A2AError, RequestMalformedError } from "@a2a-js/sdk/errors";
import {
  DefaultRequestHandler,
  DefaultExecutionEventBusManager,
  JsonRpcTransportHandler,
  validateVersion,
  type A2ARequestHandler,
  type AgentExecutor,
  type ServerCallContext,
} from "@a2a-js/sdk/server";

import { createScopedServerCallContext, supportsRealCancellation } from "./executor";
import { createDurableAgentExecutor, IdempotentA2ARequestHandler } from "./request-ledger";
import {
  A2AAgentCardRegistry,
  SUPPORTED_A2A_PROTOCOL_VERSION,
} from "./registry";
import type {
  A2AAuthenticationAdapter,
  A2ARequestLedger,
  A2AStorageOptions,
  AuthenticatedA2APrincipal,
  ScopedA2ATaskStore,
} from "./types";
import { A2A_TASK_STORE_SCOPE } from "./types";

export interface A2AServerAgentBinding {
  agentId: string;
  /** Official SDK AgentExecutor. `createAgentExecutor` adapts a neutral runner without adding a model engine. */
  executor: AgentExecutor;
  /** Required for raw SDK executors; createAgentExecutor marks this automatically. */
  supportsCancellation?: boolean;
}

export interface A2AServerTransportOptions extends A2AStorageOptions {
  registry: A2AAgentCardRegistry;
  authentication: A2AAuthenticationAdapter;
  agents: A2AServerAgentBinding[];
  /** Largest JSON-RPC request body accepted. Default 1 MiB. */
  maxRequestBodyBytes?: number;
  /** Reject wire media types not advertised by the card. Default true. */
  validateInputModes?: boolean;
}

interface RuntimeAgent {
  agentId: string;
  endpointPath: string;
  cardPath: string;
  handler: A2ARequestHandler;
}

const defaultMaxRequestBodyBytes = 1_048_576;
const jsonContentTypes = new Set(["application/json"]);
const authErrorCode = -32_000;
const stableProtocolErrorNames = new Set([
  "ContentTypeNotSupportedError",
  "ExtendedAgentCardNotConfiguredError",
  "ExtensionSupportRequiredError",
  "InvalidAgentResponseError",
  "PushNotificationNotSupportedError",
  "RequestMalformedError",
  "TaskNotCancelableError",
  "TaskNotFoundError",
  "UnsupportedOperationError",
  "VersionNotSupportedError",
]);

function isStableProtocolError(error: unknown): error is A2AError {
  return error instanceof A2AError && stableProtocolErrorNames.has(error.name);
}

async function sanitizedHostCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isStableProtocolError(error)) throw error;
    throw new Error("A2A host storage operation failed");
  }
}

function sanitizedTaskStore(store: ScopedA2ATaskStore): ScopedA2ATaskStore {
  return {
    a2aScope: store.a2aScope,
    save: (task, context) => sanitizedHostCall(() => store.save(task, context)),
    load: (taskId, context) => sanitizedHostCall(() => store.load(taskId, context)),
    list: (params, context) => sanitizedHostCall(() => store.list(params, context)),
    hasContext: (contextId, context) => sanitizedHostCall(() => store.hasContext(contextId, context)),
  };
}

function sanitizedRequestLedger(ledger: A2ARequestLedger): A2ARequestLedger {
  return {
    reserve: (scope, requestIdentity, fingerprint) => sanitizedHostCall(
      () => ledger.reserve(scope, requestIdentity, fingerprint),
    ),
    recordTask: (token, task) => sanitizedHostCall(() => ledger.recordTask(token, task)),
    fail: (token) => sanitizedHostCall(() => ledger.fail(token)),
  };
}

function bindingSupportsCancellation(
  bindings: A2AServerAgentBinding[],
  agentId: string,
  executor: AgentExecutor,
): boolean {
  return supportsRealCancellation(executor)
    || bindings.find((binding) => binding.agentId === agentId)?.supportsCancellation === true;
}

function jsonRpcHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    "A2A-Version": SUPPORTED_A2A_PROTOCOL_VERSION,
    Vary: "A2A-Version",
    "Cache-Control": "no-store",
  };
}

function jsonRpcBody(id: string | number | null, error: { code: number; message: string }) {
  return { jsonrpc: "2.0", id, error };
}

function responseError(error: unknown): { code: number; message: string; data?: unknown } {
  if (isStableProtocolError(error)) {
    return JsonRpcTransportHandler.mapToJSONRPCError(error);
  }
  return { code: -32_603, message: "Internal error" };
}

function sanitizedWireValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const envelope = value as { error?: unknown };
  if (!envelope.error || typeof envelope.error !== "object" || Array.isArray(envelope.error)) return value;
  const error = envelope.error as { code?: unknown };
  if (error.code !== -32_603) return value;
  return { ...envelope, error: { code: -32_603, message: "Internal error" } };
}

function textResponse(body: string, status: number, headers: HeadersInit): Response {
  return new Response(body, { status, headers });
}

function requestHeaders(request: Request): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  request.headers.forEach((value, key) => {
    const existing = result[key];
    if (existing === undefined) result[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else result[key] = [existing, value];
  });
  return result;
}

async function readBoundedBody(request: Request, limit: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) return { ok: false };
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: decoder.decode(bytes) };
}

function requestVersion(request: Request): string {
  return request.headers.get("A2A-Version") ?? "0.3";
}

function rpcRequestId(body: string): string | number | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "id" in parsed) {
      const id = (parsed as { id: unknown }).id;
      if (typeof id === "string" || typeof id === "number") return id;
    }
  } catch {
    // JsonRpcTransportHandler will produce the standard parse error.
  }
  return null;
}

function encodeSseData(value: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(sanitizedWireValue(value))}\n\n`);
}

async function sseResponse(
  stream: AsyncGenerator<unknown, void, undefined>,
  requestId: string | number | null,
): Promise<Response> {
  const iterator = stream[Symbol.asyncIterator]();
  let first: IteratorResult<unknown, void>;
  try {
    first = await iterator.next();
  } catch (error) {
    return textResponse(
      JSON.stringify(jsonRpcBody(requestId, responseError(error))),
      200,
      jsonRpcHeaders(),
    );
  }
  const streamHeaders: HeadersInit = {
    "content-type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "A2A-Version": SUPPORTED_A2A_PROTOCOL_VERSION,
    Vary: "A2A-Version",
  };
  let canceled = false;
  let finalized: Promise<void> | undefined;
  const finalize = () => {
    finalized ??= Promise.resolve(iterator.return?.()).then(() => undefined, () => undefined);
    return finalized;
  };
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done && !canceled) controller.enqueue(encodeSseData(first.value));
        while (!canceled) {
          const event = await iterator.next();
          if (event.done || canceled) break;
          controller.enqueue(encodeSseData(event.value));
        }
      } catch (error) {
        if (!canceled) controller.enqueue(
          new TextEncoder().encode(`event: error\ndata: ${JSON.stringify(responseError(error))}\n\n`),
        );
      } finally {
        await finalize();
        if (!canceled) controller.close();
      }
    },
    async cancel() {
      canceled = true;
      await finalize();
    },
  });
  return new Response(readable, { status: 200, headers: streamHeaders });
}

/** Framework-independent Request -> Response A2A 1.0 JSON-RPC transport. */
export class A2AHttpTransport {
  private readonly agents = new Map<string, RuntimeAgent>();
  private readonly endpointAgents = new Map<string, RuntimeAgent>();
  private readonly cardAgents = new Map<string, RuntimeAgent>();
  private readonly authentication: A2AAuthenticationAdapter;
  private readonly maxRequestBodyBytes: number;

  constructor(private readonly options: A2AServerTransportOptions) {
    if (!options.registry || !options.authentication || typeof options.authentication.authenticate !== "function") {
      throw new Error("A2A registry and authentication adapter are required");
    }
    this.authentication = options.authentication;
    this.maxRequestBodyBytes = options.maxRequestBodyBytes ?? defaultMaxRequestBodyBytes;
    if (!Number.isInteger(this.maxRequestBodyBytes) || this.maxRequestBodyBytes < 1) {
      throw new Error("maxRequestBodyBytes must be a positive integer");
    }
    if (
      !options.taskStore
      || options.taskStore.a2aScope !== A2A_TASK_STORE_SCOPE
      || typeof options.taskStore.load !== "function"
      || typeof options.taskStore.save !== "function"
      || typeof options.taskStore.list !== "function"
      || typeof options.taskStore.hasContext !== "function"
    ) {
      throw new Error("A composite tenant-owner-agent ScopedA2ATaskStore is required");
    }
    if (
      !options.requestLedger
      || typeof options.requestLedger.reserve !== "function"
      || typeof options.requestLedger.recordTask !== "function"
      || typeof options.requestLedger.fail !== "function"
    ) {
      throw new Error("A durable A2ARequestLedger is required");
    }
    const taskStore = sanitizedTaskStore(options.taskStore);
    const requestLedger = sanitizedRequestLedger(options.requestLedger);
    const bindings = new Map<string, AgentExecutor>();
    for (const binding of options.agents ?? []) {
      if (!binding?.agentId || !binding.executor) throw new Error("A valid agent binding is required");
      if (bindings.has(binding.agentId)) throw new Error(`Duplicate executor for A2A agent ${binding.agentId}`);
      bindings.set(binding.agentId, binding.executor);
    }
    for (const configured of options.registry.list()) {
      const executor = bindings.get(configured.id);
      if (!executor) throw new Error(`Missing executor for configured A2A agent ${configured.id}`);
      const card = options.registry.getCard(configured.id);
      const eventBusManager = new DefaultExecutionEventBusManager();
      const durableExecutor = createDurableAgentExecutor(executor, taskStore, requestLedger);
      const officialHandler = new DefaultRequestHandler(
        card,
        taskStore,
        durableExecutor,
        eventBusManager,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          validateInputModes: options.validateInputModes ?? true,
          keepBusAliveStates: [TaskState.TASK_STATE_INPUT_REQUIRED, TaskState.TASK_STATE_AUTH_REQUIRED],
        },
      );
      const handler = new IdempotentA2ARequestHandler(
        officialHandler,
        taskStore,
        requestLedger,
        eventBusManager,
        bindingSupportsCancellation(options.agents, configured.id, executor),
      );
      const runtime: RuntimeAgent = {
        agentId: configured.id,
        endpointPath: configured.endpointPath,
        cardPath: configured.cardPath,
        handler,
      };
      this.agents.set(configured.id, runtime);
      this.endpointAgents.set(configured.endpointPath, runtime);
      this.cardAgents.set(configured.cardPath, runtime);
    }
    if (bindings.size !== this.agents.size) {
      throw new Error("Every injected A2A executor must correspond to a configured agent");
    }
  }

  get configuredAgentIds(): string[] {
    return [...this.agents.keys()];
  }

  async handleRequest(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET") {
      const agent = this.cardAgents.get(pathname);
      if (!agent) return this.notFound();
      let cardPrincipal: AuthenticatedA2APrincipal;
      try {
        cardPrincipal = this.requirePrincipal(await this.authentication.authenticate({ request, agentId: agent.agentId }));
      } catch (error) {
        return this.authenticationError(error);
      }
      try {
        const context = this.createContext(request, cardPrincipal, agent.agentId);
        const card = await agent.handler.getAgentCard();
        validateVersion(context.requestedVersion, card, "JSONRPC");
        return textResponse(JSON.stringify(AgentCard.toJSON(card)), 200, jsonRpcHeaders());
      } catch (error) {
        return textResponse(JSON.stringify(jsonRpcBody(null, responseError(error))), 200, jsonRpcHeaders());
      }
    }

    if (request.method !== "POST") return this.methodNotAllowed();
    const agent = this.endpointAgents.get(pathname);
    if (!agent) return this.notFound();

    let principal: AuthenticatedA2APrincipal;
    try {
      principal = this.requirePrincipal(await this.authentication.authenticate({ request, agentId: agent.agentId }));
    } catch (error) {
      return this.authenticationError(error);
    }

    const contentType = (request.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!jsonContentTypes.has(contentType)) {
      const error = new RequestMalformedError(`Unsupported Content-Type "${request.headers.get("content-type") ?? ""}"; expected application/json.`);
      return textResponse(JSON.stringify(jsonRpcBody(null, responseError(error))), 200, jsonRpcHeaders());
    }
    const body = await readBoundedBody(request, this.maxRequestBodyBytes);
    if (!body.ok) {
      return textResponse(
        JSON.stringify(jsonRpcBody(rpcRequestId(""), {
          code: -32_600,
          message: "A2A request body exceeds the configured limit",
        })),
        413,
        jsonRpcHeaders(),
      );
    }

    const context = this.createContext(request, principal, agent.agentId);
    try {
      const card = await agent.handler.getAgentCard();
      validateVersion(context.requestedVersion, card, "JSONRPC");
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.text);
      } catch {
        return textResponse(
          JSON.stringify(jsonRpcBody(null, { code: -32_700, message: "Parse error" })),
          200,
          jsonRpcHeaders(),
        );
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const params = (parsed as { params?: unknown }).params;
        const requestTenant = params && typeof params === "object" && !Array.isArray(params)
          ? (params as { tenant?: unknown }).tenant
          : undefined;
        if (typeof requestTenant === "string" && requestTenant !== "" && requestTenant !== principal.tenant) {
          throw new RequestMalformedError("A2A tenant does not match the authenticated principal");
        }
      }
      const result = await new JsonRpcTransportHandler(agent.handler).handle(body.text, context);
      if (result && typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
        const id = rpcRequestId(body.text);
        return await sseResponse(result as AsyncGenerator<unknown, void, undefined>, id);
      }
      return textResponse(JSON.stringify(sanitizedWireValue(result)), 200, jsonRpcHeaders());
    } catch (error) {
      return textResponse(
        JSON.stringify(jsonRpcBody(rpcRequestId(body.text), responseError(error))),
        200,
        jsonRpcHeaders(),
      );
    }
  }

  private createContext(
    request: Request,
    principal: { owner: string; tenant: string },
    agentId: string,
  ): ServerCallContext {
    return createScopedServerCallContext({
      principal,
      agentId,
      requestedVersion: requestVersion(request),
      headers: requestHeaders(request),
    });
  }

  private requirePrincipal(value: unknown): AuthenticatedA2APrincipal {
    if (!value || typeof value !== "object") throw new Error("Invalid principal");
    const owner = (value as { owner?: unknown }).owner;
    const tenant = (value as { tenant?: unknown }).tenant;
    const hasControlCharacter = (text: string) => [...text].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
    if (
      typeof owner !== "string"
      || typeof tenant !== "string"
      || owner.trim() === ""
      || tenant.trim() === ""
      || hasControlCharacter(owner)
      || hasControlCharacter(tenant)
    ) {
      throw new Error("Invalid principal");
    }
    return { owner, tenant };
  }

  private authenticationError(error: unknown): Response {
    void error;
    return textResponse(JSON.stringify(jsonRpcBody(null, {
      code: authErrorCode,
      message: "A2A authentication required",
    })), 401, {
      "content-type": "application/json",
      "WWW-Authenticate": "Bearer",
      "Cache-Control": "no-store",
    });
  }

  private notFound(): Response {
    return textResponse(JSON.stringify({ error: "not_found" }), 404, {
      "content-type": "application/json",
      "Cache-Control": "no-store",
    });
  }

  private methodNotAllowed(): Response {
    return textResponse(JSON.stringify({ error: "method_not_allowed" }), 405, {
      allow: "GET, POST",
      "content-type": "application/json",
      "Cache-Control": "no-store",
    });
  }
}
