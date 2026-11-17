import type { Task } from "@a2a-js/sdk";
import type { AgentExecutor, ServerCallContext, TaskStore } from "@a2a-js/sdk/server";

export type {
  AgentCard,
  AgentInterface,
  Artifact,
  CancelTaskRequest,
  GetTaskRequest,
  ListTasksRequest,
  ListTasksResponse,
  Message,
  Part,
  Role,
  SendMessageConfiguration,
  SendMessageRequest,
  StreamResponse,
  StringList,
  Task,
  TaskState,
  TaskStatus,
  TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
export type {
  AgentExecutionEvent,
  AgentExecutor,
  ExecutionEventBus,
  RequestContext,
  ServerCallContext,
  TaskStore,
} from "@a2a-js/sdk/server";

/** Identity established by the host authentication adapter, never by A2A metadata. */
export interface AuthenticatedA2APrincipal {
  /** Durable data-owner identifier. Empty identities are rejected. */
  owner: string;
  /** Required isolation namespace. Request-supplied tenants cannot replace it. */
  tenant: string;
}

export interface A2AAuthenticationAdapter {
  /**
   * Authenticate and authorize one configured agent endpoint.
   * Throw `A2AAuthenticationRequiredError` for any caller that must not proceed.
   * The adapter must not return credentials or accept identity claims from request metadata.
   */
  authenticate(input: {
    request: Request;
    agentId: string;
  }): Promise<AuthenticatedA2APrincipal>;
}

export class A2AAuthenticationRequiredError extends Error {
  constructor(message = "A2A authentication required") {
    super(message);
    this.name = "A2AAuthenticationRequiredError";
  }
}

/** Scope used by the host request ledger. It is derived from authentication and routing only. */
export interface A2ARequestLedgerScope {
  tenant: string;
  owner: string;
  agentId: string;
}

export interface A2ARequestLedgerEntry {
  requestIdentity: string;
  fingerprint: string;
  status: "pending" | "recorded" | "failed";
  taskId?: string;
  contextId?: string;
}

export type A2ARequestLedgerReservation =
  | { outcome: "new"; token: string; entry: A2ARequestLedgerEntry }
  | { outcome: "existing"; entry: A2ARequestLedgerEntry };

/**
 * Durable request-identity host contract. `recordTask` must be atomic enough
 * that a replay after the first task snapshot does not invoke the executor again.
 */
export interface A2ARequestLedger {
  reserve(
    scope: A2ARequestLedgerScope,
    requestIdentity: string,
    fingerprint: string,
  ): Promise<A2ARequestLedgerReservation>;
  recordTask(
    token: string,
    task: Pick<Task, "id" | "contextId">,
  ): Promise<void>;
  fail(token: string): Promise<void>;
}

export const A2A_TASK_STORE_SCOPE = "tenant-owner-agent-v1";

/**
 * Host storage adapter required by this package. Every operation must derive
 * its partition from context.tenant and context.user.userName; task IDs and
 * context IDs are never globally addressable.
 */
export interface ScopedA2ATaskStore extends TaskStore {
  readonly a2aScope: typeof A2A_TASK_STORE_SCOPE;
  /** Returns true only when this exact scoped caller already owns the context. */
  hasContext(contextId: string, context: ServerCallContext): Promise<boolean>;
}

export interface A2AStorageOptions {
  /** Required composite-scoped production storage. Use an explicit test fixture for memory. */
  taskStore: ScopedA2ATaskStore;
  /** Required durable request identity storage. Use an explicit test fixture for memory. */
  requestLedger: A2ARequestLedger;
}

export type InjectedA2AAgentExecutor = AgentExecutor;
