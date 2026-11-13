import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  type AgentCardResolver,
  type Client,
  type HttpHeaders,
  type RequestOptions,
} from "@a2a-js/sdk/client";
import type {
  AgentCard,
  CancelTaskRequest,
  GetTaskRequest,
  ListTasksRequest,
  ListTasksResponse,
  Message,
  SendMessageRequest,
  StreamResponse,
  Task,
} from "@a2a-js/sdk";
import { A2AError } from "@a2a-js/sdk/errors";

import { SUPPORTED_A2A_PROTOCOL_VERSION } from "./registry";
import {
  configuredUrl,
  normalizeExactHttpUrl,
  normalizeTrustedBaseUrl,
  normalizeTrustedPath,
} from "./url";

export const A2A_PEER_CONFIG_SCHEMA_VERSION = 1;

export interface ConfiguredA2APeer {
  id: string;
  /** Trusted configured origin. It is never obtained from a model response. */
  baseUrl: string;
  /** Trusted discovery URL path. */
  cardPath: string;
  /** Trusted JSON-RPC URL path; deliberately distinct from cardPath. */
  endpointPath: string;
}

export interface A2APeerConfig {
  schemaVersion: 1;
  peers: ConfiguredA2APeer[];
}

export interface A2APeerBudget {
  /** Total wall-clock deadline for discovery, credentials, RPC and response consumption. */
  deadlineMs: number;
  maxRequestBodyBytes: number;
  maxResponseBytes: number;
}

export type A2ACredentialProvider = (signal?: AbortSignal) => Promise<HttpHeaders>;

export type PeerFailureKind = "network" | "timeout" | "budget" | "protocol" | "unknown";

export interface PeerFailure {
  kind: PeerFailureKind;
  /** Fixed sanitized description; peer and credential error strings are never exposed. */
  message: string;
}

export type PeerOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "canceled" }
  | { status: "failed"; failure: PeerFailure };

interface PeerStreamSuccess {
  events: AsyncGenerator<StreamResponse, void, undefined>;
}

export type PeerStreamOutcome = PeerOutcome<PeerStreamSuccess>;

class A2APeerBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "A2APeerBudgetExceededError";
  }
}

class A2APeerStreamError extends Error {
  constructor() {
    super("A2A peer stream failed");
    this.name = "A2APeerStreamError";
  }
}

interface NormalizedPeer extends ConfiguredA2APeer {
  cardUrl: string;
  endpointUrl: string;
}

export class A2APeerRegistry {
  private readonly peers = new Map<string, NormalizedPeer>();

  constructor(config: A2APeerConfig) {
    if (config?.schemaVersion !== A2A_PEER_CONFIG_SCHEMA_VERSION) throw new Error("Unsupported A2A peer config version");
    if (!Array.isArray(config.peers) || config.peers.length === 0) throw new Error("At least one peer is required");
    for (const peer of config.peers) {
      if (!peer?.id || this.peers.has(peer.id)) throw new Error(`Duplicate or missing peer id: ${String(peer?.id)}`);
      const baseUrl = normalizeTrustedBaseUrl(peer.baseUrl, `${peer.id}.baseUrl`);
      const cardPath = normalizeTrustedPath(peer.cardPath, `${peer.id}.cardPath`);
      const endpointPath = normalizeTrustedPath(peer.endpointPath, `${peer.id}.endpointPath`);
      this.peers.set(peer.id, {
        id: peer.id,
        baseUrl: baseUrl.toString(),
        cardPath,
        endpointPath,
        cardUrl: configuredUrl(baseUrl, cardPath),
        endpointUrl: configuredUrl(baseUrl, endpointPath),
      });
    }
  }

  get(peerId: string): ConfiguredA2APeer {
    const peer = this.getNormalized(peerId);
    return {
      id: peer.id,
      baseUrl: peer.baseUrl,
      cardPath: peer.cardPath,
      endpointPath: peer.endpointPath,
    };
  }

  getNormalized(peerId: string): Readonly<NormalizedPeer> {
    const peer = this.peers.get(peerId);
    if (!peer) throw new Error(`Unknown configured A2A peer: ${peerId}`);
    return { ...peer };
  }
}

class TrustedAgentCardResolver implements AgentCardResolver {
  private readonly resolver: DefaultAgentCardResolver;

  constructor(
    private readonly expectedBaseUrl: string,
    private readonly expectedCardPath: string,
    private readonly expectedEndpointUrl: string,
    fetchImpl: typeof fetch,
  ) {
    this.resolver = new DefaultAgentCardResolver({ fetchImpl });
  }

  async resolve(baseUrl: string, path?: string): Promise<AgentCard> {
    if (baseUrl !== this.expectedBaseUrl || path !== this.expectedCardPath) {
      throw new A2APeerBudgetExceededError("A2A discovery URL was not the configured trusted URL");
    }
    const card = await this.resolver.resolve(baseUrl, path);
    this.validate(card);
    return card;
  }

  normalizeAgentCard(card: unknown): AgentCard {
    const normalized = this.resolver.normalizeAgentCard(card);
    this.validate(normalized);
    return normalized;
  }

  private validate(card: AgentCard): void {
    const jsonRpcInterfaces = (card.supportedInterfaces ?? []).filter(
      (item) => item.protocolBinding.toUpperCase() === "JSONRPC",
    );
    if (jsonRpcInterfaces.length !== 1) {
      throw new A2APeerBudgetExceededError("Configured A2A peer must expose one trusted JSON-RPC interface");
    }
    const agentInterface = jsonRpcInterfaces[0];
    if (!agentInterface || agentInterface.protocolVersion !== SUPPORTED_A2A_PROTOCOL_VERSION) {
      throw new A2APeerBudgetExceededError("Configured A2A peer does not advertise A2A 1.0 JSON-RPC");
    }
    let actualUrl: string;
    try {
      actualUrl = normalizeExactHttpUrl(agentInterface.url, "Agent card JSON-RPC interface");
    } catch {
      throw new A2APeerBudgetExceededError("Configured A2A peer advertised an invalid JSON-RPC URL");
    }
    if (actualUrl !== this.expectedEndpointUrl) {
      throw new A2APeerBudgetExceededError("Configured A2A peer card attempted to select another endpoint");
    }
  }
}

interface DeadlineController {
  signal: AbortSignal;
  readonly timedOut: boolean;
  cleanup: () => void;
}

function deadlineController(deadlineMs: number, external?: AbortSignal): DeadlineController {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadlineMs);
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup() {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function abortedError(): DOMException {
  return new DOMException("The A2A operation was aborted", "AbortError");
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    throw abortedError();
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(abortedError());
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function requestUrl(input: RequestInfo | URL): string {
  const value = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
  return normalizeExactHttpUrl(value, "A2A request URL");
}

function authenticatedBoundedFetch(input: {
  fetchImpl: typeof fetch;
  credentialProvider: A2ACredentialProvider;
  budget: A2APeerBudget;
  allowedUrls: ReadonlySet<string>;
  signal: AbortSignal;
}): typeof fetch {
  return async (requestInput: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = requestUrl(requestInput);
    if (!input.allowedUrls.has(target)) {
      throw new A2APeerBudgetExceededError("A2A request destination is not configured");
    }
    const body = init?.body;
    if (typeof body === "string" && new TextEncoder().encode(body).byteLength > input.budget.maxRequestBodyBytes) {
      throw new A2APeerBudgetExceededError("A2A peer request exceeds maxRequestBodyBytes");
    }
    if (body !== undefined && typeof body !== "string") {
      throw new A2APeerBudgetExceededError("A2A peer adapter only permits string JSON request bodies");
    }
    const credentials = await withAbort(input.credentialProvider(input.signal), input.signal);
    const headers = new Headers(credentials);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    const pendingResponse = input.fetchImpl(requestInput, {
      ...init,
      headers,
      redirect: "manual",
      signal: input.signal,
    });
    const response = await withAbort(pendingResponse.then(async (value) => {
      if (input.signal.aborted) {
        await value.body?.cancel().catch(() => undefined);
        throw abortedError();
      }
      return value;
    }), input.signal);
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new A2APeerBudgetExceededError("A2A peer redirects are not permitted");
    }
    if (response.redirected || (response.url !== "" && normalizeExactHttpUrl(response.url, "A2A response URL") !== target)) {
      await response.body?.cancel().catch(() => undefined);
      throw new A2APeerBudgetExceededError("A2A peer response came from an unconfigured destination");
    }
    const rawLength = response.headers.get("content-length");
    if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > input.budget.maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new A2APeerBudgetExceededError("A2A peer response exceeds maxResponseBytes");
    }
    if (!response.body) return response;
    let received = 0;
    const limited = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > input.budget.maxResponseBytes) {
          controller.error(new A2APeerBudgetExceededError("A2A peer response exceeds maxResponseBytes"));
        } else {
          controller.enqueue(chunk);
        }
      },
    }), { signal: input.signal });
    return new Response(limited, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

function failureFromError(error: unknown, deadline: DeadlineController): PeerFailure {
  if (deadline.timedOut) return { kind: "timeout", message: "A2A peer call exceeded its deadline" };
  if (error instanceof A2APeerBudgetExceededError) return { kind: "budget", message: error.message };
  if (error instanceof A2AError) return { kind: "protocol", message: "A2A peer returned a protocol error" };
  if (error instanceof Error && error.name === "AbortError") return { kind: "network", message: "A2A peer call was aborted" };
  if (error instanceof TypeError) return { kind: "network", message: "A2A peer network request failed" };
  return { kind: "unknown", message: "A2A peer call failed" };
}

interface A2APeerClientOptions {
  peerId: string;
  registry: A2APeerRegistry;
  credentialProvider: A2ACredentialProvider;
  budget?: Partial<A2APeerBudget>;
  fetchImpl?: typeof fetch;
}

/** Strict, non-retrying official SDK client for one configured peer. */
export class A2APeerClient {
  private readonly budget: A2APeerBudget;
  private readonly peer: Readonly<NormalizedPeer>;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: A2APeerClientOptions) {
    this.peer = options.registry.getNormalized(options.peerId);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.budget = {
      deadlineMs: 30_000,
      maxRequestBodyBytes: 1_048_576,
      maxResponseBytes: 4_194_304,
      ...options.budget,
    };
    for (const value of Object.values(this.budget)) {
      if (!Number.isInteger(value) || value < 1) throw new Error("A2A peer budget values must be positive integers");
    }
  }

  async connect(options?: { signal?: AbortSignal }): Promise<PeerOutcome<AgentCard>> {
    const deadline = deadlineController(this.budget.deadlineMs, options?.signal);
    try {
      const client = await withAbort(this.createClient(deadline), deadline.signal);
      return {
        status: "ok",
        value: await withAbort(client.getAgentCard({ signal: deadline.signal }), deadline.signal),
      };
    } catch (error) {
      if (options?.signal?.aborted && !deadline.timedOut) return { status: "canceled" };
      return { status: "failed", failure: failureFromError(error, deadline) };
    } finally {
      deadline.cleanup();
    }
  }

  sendMessage(params: SendMessageRequest, options?: { signal?: AbortSignal }): Promise<PeerOutcome<Message | Task>> {
    return this.call(options, (client, requestOptions) => client.sendMessage(params, requestOptions));
  }

  async sendMessageStream(params: SendMessageRequest, options?: { signal?: AbortSignal }): Promise<PeerStreamOutcome> {
    const deadline = deadlineController(this.budget.deadlineMs, options?.signal);
    let iterator: AsyncGenerator<StreamResponse, void, undefined> | undefined;
    let finalized = false;
    const finalize = async () => {
      if (finalized) return;
      finalized = true;
      try {
        let closing: Promise<IteratorResult<StreamResponse, void> | undefined>;
        try {
          closing = Promise.resolve(iterator?.return?.());
        } catch {
          closing = Promise.resolve(undefined);
        }
        void closing.catch(() => undefined);
        if (!deadline.signal.aborted) {
          await withAbort(closing, deadline.signal).catch(() => undefined);
        }
      } finally {
        deadline.cleanup();
      }
    };
    try {
      const client = await withAbort(this.createClient(deadline), deadline.signal);
      iterator = client.sendMessageStream(params, { signal: deadline.signal });
      const first = await withAbort(iterator.next(), deadline.signal);
      if (first.done) {
        await finalize();
        return { status: "failed", failure: { kind: "protocol", message: "A2A stream ended before a task event" } };
      }
      const firstValue = first.value as StreamResponse;
      const activeIterator = iterator;
      async function* events(): AsyncGenerator<StreamResponse, void, undefined> {
        try {
          yield firstValue;
          while (true) {
            const event = await withAbort(activeIterator.next(), deadline.signal);
            if (event.done) return;
            yield event.value;
          }
        } catch (error) {
          if (options?.signal?.aborted && !deadline.timedOut) return;
          void error;
          throw new A2APeerStreamError();
        } finally {
          await finalize();
        }
      }
      return { status: "ok", value: { events: events() } };
    } catch (error) {
      await finalize();
      if (options?.signal?.aborted && !deadline.timedOut) return { status: "canceled" };
      return { status: "failed", failure: failureFromError(error, deadline) };
    }
  }

  getTask(params: GetTaskRequest, options?: { signal?: AbortSignal }): Promise<PeerOutcome<Task>> {
    return this.call(options, (client, requestOptions) => client.getTask(params, requestOptions));
  }

  cancelTask(params: CancelTaskRequest, options?: { signal?: AbortSignal }): Promise<PeerOutcome<Task>> {
    return this.call(options, (client, requestOptions) => client.cancelTask(params, requestOptions));
  }

  listTasks(params: ListTasksRequest, options?: { signal?: AbortSignal }): Promise<PeerOutcome<ListTasksResponse>> {
    return this.call(options, (client, requestOptions) => client.listTasks(params, requestOptions));
  }

  private async createClient(deadline: DeadlineController): Promise<Client> {
    const fetchImpl = authenticatedBoundedFetch({
      fetchImpl: this.fetchImpl,
      credentialProvider: this.options.credentialProvider,
      budget: this.budget,
      allowedUrls: new Set([this.peer.cardUrl, this.peer.endpointUrl]),
      signal: deadline.signal,
    });
    const resolver = new TrustedAgentCardResolver(
      this.peer.baseUrl,
      this.peer.cardPath,
      this.peer.endpointUrl,
      fetchImpl,
    );
    const factory = new ClientFactory({
      transports: [new JsonRpcTransportFactory({ fetchImpl })],
      preferredTransports: ["JSONRPC"],
      cardResolver: resolver,
    });
    return await factory.createFromUrl(this.peer.baseUrl, this.peer.cardPath);
  }

  private async call<T>(
    options: { signal?: AbortSignal } | undefined,
    invoke: (client: Client, requestOptions: RequestOptions) => Promise<T>,
  ): Promise<PeerOutcome<T>> {
    const deadline = deadlineController(this.budget.deadlineMs, options?.signal);
    try {
      const client = await withAbort(this.createClient(deadline), deadline.signal);
      return {
        status: "ok",
        value: await withAbort(invoke(client, { signal: deadline.signal }), deadline.signal),
      };
    } catch (error) {
      if (options?.signal?.aborted && !deadline.timedOut) return { status: "canceled" };
      return { status: "failed", failure: failureFromError(error, deadline) };
    } finally {
      deadline.cleanup();
    }
  }
}
