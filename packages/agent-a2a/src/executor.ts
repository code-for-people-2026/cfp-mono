import {
  AgentEvent,
  ServerCallContext,
  type AgentExecutionEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import type { Message, SendMessageConfiguration, Task } from "@a2a-js/sdk";
import type { User } from "@a2a-js/sdk/server";
import { TaskNotCancelableError, UnsupportedOperationError } from "@a2a-js/sdk/errors";

import type { AuthenticatedA2APrincipal } from "./types";

const principalStateKey = "cfp.agentA2a.principal";
const agentIdStateKey = "cfp.agentA2a.agentId";

class ScopedPrincipalUser implements User {
  constructor(private readonly principal: AuthenticatedA2APrincipal, private readonly agentId: string) {}

  get isAuthenticated(): boolean {
    return true;
  }

  /**
   * Composite storage identity. Including tenant, owner and agent prevents a
   * shared TaskStore from crossing logical-expert boundaries by task id.
   */
  get userName(): string {
    return JSON.stringify([this.principal.tenant, this.principal.owner, this.agentId]);
  }
}

export function createScopedServerCallContext(input: {
  principal: AuthenticatedA2APrincipal;
  agentId: string;
  requestedVersion?: string;
  headers?: Record<string, string | string[] | undefined>;
}): ServerCallContext {
  const context = new ServerCallContext({
    tenant: input.principal.tenant,
    user: new ScopedPrincipalUser(input.principal, input.agentId),
    requestedVersion: input.requestedVersion,
    state: new Map<string, unknown>([
      [principalStateKey, input.principal],
      [agentIdStateKey, input.agentId],
      ["headers", input.headers ?? {}],
    ]),
  });
  return context;
}

export function getA2APrincipal(context: ServerCallContext): AuthenticatedA2APrincipal {
  const value = context.state.get(principalStateKey);
  if (!value || typeof value !== "object" || !("owner" in value) || !("tenant" in value)) {
    throw new Error("A2A context does not contain an authenticated principal");
  }
  const principal = value as AuthenticatedA2APrincipal;
  if (
    typeof principal.owner !== "string"
    || typeof principal.tenant !== "string"
    || principal.owner.trim() === ""
    || principal.tenant.trim() === ""
  ) {
    throw new Error("A2A context contains an invalid principal");
  }
  return principal;
}

export function getA2AAgentId(context: ServerCallContext): string {
  const value = context.state.get(agentIdStateKey);
  if (typeof value !== "string" || value === "") {
    throw new Error("A2A context does not contain an agent id");
  }
  return value;
}

/** Business-neutral executor input. Request metadata is intentionally omitted. */
export interface AgentExecutionInput {
  agentId: string;
  principal: AuthenticatedA2APrincipal;
  taskId: string;
  contextId: string;
  message: Message;
  configuration: SendMessageConfiguration | undefined;
  task: Task | undefined;
  referenceTasks: Task[] | undefined;
  /** Aborted before a successful cancellation callback returns. */
  signal: AbortSignal;
}

export interface AgentExecutionCancelInput {
  agentId: string;
  taskId: string;
  contextId: string;
  principal: AuthenticatedA2APrincipal;
}

export interface AgentExecutionSink {
  publish(event: AgentExecutionEvent): void;
}

export type BusinessNeutralAgentExecute = (input: AgentExecutionInput, sink: AgentExecutionSink) => Promise<void>;
export type BusinessNeutralAgentCancel = (input: AgentExecutionCancelInput, sink: AgentExecutionSink) => Promise<void>;

export interface BusinessNeutralAgentExecutor {
  execute: BusinessNeutralAgentExecute;
  cancelTask?: BusinessNeutralAgentCancel;
}

const cancellationCapableExecutors = new WeakSet<AgentExecutor>();

export function supportsRealCancellation(executor: AgentExecutor): boolean {
  return cancellationCapableExecutors.has(executor);
}

export function createAgentExecutor(agentId: string, executor: BusinessNeutralAgentExecutor): AgentExecutor {
  const active = new Map<string, {
    contextId: string;
    controller: AbortController;
    principal: AuthenticatedA2APrincipal;
  }>();
  const adapted: AgentExecutor = {
    async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
      const principal = getA2APrincipal(requestContext.context);
      if (getA2AAgentId(requestContext.context) !== agentId) {
        throw new Error("A2A executor routed to the wrong configured agent");
      }
      if (active.has(requestContext.taskId)) {
        throw new Error("A2A task is already executing in this agent adapter");
      }
      const controller = new AbortController();
      active.set(requestContext.taskId, { contextId: requestContext.contextId, controller, principal });
      try {
        await executor.execute({
          agentId,
          principal,
          taskId: requestContext.taskId,
          contextId: requestContext.contextId,
          message: requestContext.userMessage,
          configuration: requestContext.request.configuration,
          task: requestContext.task,
          referenceTasks: requestContext.referenceTasks,
          signal: controller.signal,
        }, eventBus);
      } finally {
        active.delete(requestContext.taskId);
      }
    },
    async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
      if (!executor.cancelTask) {
        throw new UnsupportedOperationError("Task cancellation is not supported by this agent");
      }
      const running = active.get(taskId);
      if (!running) throw new TaskNotCancelableError("Task has no active execution to cancel");
      running.controller.abort();
      await executor.cancelTask({
        agentId,
        taskId,
        contextId: running.contextId,
        principal: running.principal,
      }, eventBus);
    },
  };
  if (executor.cancelTask) cancellationCapableExecutors.add(adapted);
  return adapted;
}

export { AgentEvent };
