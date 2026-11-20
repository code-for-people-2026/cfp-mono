import { createHash, randomBytes } from "node:crypto";

import {
  A2AAgentCardRegistry,
  A2AHttpTransport,
  A2APeerClient,
  A2APeerRegistry,
  AgentEvent,
  createAgentExecutor,
  type A2ARequestLedger,
  type AuthenticatedA2APrincipal,
  type ScopedA2ATaskStore,
  type SendMessageRequest,
  type Task,
  type TaskState,
  recoverA2ASendMessage,
  retryA2AExecution,
} from "@cfp/agent-a2a";
import type { ExpertExecutionDiagnostic } from "@cfp/a-j-oker-contracts";

import type { PsychologyApproach } from "./psychology";
import {
  psychologyA2ARequestSchema,
  psychologyPlanSchema,
  type PsychologyConsultation,
  type PsychologyPlan,
} from "./psychology-plan";
import {
  EXPERT_EXECUTION_MAX_ATTEMPTS,
  classifyExpertExecutionError,
  withDisposition,
} from "./expert-execution";

const AJ_A2A_BASE_URL = "https://aj-a2a.internal/";
const AJ_A2A_TENANT = "aj-platform";
const AJ_A2A_DEADLINE_MS = 60_000;
const PLAN_MEDIA_TYPE = "application/vnd.cfp.aj.psychology-plan+json";
const TASK_STATE = {
  WORKING: 2 as TaskState,
  COMPLETED: 3 as TaskState,
  FAILED: 4 as TaskState,
  CANCELED: 5 as TaskState,
  REJECTED: 7 as TaskState,
};

export { AJ_A2A_TENANT };

export type PsychologySpecialistBinding = {
  approach: PsychologyApproach;
  label: string;
  revision: string;
  execute: (
    consultation: PsychologyConsultation,
    signal: AbortSignal,
    context: {
      attempt: number;
      executionId: string;
      taskId: string;
    },
  ) => Promise<PsychologyPlan>;
};

type PsychologyA2AOutcome =
  | { status: "completed"; plan: PsychologyPlan; diagnostics: ExpertExecutionDiagnostic[] }
  | { status: "unavailable"; diagnostics: ExpertExecutionDiagnostic[] }
  | { status: "canceled" };

export interface PsychologyA2ARuntime {
  consult(input: {
    parentExecutionId: string;
    approach: PsychologyApproach;
    consultation: PsychologyConsultation;
    signal: AbortSignal;
  }): Promise<PsychologyA2AOutcome>;
}

export interface PsychologyA2ACompletedTaskRecoveryInput {
  scope: {
    tenant: string;
    owner: string;
    agentId: string;
  };
  requestIdentity: string;
}

export type PsychologyA2ACompletedTaskRecovery = (
  input: PsychologyA2ACompletedTaskRecoveryInput,
) => Promise<Task | undefined>;

type PsychologyA2ADurableTaskRecovery = PsychologyA2ACompletedTaskRecovery;

type PsychologyA2ATransportIntercept = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  next: typeof fetch,
) => Promise<Response>;

type PsychologyA2ATelemetry = (event: {
  category:
    | "expert_execution"
    | "expert_completed"
    | "expert_retry_scheduled"
    | "expert_retry_exhausted"
    | "expert_nonretryable"
    | "expert_canceled";
  attempt: number;
}) => void;

type PsychologyA2ADiagnosticEvent = {
  category: string;
  diagnostic: ExpertExecutionDiagnostic;
};

export type PsychologyA2AFactory = (
  bindings: PsychologySpecialistBinding[],
) => PsychologyA2ARuntime;

type PsychologyA2AFactoryOptions = {
  principal: AuthenticatedA2APrincipal;
  taskStore: ScopedA2ATaskStore;
  requestLedger: A2ARequestLedger;
  /** Returns any ledger-recorded durable task so live work can be polled. */
  recoverTask?: PsychologyA2ADurableTaskRecovery;
  /** Compatibility completed-only seam; it cannot recover live work. */
  recoverCompletedTask?: PsychologyA2ACompletedTaskRecovery;
  transportIntercept?: PsychologyA2ATransportIntercept;
  expertTelemetry?: PsychologyA2ATelemetry;
  executionDiagnostics?: (event: PsychologyA2ADiagnosticEvent) => void;
};

function endpointPath(approach: PsychologyApproach): string {
  return `/internal/a2a/psychology/${approach}`;
}

function cardPath(approach: PsychologyApproach): string {
  return `/internal/a2a/psychology/${approach}/agent-card.json`;
}

function requestIdentity(parentExecutionId: string, approach: PsychologyApproach) {
  return `aj-psychology-${createHash("sha256")
    .update(JSON.stringify([parentExecutionId, approach]))
    .digest("hex")}`;
}

function terminalUpdate(
  taskId: string,
  contextId: string,
  state: TaskState,
) {
  return AgentEvent.statusUpdate({
    taskId,
    contextId,
    status: {
      state,
      message: undefined,
      timestamp: new Date().toISOString(),
    },
    metadata: {},
  });
}

function planFromTask(task: Task, approach: PsychologyApproach): PsychologyPlan | undefined {
  if (task.status?.state !== TASK_STATE.COMPLETED) return undefined;
  const candidates = task.artifacts
    .filter((artifact) => artifact.artifactId === "psychology-plan")
    .flatMap((artifact) => artifact.parts)
    .filter((part) => part.mediaType === PLAN_MEDIA_TYPE)
    .map((part) => part.content?.$case === "data" ? part.content.value : undefined);
  if (candidates.length !== 1) return undefined;
  const parsed = psychologyPlanSchema.safeParse(candidates[0]);
  return parsed.success && parsed.data.approach === approach
    ? parsed.data
    : undefined;
}

function completedDiagnosticsFromTask(
  task: Task,
  requestIdentity: string,
  approach: PsychologyApproach,
): ExpertExecutionDiagnostic[] {
  const artifact = task.artifacts.find((item) => item.artifactId === "psychology-plan");
  const attempt = Number((artifact?.metadata as Record<string, unknown> | undefined)?.attempt);
  return [{
    executionId: requestIdentity,
    taskId: task.id,
    expertId: approach,
    attempt: Number.isInteger(attempt) && attempt >= 1 && attempt <= 3 ? attempt : 1,
    phase: "terminal",
    errorKind: "unknown",
    errorName: "Error",
    cause: "unknown",
    disposition: "completed",
  }];
}

function requestMatchesTask(
  task: Task,
  input: {
    requestIdentity: string;
    approach: PsychologyApproach;
    configurationRevision: string;
  },
) {
  const requests = task.history.flatMap((message) =>
    message.messageId === input.requestIdentity
      ? message.parts.flatMap((part) =>
          part.content?.$case === "data" ? [part.content.value] : [],
        )
      : [],
  );
  if (requests.length !== 1) return false;
  const request = psychologyA2ARequestSchema.safeParse(requests[0]);
  return request.success
    && request.data.approach === input.approach
    && request.data.configurationRevision === input.configurationRevision;
}

function runningTaskMatchesRequest(
  task: Task,
  input: Parameters<typeof requestMatchesTask>[1] & {
    consultation: PsychologyConsultation;
  },
) {
  if (!requestMatchesTask(task, input)) return false;
  const requests = task.history.flatMap((message) =>
    message.messageId === input.requestIdentity
      ? message.parts.flatMap((part) =>
          part.content?.$case === "data" ? [part.content.value] : [],
        )
      : [],
  );
  const request = psychologyA2ARequestSchema.safeParse(requests[0]);
  return request.success
    && request.data.consultation.request === input.consultation.request
    && request.data.consultation.urgency === input.consultation.urgency
    && request.data.consultation.knowledgeQuery === input.consultation.knowledgeQuery;
}

function recoverablePlanFromTask(
  task: Task | undefined,
  input: {
    requestIdentity: string;
    approach: PsychologyApproach;
    configurationRevision: string;
  },
): PsychologyPlan | undefined {
  if (!task || task.status?.state !== TASK_STATE.COMPLETED) return undefined;
  if (!requestMatchesTask(task, input)) return undefined;
  return planFromTask(task, input.approach);
}

function withCancellation<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => {
      finish(() => reject(signal.reason ?? new Error("A2A recovery canceled")));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

/**
 * Standard A2A client and Request/Response transport joined by an injected,
 * non-network bridge. The bearer and parent signals live only in this runtime.
 * The durable ledger resolves a stable task identity before sending. Existing
 * work is polled through the generic recovery helper and is never rerun.
 */
export function createInProcessPsychologyA2AFactory(
  options: PsychologyA2AFactoryOptions,
): PsychologyA2AFactory {
  if (!options.principal.owner || options.principal.tenant !== AJ_A2A_TENANT) {
    throw new Error("AJ A2A requires an authorized Repository principal");
  }
  return (bindings) => {
    if (bindings.length === 0) {
      return {
        async consult() {
          return { status: "unavailable", diagnostics: [] } as const;
        },
      };
    }
    const token = randomBytes(32).toString("base64url");
    const invocationSignals = new Map<string, AbortSignal>();
    const diagnosticsByExecution = new Map<string, ExpertExecutionDiagnostic[]>();
    const bindingByApproach = new Map(bindings.map((binding) => [binding.approach, binding]));
    if (bindingByApproach.size !== bindings.length) {
      throw new Error("Duplicate AJ psychology A2A specialist binding");
    }
    const recordDiagnostic = (diagnostic: ExpertExecutionDiagnostic) => {
      const existing = diagnosticsByExecution.get(diagnostic.executionId) ?? [];
      const next = [...existing, diagnostic].slice(-EXPERT_EXECUTION_MAX_ATTEMPTS);
      diagnosticsByExecution.set(diagnostic.executionId, next);
      options.executionDiagnostics?.({
        category: diagnostic.disposition === "completed"
          ? "expert_completed"
          : diagnostic.disposition === "retry_scheduled"
            ? "expert_retry_scheduled"
            : diagnostic.disposition === "retry_exhausted"
              ? "expert_retry_exhausted"
              : diagnostic.disposition === "nonretryable"
                ? "expert_nonretryable"
                : diagnostic.disposition === "canceled"
                  ? "expert_canceled"
                  : "expert_unavailable",
        diagnostic,
      });
    };
    const registry = new A2AAgentCardRegistry({
      schemaVersion: 1,
      publicBaseUrl: AJ_A2A_BASE_URL,
      agents: bindings.map((binding) => ({
        id: binding.approach,
        name: `${binding.label}心理专家`,
        description: `在 AJ 可信主机内承担${binding.label}心理专家任务并返回结构化回复。`,
        agentVersion: binding.revision,
        endpointPath: endpointPath(binding.approach),
        cardPath: cardPath(binding.approach),
        inputModes: ["application/json"],
        outputModes: [PLAN_MEDIA_TYPE],
        skills: [{
          id: `psychology-${binding.approach}`,
          name: `${binding.label}专家任务`,
          description: "返回专家自己的结构化用户回复与可核对来源。",
          tags: ["psychology", binding.approach],
          examples: [],
          inputModes: ["application/json"],
          outputModes: [PLAN_MEDIA_TYPE],
          securityRequirements: [],
        }],
        streaming: false,
      })),
    });
    const executors = bindings.map((binding) => ({
      agentId: binding.approach,
      executor: createAgentExecutor(binding.approach, {
        async execute(input, sink) {
          const invocationSignal = invocationSignals.get(input.message.messageId);
          if (!invocationSignal || invocationSignal.aborted) {
            sink.publish(terminalUpdate(
              input.taskId,
              input.contextId,
              invocationSignal?.aborted
                ? TASK_STATE.CANCELED
                : TASK_STATE.REJECTED,
            ));
            return;
          }
          const raw = input.message.parts.length === 1
            && input.message.parts[0]?.content?.$case === "data"
            ? input.message.parts[0].content.value
            : undefined;
          const parsed = psychologyA2ARequestSchema.safeParse(raw);
          if (!parsed.success || parsed.data.approach !== binding.approach) {
            sink.publish(terminalUpdate(
              input.taskId,
              input.contextId,
              TASK_STATE.REJECTED,
            ));
            return;
          }
          const signal = AbortSignal.any([input.signal, invocationSignal]);
          sink.publish(terminalUpdate(
            input.taskId,
            input.contextId,
            TASK_STATE.WORKING,
          ));
          let publishPhase: ExpertExecutionDiagnostic["phase"] = "execution";
          try {
            signal.throwIfAborted();
            const consultation = structuredClone(parsed.data.consultation);
            const retry = await retryA2AExecution({
              maxAttempts: EXPERT_EXECUTION_MAX_ATTEMPTS,
              signal,
              retryDelayMs: 20,
              execute: async (attempt) => {
                options.expertTelemetry?.({ category: "expert_execution", attempt });
                const value = await binding.execute(
                  structuredClone(consultation),
                  signal,
                  {
                    attempt,
                    executionId: input.message.messageId,
                    taskId: input.taskId,
                  },
                );
                const plan = psychologyPlanSchema.parse(value);
                if (plan.approach !== binding.approach) {
                  throw new Error("Psychology specialist returned another approach");
                }
                return plan;
              },
              classify: (error, attempt) => classifyExpertExecutionError({
                error,
                signal,
                executionId: input.message.messageId,
                taskId: input.taskId,
                expertId: binding.approach,
                attempt,
              }),
              onFailure: ({ disposition, attempt, diagnostic }) => {
                recordDiagnostic(withDisposition(diagnostic, disposition));
                if (disposition === "retry_scheduled") {
                  options.expertTelemetry?.({ category: "expert_retry_scheduled", attempt });
                } else if (disposition === "retry_exhausted") {
                  options.expertTelemetry?.({ category: "expert_retry_exhausted", attempt });
                } else if (disposition === "canceled") {
                  options.expertTelemetry?.({ category: "expert_canceled", attempt });
                } else {
                  options.expertTelemetry?.({ category: "expert_nonretryable", attempt });
                }
              },
            });
            signal.throwIfAborted();
            if (retry.status !== "completed") {
              sink.publish(terminalUpdate(
                input.taskId,
                input.contextId,
                retry.status === "canceled" ? TASK_STATE.CANCELED : TASK_STATE.FAILED,
              ));
              return;
            }
            const plan = retry.value;
            publishPhase = "artifact";
            sink.publish(AgentEvent.artifactUpdate({
              taskId: input.taskId,
              contextId: input.contextId,
              artifact: {
                artifactId: "psychology-plan",
                name: "PsychologyPlan",
                description: "AJ specialist-authored structured reply and evidence result",
                parts: [{
                  content: { $case: "data", value: plan },
                  mediaType: PLAN_MEDIA_TYPE,
                  filename: "",
                  metadata: { schemaVersion: 1 },
                }],
                metadata: {
                  schemaVersion: 1,
                  approach: binding.approach,
                  attempt: retry.attempt,
                },
                extensions: [],
              },
              append: false,
              lastChunk: true,
              metadata: {},
            }));
            publishPhase = "terminal";
            sink.publish(terminalUpdate(
              input.taskId,
              input.contextId,
              TASK_STATE.COMPLETED,
            ));
            recordDiagnostic({
              executionId: input.message.messageId,
              taskId: input.taskId,
              expertId: binding.approach,
              attempt: retry.attempt,
              phase: "terminal",
              errorKind: "unknown",
              errorName: "Error",
              cause: "unknown",
              disposition: "completed",
            });
            options.expertTelemetry?.({ category: "expert_completed", attempt: retry.attempt });
          } catch (error) {
            const previous = diagnosticsByExecution.get(input.message.messageId) ?? [];
            if (!signal.aborted && previous.at(-1)?.disposition === "completed") {
              // Nothing to add: a completed terminal event cannot be retried.
            } else if (!signal.aborted) {
              recordDiagnostic(withDisposition(classifyExpertExecutionError({
                error,
                signal,
                executionId: input.message.messageId,
                taskId: input.taskId,
                expertId: binding.approach,
                attempt: Math.max(1, previous.at(-1)?.attempt ?? 1),
                phase: publishPhase,
              }).diagnostic, "nonretryable"));
            }
            // The durable executor and transport already sanitize host failures.
            // This final guard only makes the task terminal; no raw error is persisted.
            sink.publish(terminalUpdate(
              input.taskId,
              input.contextId,
              signal.aborted
                ? TASK_STATE.CANCELED
                : TASK_STATE.FAILED,
            ));
          }
        },
      }),
    }));
    const transport = new A2AHttpTransport({
      registry,
      taskStore: options.taskStore,
      requestLedger: options.requestLedger,
      authentication: {
        async authenticate({ request }) {
          if (request.headers.get("authorization") !== `Bearer ${token}`) {
            throw new Error("AJ A2A runtime authentication failed");
          }
          return { ...options.principal };
        },
      },
      agents: executors,
    });
    const configuredUrls = new Set(
      registry.list().flatMap((agent) => [agent.cardUrl, agent.endpointUrl]),
    );
    const directBridgeFetch: typeof fetch = async (requestInput, init) => {
      const request = requestInput instanceof Request
        ? new Request(requestInput, init)
        : new Request(requestInput, init);
      if (!configuredUrls.has(request.url)) {
        throw new TypeError("AJ A2A bridge cannot access a network destination");
      }
      return transport.handleRequest(request);
    };
    const bridgeFetch: typeof fetch = options.transportIntercept
      ? async (requestInput, init) =>
        options.transportIntercept!(requestInput, init, directBridgeFetch)
      : directBridgeFetch;
    const clients = new Map(bindings.map((binding) => [
      binding.approach,
      new A2APeerClient({
        peerId: binding.approach,
        registry: new A2APeerRegistry({
          schemaVersion: 1,
          peers: [{
            id: binding.approach,
            baseUrl: AJ_A2A_BASE_URL,
            cardPath: cardPath(binding.approach),
            endpointPath: endpointPath(binding.approach),
          }],
        }),
        credentialProvider: async () => ({ Authorization: `Bearer ${token}` }),
        fetchImpl: bridgeFetch,
        budget: { deadlineMs: 60_000 },
      }),
    ]));

    return {
      async consult(input): Promise<PsychologyA2AOutcome> {
        const binding = bindingByApproach.get(input.approach);
        const client = clients.get(input.approach);
        if (!binding || !client) {
          return { status: "unavailable", diagnostics: [] };
        }
        const messageId = requestIdentity(
          input.parentExecutionId,
          input.approach,
        );
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), AJ_A2A_DEADLINE_MS);
        timer.unref?.();
        const invocationSignal = AbortSignal.any([input.signal, deadline.signal]);
        const request: SendMessageRequest = {
          tenant: "",
          message: {
            messageId,
            contextId: "",
            taskId: "",
            role: 1,
            parts: [{
              content: {
                $case: "data",
                value: {
                  schemaVersion: 1,
                  approach: input.approach,
                  configurationRevision: binding.revision,
                  consultation: input.consultation,
                },
              },
              mediaType: "application/json",
              filename: "",
              metadata: { schemaVersion: 1 },
            }],
            metadata: {},
            extensions: [],
            referenceTaskIds: [],
          },
          configuration: {
            acceptedOutputModes: [PLAN_MEDIA_TYPE],
            taskPushNotificationConfig: undefined,
            historyLength: 1,
            returnImmediately: false,
          },
          metadata: {},
        };
        const durableRecovery = options.recoverTask ?? options.recoverCompletedTask;
        const unavailable = (
          diagnostic?: Omit<ExpertExecutionDiagnostic, "disposition">,
        ): { status: "unavailable"; diagnostics: ExpertExecutionDiagnostic[] } => {
          if (!diagnostic) {
            return {
              status: "unavailable",
              diagnostics: diagnosticsByExecution.get(messageId) ?? [],
            };
          }
          const existing = diagnosticsByExecution.get(messageId) ?? [];
          if (existing.some((item) => item.attempt === diagnostic.attempt && item.phase === diagnostic.phase)) {
            return { status: "unavailable", diagnostics: existing };
          }
          const recorded = withDisposition(diagnostic, "recovery_unavailable");
          recordDiagnostic(recorded);
          return {
            status: "unavailable",
            diagnostics: [...existing, recorded].slice(-EXPERT_EXECUTION_MAX_ATTEMPTS),
          };
        };
        const recoverTask = async (): Promise<Task | undefined> => {
          if (!durableRecovery) return undefined;
          return await durableRecovery({
            scope: {
              tenant: options.principal.tenant,
              owner: options.principal.owner,
              agentId: input.approach,
            },
            requestIdentity: messageId,
          });
        };
        try {
          if (input.signal.aborted) return { status: "canceled" };
          if (durableRecovery) {
            let recoveryLookupFailed = false;
            const task: Task | undefined = await withCancellation(
              recoverTask(),
              invocationSignal,
            ).catch(() => {
              recoveryLookupFailed = true;
              return undefined;
            });
            if (recoveryLookupFailed) {
              // A failed or timed-out recovery lookup is authoritative only
              // as an unavailable state; it must not bypass the ledger with a
              // speculative send.
              if (input.signal.aborted) return { status: "canceled" };
              return unavailable({
                executionId: messageId,
                taskId: messageId,
                expertId: input.approach,
                attempt: 1,
                phase: "recovery",
                errorKind: "unknown",
                errorName: "Error",
                cause: "unknown",
              });
            }
            if (invocationSignal.aborted) return { status: "canceled" };
            const recoveredPlan = recoverablePlanFromTask(task, {
              requestIdentity: messageId,
              approach: input.approach,
              configurationRevision: binding.revision,
            });
            if (recoveredPlan) return {
              status: "completed",
              plan: recoveredPlan,
              diagnostics: completedDiagnosticsFromTask(
                task!,
                messageId,
                input.approach,
              ),
            };
            const terminal = task?.status?.state !== undefined && (
              task.status.state === TASK_STATE.COMPLETED
              || task.status.state === TASK_STATE.FAILED
              || task.status.state === TASK_STATE.CANCELED
              || task.status.state === TASK_STATE.REJECTED
            );
            if (terminal) return unavailable();
            if (task && !runningTaskMatchesRequest(task, {
              requestIdentity: messageId,
              approach: input.approach,
              configurationRevision: binding.revision,
              consultation: input.consultation,
            })) return unavailable({
              executionId: messageId,
              taskId: task.id,
              expertId: input.approach,
              attempt: 1,
              phase: "recovery",
              errorKind: "policy",
              errorName: "Error",
              cause: "policy",
            });
          }
          invocationSignals.set(messageId, invocationSignal);
          const outcome = await recoverA2ASendMessage({
            request,
            send: (sentRequest, options) => client.sendMessage(sentRequest, options),
            recoverTask,
            maxAttempts: 3,
            deadlineMs: AJ_A2A_DEADLINE_MS,
            retryDelayMs: 20,
            retryDelayMultiplier: 2,
            maxRetryDelayMs: 200,
            signal: invocationSignal,
          });
          if (invocationSignal.aborted) return { status: "canceled" };
          if (outcome.status === "canceled") return { status: "canceled" };
          if (outcome.status !== "ok") {
            return unavailable({
              executionId: messageId,
              taskId: messageId,
              expertId: input.approach,
              attempt: Math.max(1, outcome.attempts),
              phase: "recovery",
              errorKind: outcome.failure.kind === "network" || outcome.failure.kind === "timeout"
                ? "provider_network"
                : "unknown",
              errorName: "Error",
              ...(outcome.failure.kind === "timeout" ? { code: "TIMEOUT" } : {}),
              cause: outcome.failure.kind === "timeout"
                ? "timeout"
                : outcome.failure.kind === "network"
                  ? "network"
                  : "unknown",
            });
          }
          const matchesRequest = requestMatchesTask(outcome.task, {
            requestIdentity: messageId,
            approach: input.approach,
            configurationRevision: binding.revision,
          });
          const plan = planFromTask(outcome.task, input.approach);
          if (!matchesRequest) {
            return unavailable({
              executionId: messageId,
              taskId: outcome.task.id,
              expertId: input.approach,
              attempt: Math.max(1, outcome.attempts),
              phase: "validation",
              errorKind: "plan_validation",
              errorName: "Error",
              cause: "approach_mismatch",
            });
          }
          return plan
            ? {
                status: "completed",
                plan,
                diagnostics: diagnosticsByExecution.get(messageId) ?? [],
              }
            : ((diagnosticsByExecution.get(messageId)?.length ?? 0) > 0
              ? unavailable()
              : unavailable({
                executionId: messageId,
                taskId: outcome.task.id,
                expertId: input.approach,
                attempt: Math.max(1, outcome.attempts),
                phase: "artifact",
                errorKind: "plan_validation",
                errorName: "Error",
                cause: "plan_schema",
              }));
        } finally {
          clearTimeout(timer);
          if (invocationSignals.get(messageId) === invocationSignal) {
            invocationSignals.delete(messageId);
          }
        }
      },
    };
  };
}
