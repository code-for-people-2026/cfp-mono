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
  type Task,
  type TaskState,
} from "@cfp/agent-a2a";

import type { PsychologyApproach } from "./psychology";
import {
  psychologyA2ARequestSchema,
  psychologyPlanSchema,
  type PsychologyConsultation,
  type PsychologyPlan,
} from "./psychology-plan";

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
  ) => Promise<PsychologyPlan>;
};

export type PsychologyA2AOutcome =
  | { status: "completed"; plan: PsychologyPlan }
  | { status: "unavailable" }
  | { status: "canceled" };

export interface PsychologyA2ARuntime {
  consult(input: {
    parentExecutionId: string;
    approach: PsychologyApproach;
    consultation: PsychologyConsultation;
    signal: AbortSignal;
  }): Promise<PsychologyA2AOutcome>;
}

export type PsychologyA2AFactory = (
  bindings: PsychologySpecialistBinding[],
) => PsychologyA2ARuntime;

export type PsychologyA2AFactoryOptions = {
  principal: AuthenticatedA2APrincipal;
  taskStore: ScopedA2ATaskStore;
  requestLedger: A2ARequestLedger;
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

/**
 * Standard A2A client and Request/Response transport joined by an injected,
 * non-network bridge. The bearer and parent signals live only in this runtime.
 * After restart, the durable ledger replays a validated completed task. A
 * submitted/working task is returned as unavailable: unknown effects are not
 * automatically rerun and interrupted work is not claimed to have resumed.
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
          return { status: "unavailable" } as const;
        },
      };
    }
    const token = randomBytes(32).toString("base64url");
    const invocationSignals = new Map<string, AbortSignal>();
    const bindingByApproach = new Map(bindings.map((binding) => [binding.approach, binding]));
    if (bindingByApproach.size !== bindings.length) {
      throw new Error("Duplicate AJ psychology A2A specialist binding");
    }
    const registry = new A2AAgentCardRegistry({
      schemaVersion: 1,
      publicBaseUrl: AJ_A2A_BASE_URL,
      agents: bindings.map((binding) => ({
        id: binding.approach,
        name: `${binding.label}心理专家`,
        description: `在 AJ 可信主机内提供${binding.label}心理方案。`,
        agentVersion: binding.revision,
        endpointPath: endpointPath(binding.approach),
        cardPath: cardPath(binding.approach),
        inputModes: ["application/json"],
        outputModes: [PLAN_MEDIA_TYPE],
        skills: [{
          id: `psychology-${binding.approach}`,
          name: `${binding.label}方案`,
          description: "返回供协调者整合的结构化心理方案，不直接回复用户。",
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
          try {
            signal.throwIfAborted();
            const plan = psychologyPlanSchema.parse(
              await binding.execute(parsed.data.consultation, signal),
            );
            signal.throwIfAborted();
            if (plan.approach !== binding.approach) {
              throw new Error("Psychology specialist returned another approach");
            }
            sink.publish(AgentEvent.artifactUpdate({
              taskId: input.taskId,
              contextId: input.contextId,
              artifact: {
                artifactId: "psychology-plan",
                name: "PsychologyPlan",
                description: "AJ coordinator-only structured psychology consultation result",
                parts: [{
                  content: { $case: "data", value: plan },
                  mediaType: PLAN_MEDIA_TYPE,
                  filename: "",
                  metadata: { schemaVersion: 1 },
                }],
                metadata: { schemaVersion: 1, approach: binding.approach },
                extensions: [],
              },
              append: false,
              lastChunk: true,
              metadata: {},
            }));
            sink.publish(terminalUpdate(
              input.taskId,
              input.contextId,
              TASK_STATE.COMPLETED,
            ));
          } catch {
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
    const bridgeFetch: typeof fetch = async (requestInput, init) => {
      const request = requestInput instanceof Request
        ? new Request(requestInput, init)
        : new Request(requestInput, init);
      if (!configuredUrls.has(request.url)) {
        throw new TypeError("AJ A2A bridge cannot access a network destination");
      }
      return transport.handleRequest(request);
    };
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
        if (!binding || !client) return { status: "unavailable" };
        const messageId = requestIdentity(
          input.parentExecutionId,
          input.approach,
        );
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), AJ_A2A_DEADLINE_MS);
        timer.unref?.();
        const invocationSignal = AbortSignal.any([input.signal, deadline.signal]);
        invocationSignals.set(messageId, invocationSignal);
        try {
          const outcome = await client.sendMessage({
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
          }, { signal: invocationSignal });
          if (outcome.status === "canceled") return { status: "canceled" };
          if (outcome.status !== "ok" || "messageId" in outcome.value) {
            return { status: "unavailable" };
          }
          const plan = planFromTask(outcome.value, input.approach);
          return plan
            ? { status: "completed", plan }
            : { status: "unavailable" };
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
