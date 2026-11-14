import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

import { AgentCard, Role, SendMessageRequest as SendMessageRequestCodec, TaskState } from "@a2a-js/sdk";
import type {
  ListTasksRequest,
  ListTasksResponse,
  Message,
  SendMessageRequest,
  Task,
} from "@a2a-js/sdk";
import type { ServerCallContext } from "@a2a-js/sdk/server";
import { describe, expect, it } from "vitest";

import { A2APeerClient, A2APeerRegistry } from "./client";
import { AgentEvent, createAgentExecutor } from "./executor";
import { fingerprintSendMessageRequest } from "./request-ledger";
import { A2AAgentCardRegistry } from "./registry";
import { A2AHttpTransport } from "./server";
import {
  A2A_TASK_STORE_SCOPE,
  type A2ARequestLedger,
  type A2ARequestLedgerEntry,
  type A2ARequestLedgerReservation,
  type A2ARequestLedgerScope,
  type ScopedA2ATaskStore,
} from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

class TestTaskStore implements ScopedA2ATaskStore {
  readonly a2aScope = A2A_TASK_STORE_SCOPE;
  private readonly scopes = new Map<string, Map<string, Task>>();
  loadFailure: Error | undefined;

  private scope(context: ServerCallContext): Map<string, Task> {
    if (!context.tenant || !context.user?.userName) throw new Error("Missing composite scope");
    const key = JSON.stringify([context.tenant, context.user.userName]);
    let tasks = this.scopes.get(key);
    if (!tasks) {
      tasks = new Map();
      this.scopes.set(key, tasks);
    }
    return tasks;
  }

  async save(task: Task, context: ServerCallContext): Promise<void> {
    this.scope(context).set(task.id, clone(task));
  }

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    if (this.loadFailure) throw this.loadFailure;
    const task = this.scope(context).get(taskId);
    return task ? clone(task) : undefined;
  }

  async hasContext(contextId: string, context: ServerCallContext): Promise<boolean> {
    return [...this.scope(context).values()].some((task) => task.contextId === contextId);
  }

  async list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse> {
    const matching = [...this.scope(context).values()].filter((task) => {
      if (params.contextId && task.contextId !== params.contextId) return false;
      if (params.status !== TaskState.TASK_STATE_UNSPECIFIED && task.status?.state !== params.status) return false;
      return true;
    });
    const pageSize = params.pageSize ?? 50;
    return {
      tasks: clone(matching.slice(0, pageSize)),
      nextPageToken: "",
      pageSize,
      totalSize: matching.length,
    };
  }
}

class TestLedger implements A2ARequestLedger {
  private readonly entries = new Map<string, A2ARequestLedgerEntry>();
  private readonly tokens = new Map<string, string>();
  reserveFailure: Error | undefined;

  private key(scope: A2ARequestLedgerScope, requestIdentity: string): string {
    return JSON.stringify([scope.tenant, scope.owner, scope.agentId, requestIdentity]);
  }

  async reserve(
    scope: A2ARequestLedgerScope,
    requestIdentity: string,
    fingerprint: string,
  ): Promise<A2ARequestLedgerReservation> {
    if (this.reserveFailure) throw this.reserveFailure;
    const key = this.key(scope, requestIdentity);
    const existing = this.entries.get(key);
    if (existing) return { outcome: "existing", entry: clone(existing) };
    const token = crypto.randomUUID();
    const entry: A2ARequestLedgerEntry = { requestIdentity, fingerprint, status: "pending" };
    this.entries.set(key, entry);
    this.tokens.set(token, key);
    return { outcome: "new", token, entry: clone(entry) };
  }

  async recordTask(token: string, task: Pick<Task, "id" | "contextId">): Promise<void> {
    const key = this.tokens.get(token);
    const entry = key ? this.entries.get(key) : undefined;
    if (!entry) throw new Error("Unknown reservation");
    Object.assign(entry, { status: "recorded", taskId: task.id, contextId: task.contextId });
  }

  async fail(token: string): Promise<void> {
    const key = this.tokens.get(token);
    const entry = key ? this.entries.get(key) : undefined;
    if (entry && entry.status !== "recorded") entry.status = "failed";
  }
}

function textMessage(messageId: string, text: string, task?: Pick<Task, "id" | "contextId">): Message {
  return {
    messageId,
    contextId: task?.contextId ?? "",
    taskId: task?.id ?? "",
    role: Role.ROLE_USER,
    parts: [{ content: { $case: "text", value: text }, mediaType: "text/plain", filename: "", metadata: {} }],
    metadata: {},
    extensions: [],
    referenceTaskIds: [],
  };
}

function sendRequest(message: Message): SendMessageRequest {
  return { tenant: "", message, configuration: undefined, metadata: {} };
}

function taskSnapshot(id: string, contextId: string, message: Message, state: TaskState): Task {
  return {
    id,
    contextId,
    status: { state, message: undefined, timestamp: new Date().toISOString() },
    artifacts: [],
    history: [clone(message)],
    metadata: {},
  };
}

function configuredRegistry(baseUrl: string): A2AAgentCardRegistry {
  const skill = {
    id: "answer",
    name: "Answer",
    description: "Answers a scoped request",
    tags: ["answer"],
    examples: ["Answer this"],
    inputModes: ["text/plain"],
    outputModes: ["text/plain"],
    securityRequirements: [],
  };
  return new A2AAgentCardRegistry({
    schemaVersion: 1,
    publicBaseUrl: baseUrl,
    agents: ["alpha", "beta"].map((id) => ({
      id,
      name: `${id} agent`,
      description: `${id} scoped test agent`,
      agentVersion: "1.0.0",
      endpointPath: `/a2a/${id}`,
      cardPath: `/cards/${id}.json`,
      skills: [clone(skill)],
      streaming: true,
    })),
  });
}

interface Fixture {
  baseUrl: string;
  fetch: typeof fetch;
  store: TestTaskStore;
  ledger: TestLedger;
  registry: A2AAgentCardRegistry;
  executions: Map<string, number>;
  initialTransport: A2AHttpTransport;
  createTransport: () => A2AHttpTransport;
  setTransport: (transport: A2AHttpTransport) => void;
  client: (agentId?: string, owner?: string, fetchImpl?: typeof fetch) => A2APeerClient;
  currentTransport: () => A2AHttpTransport;
  waitForExecution: () => Promise<string>;
}

async function createFixture(baseUrl = "http://localhost:4567/"): Promise<Fixture> {
  let transport: A2AHttpTransport | undefined;
  const store = new TestTaskStore();
  const ledger = new TestLedger();
  const registry = configuredRegistry(baseUrl);
  const executions = new Map<string, number>();
  let waitResolve: ((taskId: string) => void) | undefined;
  let waiting = new Promise<string>((resolve) => {
    waitResolve = resolve;
  });

  const executorFor = (agentId: string) => createAgentExecutor(agentId, {
    async execute(input, sink) {
      executions.set(`${agentId}:${input.message.messageId}`, (executions.get(`${agentId}:${input.message.messageId}`) ?? 0) + 1);
      const text = input.message.parts[0]?.content?.$case === "text" ? input.message.parts[0].content.value : "";
      sink.publish(AgentEvent.task(taskSnapshot(
        input.taskId,
        input.contextId,
        input.message,
        TaskState.TASK_STATE_WORKING,
      )));
      if (text === "input") {
        sink.publish(AgentEvent.statusUpdate({
          taskId: input.taskId,
          contextId: input.contextId,
          status: { state: TaskState.TASK_STATE_INPUT_REQUIRED, message: undefined, timestamp: new Date().toISOString() },
          metadata: {},
        }));
        return;
      }
      if (text === "wait") {
        waitResolve?.(input.taskId);
        await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
        return;
      }
      if (text === "stream-delay") {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (text === "throw-secret") throw new Error("Bearer server-secret-must-not-echo");
      sink.publish(AgentEvent.statusUpdate({
        taskId: input.taskId,
        contextId: input.contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: new Date().toISOString() },
        metadata: {},
      }));
    },
    async cancelTask(input, sink) {
      sink.publish(AgentEvent.statusUpdate({
        taskId: input.taskId,
        contextId: input.contextId,
        status: { state: TaskState.TASK_STATE_CANCELED, message: undefined, timestamp: new Date().toISOString() },
        metadata: {},
      }));
    },
  });

  const createTransport = () => new A2AHttpTransport({
    registry,
    taskStore: store,
    requestLedger: ledger,
    authentication: {
      async authenticate({ request }) {
        if (request.headers.get("authorization") !== "Bearer test-token") {
          throw new Error(`authentication rejected ${request.headers.get("authorization") ?? "missing"}`);
        }
        return {
          owner: request.headers.get("x-owner") ?? "alice",
          tenant: request.headers.get("x-tenant") ?? "tenant-1",
        };
      },
    },
    agents: ["alpha", "beta"].map((agentId) => ({ agentId, executor: executorFor(agentId) })),
  });
  transport = createTransport();
  const initialTransport = transport;
  const bridgeFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(input, init);
    return await transport?.handleRequest(request) ?? new Response("not ready", { status: 503 });
  };

  const client = (agentId = "alpha", owner = "alice", fetchImpl: typeof fetch = bridgeFetch) => new A2APeerClient({
    peerId: agentId,
    registry: new A2APeerRegistry({
      schemaVersion: 1,
      peers: [{
        id: agentId,
        baseUrl,
        cardPath: `/cards/${agentId}.json`,
        endpointPath: `/a2a/${agentId}`,
      }],
    }),
    credentialProvider: async () => ({ Authorization: "Bearer test-token", "X-Owner": owner }),
    budget: { deadlineMs: 2_000 },
    fetchImpl,
  });

  return {
    baseUrl,
    fetch: bridgeFetch,
    store,
    ledger,
    registry,
    executions,
    initialTransport,
    createTransport,
    currentTransport() {
      if (!transport) throw new Error("Fixture transport is not ready");
      return transport;
    },
    setTransport(value) {
      transport = value;
    },
    client,
    waitForExecution: async () => {
      const result = await waiting;
      waiting = new Promise<string>((resolve) => {
        waitResolve = resolve;
      });
      return result;
    },
  };
}

async function serveNodeHttp(
  transport: A2AHttpTransport,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const origin = `http://${incoming.headers.host ?? "127.0.0.1"}`;
  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
  const request = new Request(new URL(incoming.url ?? "/", origin), {
    method: incoming.method,
    headers,
    body: hasBody
      ? Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>
      : undefined,
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit & { duplex?: "half" });
  const result = await transport.handleRequest(request);
  outgoing.statusCode = result.status;
  result.headers.forEach((value, name) => outgoing.setHeader(name, value));
  if (!result.body) {
    outgoing.end();
    return;
  }
  const reader = result.body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  outgoing.once("close", cancelReader);
  try {
    while (!outgoing.destroyed) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!outgoing.write(chunk.value)) await once(outgoing, "drain");
    }
  } finally {
    outgoing.removeListener("close", cancelReader);
    reader.releaseLock();
  }
  if (!outgoing.destroyed) outgoing.end();
}

function startTransportServer(currentTransport: () => A2AHttpTransport): Server {
  return createServer((request, response) => {
    void serveNodeHttp(currentTransport(), request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

describe("A2A foundation", () => {
  it("uses safe canonical fingerprints and immutable registry snapshots", async () => {
    const registry = configuredRegistry("http://localhost:4567/");
    const snapshot = registry.list()[0];
    snapshot?.inputModes?.push("mutated/type");
    snapshot?.skills[0]?.tags.push("mutated");
    expect(registry.get("alpha").inputModes).toEqual(["text/plain"]);
    expect(registry.getCard("alpha").skills[0]?.tags).toEqual(["answer"]);
    const first = registry.get("alpha");
    expect(() => new A2AAgentCardRegistry({
      schemaVersion: 1,
      publicBaseUrl: "http://localhost:4567/",
      agents: [
        first,
        { ...first, endpointPath: "/a2a/duplicate", cardPath: "/cards/duplicate.json" },
      ],
    })).toThrow(/Duplicate A2A agent id/);

    const plain = sendRequest(textMessage("canonical", "same"));
    const proto = JSON.parse(JSON.stringify(plain)) as SendMessageRequest;
    const constructor = JSON.parse(JSON.stringify(plain)) as SendMessageRequest;
    proto.metadata = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    constructor.metadata = JSON.parse('{"constructor":{"polluted":true}}') as Record<string, unknown>;
    const fingerprints = await Promise.all([
      fingerprintSendMessageRequest(plain),
      fingerprintSendMessageRequest(proto),
      fingerprintSendMessageRequest(constructor),
    ]);
    expect(new Set(fingerprints).size).toBe(3);

    const authentication = { authenticate: async () => ({ owner: "owner", tenant: "tenant" }) };
    expect(() => new A2AHttpTransport({
      registry,
      authentication,
      agents: [],
      taskStore: undefined as never,
      requestLedger: new TestLedger(),
    })).toThrow(/ScopedA2ATaskStore/);
    expect(() => new A2AHttpTransport({
      registry,
      authentication,
      agents: [],
      taskStore: new TestTaskStore(),
      requestLedger: undefined as never,
    })).toThrow(/A2ARequestLedger/);
  });

  it("rejects ambiguous and non-http trusted URLs", () => {
    const peer = (baseUrl: string, cardPath = "/card.json") => () => new A2APeerRegistry({
      schemaVersion: 1,
      peers: [{ id: "peer", baseUrl, cardPath, endpointPath: "/rpc" }],
    });
    expect(peer("ftp://localhost/")).toThrow();
    expect(peer("//localhost/")).toThrow();
    expect(peer("http://localhost\\evil/")).toThrow();
    expect(peer("http://localhost/", "/a/../card.json")).toThrow();
    expect(peer("http://localhost/", "/%2e/card.json")).toThrow();
    expect(peer("http://localhost/", "//card.json")).toThrow();
    expect(peer("http://localhost/a/../")).toThrow();
  });

  it("serves a wire-correct card and supports RPC flows through the in-memory Request/Response bridge", async () => {
    const fixture = await createFixture();
    const rawCardResponse = await fixture.fetch(`${fixture.baseUrl}cards/alpha.json`, {
      headers: { Authorization: "Bearer test-token", "A2A-Version": "1.0" },
    });
    const rawCard = await rawCardResponse.json() as {
      securitySchemes: { bearerAuth: { httpAuthSecurityScheme: { scheme: string } } };
      skills: unknown[];
    };
    expect(rawCard.securitySchemes.bearerAuth.httpAuthSecurityScheme.scheme).toBe("Bearer");
    expect(rawCard.skills).toHaveLength(1);

    const client = fixture.client();
    const connected = await client.connect();
    expect(connected.status).toBe("ok");
    if (connected.status === "ok") {
      expect(connected.value.securitySchemes.bearerAuth?.scheme?.$case).toBe("httpAuthSecurityScheme");
    }

    const sent = await client.sendMessage(sendRequest(textMessage("send-1", "complete")));
    expect(sent.status).toBe("ok");
    if (sent.status !== "ok" || "messageId" in sent.value) throw new Error("Expected task");
    expect(sent.value.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

    const fetched = await client.getTask({ tenant: "", id: sent.value.id });
    expect(fetched.status).toBe("ok");
    const listed = await client.listTasks({
      tenant: "",
      contextId: "",
      status: TaskState.TASK_STATE_UNSPECIFIED,
      pageSize: 10,
      pageToken: "",
      statusTimestampAfter: undefined,
    });
    expect(listed.status === "ok" ? listed.value.totalSize : 0).toBe(1);

    const streamed = await client.sendMessageStream(sendRequest(textMessage("stream-1", "stream")));
    expect(streamed.status).toBe("ok");
    if (streamed.status === "ok") {
      const events = [];
      for await (const event of streamed.value.events) events.push(event.payload?.$case);
      expect(events).toEqual(["task", "statusUpdate"]);
    }

    const input = await client.sendMessage(sendRequest(textMessage("input-1", "input")));
    if (input.status !== "ok" || "messageId" in input.value) throw new Error("Expected input task");
    expect(input.value.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    const followup = await client.sendMessage(sendRequest(textMessage("input-2", "complete", input.value)));
    expect(followup.status === "ok" && !("messageId" in followup.value)
      ? followup.value.status?.state
      : undefined).toBe(TaskState.TASK_STATE_COMPLETED);

    const sanitized = await client.sendMessage(sendRequest(textMessage("failure-1", "throw-secret")));
    expect(JSON.stringify(sanitized)).not.toContain("server-secret-must-not-echo");
  });

  it("deduplicates bridge requests across recreated transports, rejects conflicts, and cancels live work", async () => {
    const fixture = await createFixture();
    const client = fixture.client();
    const request = sendRequest(textMessage("wait-1", "wait"));
    const first = client.sendMessage(request);
    const taskId = await fixture.waitForExecution();

    const duplicate = await client.sendMessage(clone(request));
    expect(duplicate.status === "ok" && !("messageId" in duplicate.value) ? duplicate.value.id : undefined).toBe(taskId);
    expect(fixture.executions.get("alpha:wait-1")).toBe(1);

    const recreated = fixture.createTransport();
    fixture.setTransport(recreated);
    const restartedReplay = await client.sendMessage(clone(request));
    expect(restartedReplay.status === "ok" && !("messageId" in restartedReplay.value)
      ? restartedReplay.value.id
      : undefined).toBe(taskId);
    expect(fixture.executions.get("alpha:wait-1")).toBe(1);

    const conflict = await client.sendMessage(sendRequest(textMessage("wait-1", "changed")));
    expect(conflict.status).toBe("failed");
    const noLiveCancel = await client.cancelTask({ tenant: "", id: taskId, metadata: {} });
    expect(noLiveCancel.status).toBe("failed");
    fixture.setTransport(fixture.initialTransport);
    const canceled = await client.cancelTask({ tenant: "", id: taskId, metadata: {} });
    expect(canceled.status === "ok" ? canceled.value.status?.state : undefined).toBe(TaskState.TASK_STATE_CANCELED);
    const originalResult = await first;
    expect(originalResult.status === "ok" && !("messageId" in originalResult.value)
      ? originalResult.value.status?.state
      : undefined).toBe(TaskState.TASK_STATE_CANCELED);
  });

  it("fails closed in bridge tests across owners, agents, contexts and references", async () => {
    const fixture = await createFixture();
    const alice = fixture.client("alpha", "alice");
    const sent = await alice.sendMessage(sendRequest(textMessage("owned-1", "complete")));
    if (sent.status !== "ok" || "messageId" in sent.value) throw new Error("Expected task");

    expect((await fixture.client("alpha", "bob").getTask({ tenant: "", id: sent.value.id })).status).toBe("failed");
    expect((await fixture.client("beta", "alice").getTask({ tenant: "", id: sent.value.id })).status).toBe("failed");

    const foreignContext = sendRequest(textMessage("context-foreign", "complete"));
    if (foreignContext.message) foreignContext.message.contextId = sent.value.contextId;
    expect((await fixture.client("alpha", "bob").sendMessage(foreignContext)).status).toBe("failed");

    const unknownContext = sendRequest(textMessage("context-unknown", "complete"));
    if (unknownContext.message) unknownContext.message.contextId = "client-chosen-context";
    expect((await alice.sendMessage(unknownContext)).status).toBe("failed");

    const foreignReference = sendRequest(textMessage("reference-foreign", "complete"));
    if (foreignReference.message) foreignReference.message.referenceTaskIds = [sent.value.id];
    expect((await fixture.client("alpha", "bob").sendMessage(foreignReference)).status).toBe("failed");
  });

  it("returns standard bridge parse/auth errors and never reflects authentication failures", async () => {
    const fixture = await createFixture();
    const malformed = await fixture.fetch(`${fixture.baseUrl}a2a/alpha`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "A2A-Version": "1.0",
        "Content-Type": "application/json",
      },
      body: "{broken",
    });
    const malformedBody = await malformed.json() as { error: { code: number } };
    expect(malformedBody.error.code).toBe(-32_700);

    const secret = "Bearer secret-must-not-echo";
    const unauthorized = await fixture.fetch(`${fixture.baseUrl}cards/alpha.json`, {
      headers: { Authorization: secret, "A2A-Version": "1.0" },
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.text()).not.toContain(secret);
  });

  it("sanitizes unexpected host storage failures at the JSON-RPC wire boundary", async () => {
    const fixture = await createFixture();
    fixture.store.loadFailure = new Error("database password storage-secret-must-not-echo");
    const response = await fixture.fetch(`${fixture.baseUrl}a2a/alpha`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "A2A-Version": "1.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "storage-failure",
        method: "GetTask",
        params: { tenant: "", id: "task-id" },
      }),
    });
    const body = await response.json() as { error?: { code?: number; message?: string; data?: unknown } };
    expect(body.error).toEqual({ code: -32_603, message: "Internal error" });
    expect(JSON.stringify(body)).not.toContain("storage-secret-must-not-echo");

    fixture.store.loadFailure = undefined;
    fixture.ledger.reserveFailure = new Error("ledger token ledger-secret-must-not-echo");
    const ledgerResponse = await fixture.fetch(`${fixture.baseUrl}a2a/alpha`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "A2A-Version": "1.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "ledger-failure",
        method: "SendMessage",
        params: SendMessageRequestCodec.toJSON(sendRequest(textMessage("ledger-failure", "complete"))),
      }),
    });
    const ledgerBody = await ledgerResponse.json() as { error?: { code?: number; message?: string; data?: unknown } };
    expect(ledgerBody.error).toEqual({ code: -32_603, message: "Internal error" });
    expect(JSON.stringify(ledgerBody)).not.toContain("ledger-secret-must-not-echo");
  });

  it("allows optional non-JSONRPC interfaces but blocks endpoint changes, redirects and lifecycle budget escapes", async () => {
    const baseUrl = "http://localhost:9876/";
    const registry = configuredRegistry(baseUrl);
    const card = registry.getCard("alpha");
    card.supportedInterfaces.push({
      url: "https://optional.example/a2a",
      protocolBinding: "HTTP+JSON",
      protocolVersion: "1.0",
      tenant: "",
    });
    const cardBody = JSON.stringify(AgentCard.toJSON(card));
    const seen: Array<{ url: string; redirect: RequestRedirect | undefined; authorization: string | null }> = [];
    const peerRegistry = new A2APeerRegistry({
      schemaVersion: 1,
      peers: [{ id: "alpha", baseUrl, cardPath: "/cards/alpha.json", endpointPath: "/a2a/alpha" }],
    });
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      seen.push({ url, redirect: init?.redirect, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(cardBody, { status: 200, headers: { "content-type": "application/json" } });
    };
    const successfulClient = new A2APeerClient({
      peerId: "alpha",
      registry: peerRegistry,
      credentialProvider: async () => ({ Authorization: "Bearer private" }),
      fetchImpl,
    });
    const completedController = new AbortController();
    const accepted = await successfulClient.connect({ signal: completedController.signal });
    expect(accepted.status).toBe("ok");
    completedController.abort();
    expect(accepted.status).toBe("ok");
    expect(seen).toEqual([{
      url: "http://localhost:9876/cards/alpha.json",
      redirect: "manual",
      authorization: "Bearer private",
    }]);

    const redirected = await new A2APeerClient({
      peerId: "alpha",
      registry: peerRegistry,
      credentialProvider: async () => ({ Authorization: "Bearer private" }),
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.example/card" } }),
    }).connect();
    expect(redirected.status === "failed" ? redirected.failure.kind : "ok").toBe("budget");

    const slowCredentials = await new A2APeerClient({
      peerId: "alpha",
      registry: peerRegistry,
      credentialProvider: async () => await new Promise(() => undefined),
      fetchImpl,
      budget: { deadlineMs: 10 },
    }).connect();
    expect(slowCredentials.status === "failed" ? slowCredentials.failure.kind : "ok").toBe("timeout");

    const neverSettlingFetch = await new A2APeerClient({
      peerId: "alpha",
      registry: peerRegistry,
      credentialProvider: async () => ({}),
      fetchImpl: async () => await new Promise<Response>(() => undefined),
      budget: { deadlineMs: 10 },
    }).connect();
    expect(neverSettlingFetch.status === "failed" ? neverSettlingFetch.failure.kind : "ok").toBe("timeout");

    const slowBody = await new A2APeerClient({
      peerId: "alpha",
      registry: peerRegistry,
      credentialProvider: async () => ({}),
      fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          controller.enqueue(new TextEncoder().encode(cardBody));
          controller.close();
        },
      })),
      budget: { deadlineMs: 10 },
    }).connect();
    expect(slowBody.status === "failed" ? slowBody.failure.kind : "ok").toBe("timeout");

    const changedCard = clone(card);
    changedCard.supportedInterfaces[0]!.url = "http://localhost:9876/other";
    const changed = await new A2APeerClient({
      peerId: "alpha",
      registry: peerRegistry,
      credentialProvider: async () => ({}),
      fetchImpl: async () => new Response(JSON.stringify(AgentCard.toJSON(changedCard))),
    }).connect();
    expect(changed.status === "failed" ? changed.failure.kind : "ok").toBe("budget");
  });

  it("settles bridge RPC fetch and stream iterator waits when injected bridges ignore abort", async () => {
    const fixture = await createFixture();
    const peerRegistry = new A2APeerRegistry({
      schemaVersion: 1,
      peers: [{
        id: "alpha",
        baseUrl: fixture.baseUrl,
        cardPath: "/cards/alpha.json",
        endpointPath: "/a2a/alpha",
      }],
    });
    const rpcNeverSettles: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/cards/alpha.json")) return await fixture.fetch(input, init);
      return await new Promise<Response>(() => undefined);
    };
    const rpcClient = new A2APeerClient({
      peerId: "alpha",
      registry: peerRegistry,
      credentialProvider: async () => ({ Authorization: "Bearer test-token", "X-Owner": "alice" }),
      fetchImpl: rpcNeverSettles,
      budget: { deadlineMs: 20 },
    });
    const rpc = await rpcClient.getTask({ tenant: "", id: "never" });
    expect(rpc.status === "failed" ? rpc.failure.kind : "ok").toBe("timeout");

    const streamClient = new A2APeerClient({
      peerId: "alpha",
      registry: peerRegistry,
      credentialProvider: async () => ({ Authorization: "Bearer test-token", "X-Owner": "alice" }),
      fetchImpl: fixture.fetch,
      budget: { deadlineMs: 100 },
    });
    const stream = await streamClient.sendMessageStream(sendRequest(textMessage("iterator-deadline", "stream-delay")));
    expect(stream.status).toBe("ok");
    if (stream.status === "ok") {
      const iterator = stream.value.events;
      const first = await iterator.next();
      expect(first.done ? undefined : first.value.payload?.$case).toBe("task");
      await expect(iterator.next()).rejects.toThrow("A2A peer stream failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  });

  it("runs discovery and all foundation RPC guarantees through the actual transport over a Node HTTP socket", async (context) => {
    let fixture: Fixture | undefined;
    const server = startTransportServer(() => {
      if (!fixture) throw new Error("Socket fixture is not ready");
      return fixture.currentTransport();
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip("Socket integration skipped because the sandbox denied listen(2) with EPERM");
        return;
      }
      throw error;
    }
    try {
      const address = server.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}/`;
      fixture = await createFixture(baseUrl);
      const socketFetch = globalThis.fetch.bind(globalThis);
      const client = fixture.client("alpha", "alice", socketFetch);

      const discovery = await client.connect();
      expect(discovery.status).toBe("ok");

      const request = sendRequest(textMessage("socket-send", "complete"));
      const sent = await client.sendMessage(request);
      if (sent.status !== "ok" || "messageId" in sent.value) throw new Error("Expected socket task");
      expect(sent.value.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

      const fetched = await client.getTask({ tenant: "", id: sent.value.id });
      expect(fetched.status === "ok" ? fetched.value.id : undefined).toBe(sent.value.id);
      const listed = await client.listTasks({
        tenant: "",
        contextId: "",
        status: TaskState.TASK_STATE_UNSPECIFIED,
        pageSize: 10,
        pageToken: "",
        statusTimestampAfter: undefined,
      });
      expect(listed.status === "ok" ? listed.value.totalSize : 0).toBe(1);

      const replay = await client.sendMessage(clone(request));
      expect(replay.status === "ok" && !("messageId" in replay.value) ? replay.value.id : undefined).toBe(sent.value.id);
      expect(fixture.executions.get("alpha:socket-send")).toBe(1);
      const conflict = await client.sendMessage(sendRequest(textMessage("socket-send", "changed")));
      expect(conflict.status).toBe("failed");

      const streamed = await client.sendMessageStream(sendRequest(textMessage("socket-stream", "stream")));
      expect(streamed.status).toBe("ok");
      if (streamed.status === "ok") {
        const eventKinds: string[] = [];
        for await (const event of streamed.value.events) eventKinds.push(event.payload?.$case ?? "missing");
        expect(eventKinds).toEqual(["task", "statusUpdate"]);
      }

      const input = await client.sendMessage(sendRequest(textMessage("socket-input-1", "input")));
      if (input.status !== "ok" || "messageId" in input.value) throw new Error("Expected socket input task");
      expect(input.value.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
      const followup = await client.sendMessage(sendRequest(textMessage("socket-input-2", "complete", input.value)));
      expect(followup.status === "ok" && !("messageId" in followup.value)
        ? followup.value.status?.state
        : undefined).toBe(TaskState.TASK_STATE_COMPLETED);

      const pending = client.sendMessage(sendRequest(textMessage("socket-cancel", "wait")));
      const pendingTaskId = await fixture.waitForExecution();
      const canceled = await client.cancelTask({ tenant: "", id: pendingTaskId, metadata: {} });
      expect(canceled.status === "ok" ? canceled.value.status?.state : undefined).toBe(TaskState.TASK_STATE_CANCELED);
      const pendingResult = await pending;
      expect(pendingResult.status === "ok" && !("messageId" in pendingResult.value)
        ? pendingResult.value.status?.state
        : undefined).toBe(TaskState.TASK_STATE_CANCELED);

      const foreignOwner = await fixture.client("alpha", "bob", socketFetch).getTask({ tenant: "", id: sent.value.id });
      expect(foreignOwner.status).toBe("failed");
      const foreignAgent = await fixture.client("beta", "alice", socketFetch).getTask({ tenant: "", id: sent.value.id });
      expect(foreignAgent.status).toBe("failed");
    } finally {
      await closeServer(server);
    }
  });
});
