import { Buffer } from "node:buffer";
import {
  A2AError,
  RequestMalformedError,
  TaskNotCancelableError,
  TaskNotFoundError,
  UnsupportedOperationError,
} from "@a2a-js/sdk/errors";
import type {
  Message,
  SendMessageRequest,
  StreamResponse,
  Task,
} from "@a2a-js/sdk";
import { TaskState } from "@a2a-js/sdk";
import type {
  A2ARequestHandler,
  AgentExecutor,
  ExecutionEventBusManager,
  RequestContext,
  ServerCallContext,
} from "@a2a-js/sdk/server";

import { getA2AAgentId, getA2APrincipal } from "./executor";
import type {
  A2ARequestLedger,
  A2ARequestLedgerScope,
  ScopedA2ATaskStore,
} from "./types";

type JsonCanonicalValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | JsonCanonicalValue[]
  | { [key: string]: JsonCanonicalValue };

function toCanonicalValue(value: unknown, path: string): JsonCanonicalValue {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
    case "number":
    case "string":
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new RequestMalformedError(`Non-finite JSON value at ${path}`);
      }
      return value;
    case "object":
      break;
    default:
      throw new RequestMalformedError(`Unsupported JSON value at ${path}`);
  }
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map((item, index) => toCanonicalValue(item, `${path}[${index}]`));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RequestMalformedError(`Unsupported JSON object at ${path}`);
  }
  const record = value as Record<string, unknown>;
  const result: { [key: string]: JsonCanonicalValue } = Object.create(null) as { [key: string]: JsonCanonicalValue };
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item !== undefined) result[key] = toCanonicalValue(item, `${path}.${key}`);
  }
  return result;
}

function canonicalJson(value: unknown): string {
  const canonical = toCanonicalValue(value, "$");
  const encode = (input: JsonCanonicalValue): string => {
    if (input === null) return "n";
    if (typeof input === "boolean") return input ? "b1" : "b0";
    if (typeof input === "number") return `d${JSON.stringify(input)}`;
    if (typeof input === "string") return `s${JSON.stringify(input)}`;
    if (input instanceof Uint8Array) return `y${input.byteLength}:${Buffer.from(input).toString("base64")}`;
    if (Array.isArray(input)) return `a${input.length}:[${input.map(encode).join(",")}]`;
    const keys = Object.keys(input).sort();
    const entries = keys.map((key) => `${key.length}:${key}=${encode(input[key]!)}`);
    return `o${keys.length}:{${entries.join(",")}}`;
  };
  return encode(canonical);
}

export async function fingerprintSendMessageRequest(request: SendMessageRequest): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(request));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

function requestScope(context: ServerCallContext): A2ARequestLedgerScope {
  const principal = getA2APrincipal(context);
  return { tenant: principal.tenant, owner: principal.owner, agentId: getA2AAgentId(context) };
}

function requireReplayTask(entry: { taskId?: string }): string {
  if (!entry.taskId) {
    throw new RequestMalformedError("A2A request identity is pending or failed and has no replayable task");
  }
  return entry.taskId;
}

interface ReservationState {
  token: string;
  recorded: boolean;
}

type NewReservation = Extract<Awaited<ReturnType<A2ARequestLedger["reserve"]>>, { outcome: "new" }>;
type PreparedRequest =
  | { existing: Task }
  | { reservation: NewReservation; state: ReservationState };

const reservationStateKey = "cfp.agentA2a.requestLedgerReservation";

function getReservationState(context: ServerCallContext): ReservationState {
  const state = context.state.get(reservationStateKey);
  if (!state || typeof state !== "object" || !("token" in state) || typeof state.token !== "string") {
    throw new A2AError("A2A request did not establish a durable request reservation");
  }
  return state as ReservationState;
}

function initialTask(requestContext: RequestContext): Task {
  return {
    id: requestContext.taskId,
    contextId: requestContext.contextId,
    status: {
      state: TaskState.TASK_STATE_SUBMITTED,
      message: undefined,
      timestamp: new Date().toISOString(),
    },
    artifacts: [],
    history: [structuredClone(requestContext.userMessage)],
    metadata: {},
  };
}

/** Persists the first task snapshot and ledger mapping before business code runs. */
export function createDurableAgentExecutor(
  inner: AgentExecutor,
  taskStore: ScopedA2ATaskStore,
  requestLedger: A2ARequestLedger,
): AgentExecutor {
  return {
    async execute(requestContext, eventBus): Promise<void> {
      const reservation = getReservationState(requestContext.context);
      const task = requestContext.task ?? initialTask(requestContext);
      try {
        if (!requestContext.task) await taskStore.save(task, requestContext.context);
        await requestLedger.recordTask(reservation.token, task);
        reservation.recorded = true;
      } catch {
        throw new Error("A2A durability setup failed");
      }
      try {
        await inner.execute(requestContext, eventBus);
      } catch {
        throw new Error("Agent execution failed");
      }
    },
    async cancelTask(taskId, eventBus): Promise<void> {
      try {
        await inner.cancelTask(taskId, eventBus);
      } catch (error) {
        if (error instanceof TaskNotCancelableError || error instanceof UnsupportedOperationError) throw error;
        throw new TaskNotCancelableError("Task cancellation failed");
      }
    },
  };
}

/**
 * Adds durable request-identity semantics around the official SDK handler.
 * The standard message id is the request identity; a changed payload with the
 * same id is a conflict, while an exact replay returns the recorded task.
 */
export class IdempotentA2ARequestHandler implements A2ARequestHandler {
  constructor(
    private readonly inner: A2ARequestHandler,
    private readonly taskStore: ScopedA2ATaskStore,
    private readonly requestLedger: A2ARequestLedger,
    private readonly eventBusManager: ExecutionEventBusManager,
    private readonly cancellationSupported: boolean,
  ) {}

  private async reserve(params: SendMessageRequest, context: ServerCallContext): Promise<PreparedRequest> {
    const requestIdentity = params.message?.messageId;
    if (!requestIdentity) throw new RequestMalformedError("message.messageId is required for idempotency");
    await this.validateOwnedInputs(params, context);
    const fingerprint = await fingerprintSendMessageRequest(params);
    const reservation = await this.requestLedger.reserve(requestScope(context), requestIdentity, fingerprint);
    if (reservation.outcome === "existing") {
      if (reservation.entry.fingerprint !== fingerprint) {
        throw new RequestMalformedError("A2A request identity was already used with different content");
      }
      return { existing: await this.loadReplayTask(reservation.entry.taskId, context) };
    }
    const state: ReservationState = { token: reservation.token, recorded: false };
    context.state.set(reservationStateKey, state);
    return { reservation, state };
  }

  private async validateOwnedInputs(params: SendMessageRequest, context: ServerCallContext): Promise<void> {
    const message = params.message;
    if (!message) throw new RequestMalformedError("request.message is required");
    if (message.taskId) {
      const task = await this.taskStore.load(message.taskId, context);
      if (!task || (message.contextId && task.contextId !== message.contextId)) {
        throw new TaskNotFoundError("Task or context is not available to this caller");
      }
    } else if (message.contextId && !await this.taskStore.hasContext(message.contextId, context)) {
      throw new TaskNotFoundError("Task or context is not available to this caller");
    }
    for (const taskId of message.referenceTaskIds ?? []) {
      if (!await this.taskStore.load(taskId, context)) {
        throw new TaskNotFoundError("Referenced task is not available to this caller");
      }
    }
  }

  async sendMessage(params: SendMessageRequest, context: ServerCallContext): Promise<Message | Task> {
    const prepared = await this.reserve(params, context);
    if ("existing" in prepared) return prepared.existing;
    try {
      const result = await this.inner.sendMessage(params, context);
      if ("messageId" in result) {
        throw new RequestMalformedError("This A2A foundation requires executors to produce tasks");
      }
      if (!prepared.state.recorded) throw new A2AError("A2A request durability could not be established");
      return result;
    } catch (error) {
      if (!prepared.state.recorded) await this.requestLedger.fail(prepared.reservation.token);
      throw error;
    }
  }

  async *sendMessageStream(params: SendMessageRequest, context: ServerCallContext): AsyncGenerator<StreamResponse, void, undefined> {
    const prepared = await this.reserve(params, context);
    if ("existing" in prepared) {
      yield { payload: { $case: "task", value: prepared.existing } };
      return;
    }
    try {
      for await (const event of this.inner.sendMessageStream(params, context)) {
        if (!prepared.state.recorded) throw new A2AError("A2A request durability could not be established");
        yield event;
      }
      if (!prepared.state.recorded) throw new A2AError("A2A request durability could not be established");
    } catch (error) {
      if (!prepared.state.recorded) await this.requestLedger.fail(prepared.reservation.token);
      throw error;
    }
  }

  private async loadReplayTask(taskId: string | undefined, context: ServerCallContext): Promise<Task> {
    const id = requireReplayTask({ taskId });
    const task = await this.taskStore.load(id, context);
    if (!task) throw new TaskNotFoundError("Recorded A2A task is not visible to this principal");
    return task;
  }

  getAgentCard(): ReturnType<A2ARequestHandler["getAgentCard"]> {
    return this.inner.getAgentCard();
  }

  getAuthenticatedExtendedAgentCard(
    ...args: Parameters<A2ARequestHandler["getAuthenticatedExtendedAgentCard"]>
  ): ReturnType<A2ARequestHandler["getAuthenticatedExtendedAgentCard"]> {
    return this.inner.getAuthenticatedExtendedAgentCard(...args);
  }

  getTask(...args: Parameters<A2ARequestHandler["getTask"]>): ReturnType<A2ARequestHandler["getTask"]> {
    return this.inner.getTask(...args);
  }

  cancelTask(
    params: Parameters<A2ARequestHandler["cancelTask"]>[0],
    context: ServerCallContext,
  ): ReturnType<A2ARequestHandler["cancelTask"]> {
    if (!this.cancellationSupported) {
      throw new UnsupportedOperationError("Task cancellation is not supported by this agent");
    }
    if (!this.eventBusManager.getByTaskId(params.id, context)) {
      throw new TaskNotCancelableError("Task has no active execution to cancel");
    }
    return this.inner.cancelTask(params, context);
  }

  createTaskPushNotificationConfig(
    ...args: Parameters<A2ARequestHandler["createTaskPushNotificationConfig"]>
  ): ReturnType<A2ARequestHandler["createTaskPushNotificationConfig"]> {
    return this.inner.createTaskPushNotificationConfig(...args);
  }

  getTaskPushNotificationConfig(
    ...args: Parameters<A2ARequestHandler["getTaskPushNotificationConfig"]>
  ): ReturnType<A2ARequestHandler["getTaskPushNotificationConfig"]> {
    return this.inner.getTaskPushNotificationConfig(...args);
  }

  listTaskPushNotificationConfigs(
    ...args: Parameters<A2ARequestHandler["listTaskPushNotificationConfigs"]>
  ): ReturnType<A2ARequestHandler["listTaskPushNotificationConfigs"]> {
    return this.inner.listTaskPushNotificationConfigs(...args);
  }

  deleteTaskPushNotificationConfig(
    ...args: Parameters<A2ARequestHandler["deleteTaskPushNotificationConfig"]>
  ): ReturnType<A2ARequestHandler["deleteTaskPushNotificationConfig"]> {
    return this.inner.deleteTaskPushNotificationConfig(...args);
  }

  resubscribe(...args: Parameters<A2ARequestHandler["resubscribe"]>): ReturnType<A2ARequestHandler["resubscribe"]> {
    return this.inner.resubscribe(...args);
  }

  listTasks(...args: Parameters<A2ARequestHandler["listTasks"]>): ReturnType<A2ARequestHandler["listTasks"]> {
    return this.inner.listTasks(...args);
  }
}
