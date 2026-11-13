import { createHash, randomUUID } from "node:crypto";

import {
  A2A_TASK_STORE_SCOPE,
  getA2AAgentId,
  getA2APrincipal,
  type A2ARequestLedger,
  type A2ARequestLedgerEntry,
  type A2ARequestLedgerReservation,
  type A2ARequestLedgerScope,
  type ListTasksRequest,
  type ListTasksResponse,
  type ScopedA2ATaskStore,
  type ServerCallContext,
  type Task,
  type TaskState,
} from "@cfp/agent-a2a";
import type { Payload, Where } from "payload";

import type { Repository } from "./repository";

const MAX_HISTORY = 8;
const MAX_ARTIFACTS = 4;
const MAX_PARTS = 8;
const MAX_SNAPSHOT_BYTES = 512_000;
const TASK_STATE = {
  UNSPECIFIED: 0 as TaskState,
  COMPLETED: 3 as TaskState,
  FAILED: 4 as TaskState,
  CANCELED: 5 as TaskState,
  REJECTED: 7 as TaskState,
};
const terminalStates = new Set<TaskState>([
  TASK_STATE.COMPLETED,
  TASK_STATE.FAILED,
  TASK_STATE.CANCELED,
  TASK_STATE.REJECTED,
]);

type Scope = A2ARequestLedgerScope;

function scopeKey(scope: Scope, identity: string): string {
  return createHash("sha256")
    .update(JSON.stringify([scope.tenant, scope.owner, scope.agentId, identity]))
    .digest("hex");
}

function taskScope(context: ServerCallContext): Scope {
  const principal = getA2APrincipal(context);
  return {
    tenant: principal.tenant,
    owner: principal.owner,
    agentId: getA2AAgentId(context),
  };
}

function scopeWhere(scope: Scope, extra: Where = {}): Where {
  return {
    and: [
      { owner: { equals: scope.owner } },
      { tenant: { equals: scope.tenant } },
      { agentId: { equals: scope.agentId } },
      extra,
    ],
  };
}

function boundedTask(value: Task): Task {
  const task = structuredClone(value);
  task.history = (task.history ?? []).slice(-MAX_HISTORY).map((message) => ({
    ...message,
    parts: message.parts.slice(0, MAX_PARTS),
  }));
  task.artifacts = (task.artifacts ?? []).slice(-MAX_ARTIFACTS).map((artifact) => ({
    ...artifact,
    parts: artifact.parts.slice(0, MAX_PARTS),
  }));
  if (Buffer.byteLength(JSON.stringify(task), "utf8") > MAX_SNAPSHOT_BYTES) {
    throw new Error("A2A task snapshot exceeds the AJ execution-state limit");
  }
  return task;
}

function projectTask(
  task: Task,
  historyLength: number | undefined,
  includeArtifacts = true,
): Task {
  const result = structuredClone(task);
  if (historyLength !== undefined) {
    result.history = historyLength === 0
      ? []
      : (result.history ?? []).slice(-Math.max(0, historyLength));
  }
  if (!includeArtifacts) result.artifacts = [];
  return result;
}

function pageCursor(value: string): number {
  if (!value) return 0;
  if (!/^\d{1,9}$/.test(value)) throw new Error("Invalid A2A page token");
  return Number(value);
}

/** Payload-backed scoped store. Production has no in-memory fallback. */
export class PayloadA2ATaskStore implements ScopedA2ATaskStore {
  readonly a2aScope = A2A_TASK_STORE_SCOPE;

  constructor(
    private readonly payload: Payload,
    private readonly authorizedOwner: string,
    private readonly authorizedTenant: string,
  ) {}

  private options(scope: Scope) {
    if (
      scope.owner !== this.authorizedOwner
      || scope.tenant !== this.authorizedTenant
    ) {
      throw new Error("A2A storage scope is not authorized by this Repository");
    }
    return {
      overrideAccess: false as const,
      depth: 0 as const,
      context: {
        helloOwner: this.authorizedOwner,
        helloWrite: true,
        helloA2A: true,
      },
    };
  }

  async load(taskId: string, context: ServerCallContext): Promise<Task | undefined> {
    const scope = taskScope(context);
    const row = await this.findTask(scope, taskId);
    return row ? structuredClone(row.snapshot) : undefined;
  }

  async hasContext(contextId: string, context: ServerCallContext): Promise<boolean> {
    const scope = taskScope(context);
    const result = await this.payload.count({
      collection: "a2a-execution-tasks",
      ...this.options(scope),
      where: scopeWhere(scope, { contextId: { equals: contextId } }),
    });
    return result.totalDocs > 0;
  }

  async save(value: Task, context: ServerCallContext): Promise<void> {
    const scope = taskScope(context);
    const options = this.options(scope);
    const task = boundedTask(value);
    const state = task.status?.state ?? TASK_STATE.UNSPECIFIED;
    const key = scopeKey(scope, task.id);
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.findTask(scope, task.id);
      if (!current) {
        try {
          await this.payload.create({
            collection: "a2a-execution-tasks",
            ...options,
            data: {
              ...scope,
              key,
              taskId: task.id,
              contextId: task.contextId,
              state,
              statusTimestamp: task.status?.timestamp,
              revision: 1,
              snapshot: task,
            },
          });
          return;
        } catch (error) {
          if (!await this.findTask(scope, task.id)) throw error;
          continue;
        }
      }
      const previousState = current.state as TaskState;
      if (terminalStates.has(previousState)) {
        if (state !== previousState) {
          throw new Error("A2A terminal task state cannot transition");
        }
        return;
      }
      const updated = await this.payload.update({
        collection: "a2a-execution-tasks",
        ...options,
        where: scopeWhere(scope, {
          and: [
            { id: { equals: current.id } },
            { revision: { equals: current.revision } },
          ],
        }),
        data: {
          contextId: task.contextId,
          state,
          statusTimestamp: task.status?.timestamp,
          revision: current.revision + 1,
          snapshot: task,
        },
      });
      if (updated.docs.length === 1 && updated.errors.length === 0) return;
      if (updated.errors.length) throw new Error("A2A task conditional update failed");
    }
    throw new Error("A2A task update conflicted repeatedly");
  }

  async list(
    params: ListTasksRequest,
    context: ServerCallContext,
  ): Promise<ListTasksResponse> {
    const scope = taskScope(context);
    const cursor = pageCursor(params.pageToken);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
    const filters: Where[] = [];
    if (params.contextId) filters.push({ contextId: { equals: params.contextId } });
    if (params.status !== TASK_STATE.UNSPECIFIED) {
      filters.push({ state: { equals: params.status } });
    }
    if (params.statusTimestampAfter) {
      filters.push({ statusTimestamp: { greater_than_equal: params.statusTimestampAfter } });
    }
    const baseWhere = scopeWhere(scope, filters.length ? { and: filters } : {});
    const pageFilters = [
      ...filters,
      ...(cursor ? [{ id: { greater_than: cursor } }] : []),
    ];
    const pageWhere = scopeWhere(
      scope,
      pageFilters.length ? { and: pageFilters } : {},
    );
    const [rows, count] = await Promise.all([
      this.payload.find({
        collection: "a2a-execution-tasks",
        ...this.options(scope),
        where: pageWhere,
        limit: pageSize + 1,
        pagination: false,
        sort: "id",
      }),
      this.payload.count({
        collection: "a2a-execution-tasks",
        ...this.options(scope),
        where: baseWhere,
      }),
    ]);
    const page = rows.docs.slice(0, pageSize);
    return {
      tasks: page.map((row) => projectTask(
        row.snapshot,
        params.historyLength,
        params.includeArtifacts === true,
      )),
      nextPageToken: rows.docs.length > pageSize
        ? String(page.at(-1)?.id ?? "")
        : "",
      pageSize,
      totalSize: count.totalDocs,
    };
  }

  private async findTask(scope: Scope, taskId: string) {
    const result = await this.payload.find({
      collection: "a2a-execution-tasks",
      ...this.options(scope),
      where: scopeWhere(scope, { taskId: { equals: taskId } }),
      limit: 1,
    });
    return result.docs[0];
  }
}

type Reservation = {
  key: string;
  scope: Scope;
};

export interface A2ACompletedTaskRecoveryInput {
  scope: Scope;
  requestIdentity: string;
}

export class PayloadA2ARequestLedger implements A2ARequestLedger {
  private readonly reservations = new Map<string, Reservation>();

  constructor(
    private readonly payload: Payload,
    private readonly authorizedOwner: string,
    private readonly authorizedTenant: string,
  ) {}

  private options(scope: Scope) {
    if (
      scope.owner !== this.authorizedOwner
      || scope.tenant !== this.authorizedTenant
    ) {
      throw new Error("A2A ledger scope is not authorized by this Repository");
    }
    return {
      overrideAccess: false as const,
      depth: 0 as const,
      context: {
        helloOwner: this.authorizedOwner,
        helloWrite: true,
        helloA2A: true,
      },
    };
  }

  async reserve(
    scope: Scope,
    requestIdentity: string,
    fingerprint: string,
  ): Promise<A2ARequestLedgerReservation> {
    const key = scopeKey(scope, requestIdentity);
    const options = this.options(scope);
    try {
      await this.payload.create({
        collection: "a2a-request-ledgers",
        ...options,
        data: {
          ...scope,
          key,
          requestIdentity,
          fingerprint,
          status: "pending",
          revision: 1,
        },
      });
      const token = randomUUID();
      this.reservations.set(token, { key, scope: { ...scope } });
      return {
        outcome: "new",
        token,
        entry: { requestIdentity, fingerprint, status: "pending" },
      };
    } catch (error) {
      const existing = await this.find(scope, key);
      if (!existing) throw error;
      return { outcome: "existing", entry: this.entry(existing) };
    }
  }

  async recordTask(
    token: string,
    task: Pick<Task, "id" | "contextId">,
  ): Promise<void> {
    const reservation = this.reservations.get(token);
    if (!reservation) throw new Error("Unknown A2A ledger reservation");
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const row = await this.find(reservation.scope, reservation.key);
        if (!row) throw new Error("A2A ledger reservation disappeared");
        if (row.status === "recorded") {
          if (row.taskId !== task.id || row.contextId !== task.contextId) {
            throw new Error("A2A ledger was recorded for another task");
          }
          return;
        }
        if (row.status !== "pending") throw new Error("A2A ledger reservation already failed");
        const result = await this.payload.update({
          collection: "a2a-request-ledgers",
          ...this.options(reservation.scope),
          where: scopeWhere(reservation.scope, {
            and: [
              { id: { equals: row.id } },
              { revision: { equals: row.revision } },
              { status: { equals: "pending" } },
            ],
          }),
          data: {
            status: "recorded",
            taskId: task.id,
            contextId: task.contextId,
            revision: row.revision + 1,
          },
        });
        if (result.docs.length === 1 && result.errors.length === 0) return;
      }
      throw new Error("A2A ledger update conflicted repeatedly");
    } finally {
      this.reservations.delete(token);
    }
  }

  async fail(token: string): Promise<void> {
    const reservation = this.reservations.get(token);
    if (!reservation) return;
    try {
      const row = await this.find(reservation.scope, reservation.key);
      if (!row || row.status !== "pending") return;
      await this.payload.update({
        collection: "a2a-request-ledgers",
        ...this.options(reservation.scope),
        where: scopeWhere(reservation.scope, {
          and: [
            { id: { equals: row.id } },
            { revision: { equals: row.revision } },
            { status: { equals: "pending" } },
          ],
        }),
        data: { status: "failed", revision: row.revision + 1 },
      });
    } finally {
      this.reservations.delete(token);
    }
  }

  /**
   * Host-owned completed-result recovery join. The ledger owns the stable
   * request identity and the task collection owns the durable snapshot; this
   * method does not relax same-ID/different-fingerprint request rejection.
   */
  async recoverCompletedTask(
    input: A2ACompletedTaskRecoveryInput,
  ): Promise<Task | undefined> {
    const row = await this.find(input.scope, scopeKey(
      input.scope,
      input.requestIdentity,
    ));
    if (!row || row.status !== "recorded" || !row.taskId || !row.contextId) {
      return undefined;
    }
    const result = await this.payload.find({
      collection: "a2a-execution-tasks",
      ...this.options(input.scope),
      where: scopeWhere(input.scope, {
        and: [
          { taskId: { equals: row.taskId } },
          { contextId: { equals: row.contextId } },
        ],
      }),
      limit: 1,
    });
    const task = result.docs[0]?.snapshot;
    if (!task || task.id !== row.taskId || task.contextId !== row.contextId) {
      return undefined;
    }
    return task.status?.state === TASK_STATE.COMPLETED
      ? structuredClone(task)
      : undefined;
  }

  private async find(scope: Scope, key: string) {
    const result = await this.payload.find({
      collection: "a2a-request-ledgers",
      ...this.options(scope),
      where: scopeWhere(scope, { key: { equals: key } }),
      limit: 1,
    });
    return result.docs[0];
  }

  private entry(row: {
    requestIdentity: string;
    fingerprint: string;
    status: "pending" | "recorded" | "failed";
    taskId?: string | null;
    contextId?: string | null;
  }): A2ARequestLedgerEntry {
    return {
      requestIdentity: row.requestIdentity,
      fingerprint: row.fingerprint,
      status: row.status,
      taskId: row.taskId ?? undefined,
      contextId: row.contextId ?? undefined,
    };
  }
}

export function createPayloadA2AStorage(repo: Repository, tenant: string) {
  const requestLedger = new PayloadA2ARequestLedger(repo.payload, repo.owner.id, tenant);
  return {
    taskStore: new PayloadA2ATaskStore(repo.payload, repo.owner.id, tenant),
    requestLedger,
    recoverCompletedTask: (input: A2ACompletedTaskRecoveryInput) =>
      requestLedger.recoverCompletedTask(input),
  };
}
