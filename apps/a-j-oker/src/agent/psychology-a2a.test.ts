import { describe, expect, it, vi } from "vitest";

import {
  A2A_TASK_STORE_SCOPE,
  type A2ARequestLedger,
  type A2ARequestLedgerEntry,
  type A2ARequestLedgerReservation,
  type A2ARequestLedgerScope,
  type ListTasksRequest,
  type ListTasksResponse,
  type ScopedA2ATaskStore,
  type ServerCallContext,
  type Task,
} from "@cfp/agent-a2a";

import {
  AJ_A2A_TENANT,
  createInProcessPsychologyA2AFactory,
  type PsychologyA2ACompletedTaskRecovery,
} from "./psychology-a2a";

class BridgeTaskStore implements ScopedA2ATaskStore {
  readonly a2aScope = A2A_TASK_STORE_SCOPE;
  private readonly values = new Map<string, Map<string, Task>>();
  private scope(context: ServerCallContext) {
    const key = JSON.stringify([context.tenant, context.user?.userName]);
    let tasks = this.values.get(key);
    if (!tasks) {
      tasks = new Map();
      this.values.set(key, tasks);
    }
    return tasks;
  }
  async save(task: Task, context: ServerCallContext) {
    this.scope(context).set(task.id, structuredClone(task));
  }
  async load(id: string, context: ServerCallContext) {
    const task = this.scope(context).get(id);
    return task ? structuredClone(task) : undefined;
  }
  async hasContext(id: string, context: ServerCallContext) {
    return [...this.scope(context).values()].some((task) => task.contextId === id);
  }
  async list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse> {
    const tasks = [...this.scope(context).values()];
    return { tasks: structuredClone(tasks), nextPageToken: "", pageSize: params.pageSize ?? 50, totalSize: tasks.length };
  }
}

class DelayedInitialSaveTaskStore extends BridgeTaskStore {
  readonly saveStarted = deferred<void>();
  readonly releaseSave = deferred<void>();
  readonly savedStates: number[] = [];
  private delayNextSave = true;

  override async save(task: Task, context: ServerCallContext) {
    if (this.delayNextSave) {
      this.delayNextSave = false;
      this.saveStarted.resolve();
      await this.releaseSave.promise;
    }
    await super.save(task, context);
    this.savedStates.push(task.status?.state ?? 0);
  }
}

class BridgeLedger implements A2ARequestLedger {
  private readonly entries = new Map<string, A2ARequestLedgerEntry>();
  private readonly tokens = new Map<string, string>();
  private key(scope: A2ARequestLedgerScope, id: string) {
    return JSON.stringify([scope.tenant, scope.owner, scope.agentId, id]);
  }
  async reserve(scope: A2ARequestLedgerScope, id: string, fingerprint: string): Promise<A2ARequestLedgerReservation> {
    const key = this.key(scope, id);
    const existing = this.entries.get(key);
    if (existing) return { outcome: "existing", entry: structuredClone(existing) };
    const token = crypto.randomUUID();
    const entry: A2ARequestLedgerEntry = { requestIdentity: id, fingerprint, status: "pending" };
    this.entries.set(key, entry);
    this.tokens.set(token, key);
    return { outcome: "new", token, entry: structuredClone(entry) };
  }
  async recordTask(token: string, task: Pick<Task, "id" | "contextId">) {
    const key = this.tokens.get(token);
    const entry = key ? this.entries.get(key) : undefined;
    if (!entry) throw new Error("missing reservation");
    Object.assign(entry, { status: "recorded", taskId: task.id, contextId: task.contextId });
  }
  async fail(token: string) {
    const key = this.tokens.get(token);
    const entry = key ? this.entries.get(key) : undefined;
    if (entry?.status === "pending") entry.status = "failed";
  }

  async findForRecovery(scope: A2ARequestLedgerScope, id: string) {
    const entry = this.entries.get(this.key(scope, id));
    return entry ? structuredClone(entry) : undefined;
  }
}

function bridgeCompletedTaskRecovery(
  taskStore: BridgeTaskStore,
  requestLedger: BridgeLedger,
): PsychologyA2ACompletedTaskRecovery {
  return async ({ scope, requestIdentity }) => {
    const entry = await requestLedger.findForRecovery(scope, requestIdentity);
    if (entry?.status !== "recorded" || !entry.taskId) return undefined;
    const context = {
      tenant: scope.tenant,
      user: { userName: JSON.stringify([scope.tenant, scope.owner, scope.agentId]) },
    } as ServerCallContext;
    return taskStore.load(entry.taskId, context);
  };
}

const consultation = {
  request: "请给出一个不虚构事实的可选小练习",
  urgency: "routine" as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((callbackResolve, callbackReject) => {
    resolve = callbackResolve;
    reject = callbackReject;
  });
  return { promise, resolve, reject };
}
const result = {
  schemaVersion: 1 as const,
  approach: "cbt" as const,
  summary: "区分事实与猜测",
  suggestions: ["写下一条已经确认的事实"],
  needsImmediateSupport: false,
  usedSourceIds: [],
  references: [],
};

describe("AJ 心理咨询标准 A2A 桥", () => {
  it("用 SDK DataPart 返回方案，并在适配器重建后恢复完成任务且不重复执行", async () => {
    const taskStore = new BridgeTaskStore();
    const requestLedger = new BridgeLedger();
    const execute = vi.fn(async () => result);
    const create = () => createInProcessPsychologyA2AFactory({
      principal: { owner: "alice", tenant: AJ_A2A_TENANT },
      taskStore,
      requestLedger,
    })([{ approach: "cbt", label: "认知行为", revision: "r1", execute }]);
    const first = await create().consult({ parentExecutionId: "turn-1", approach: "cbt", consultation, signal: new AbortController().signal });
    expect(first).toEqual({ status: "completed", plan: result });
    const recovered = await create().consult({ parentExecutionId: "turn-1", approach: "cbt", consultation, signal: new AbortController().signal });
    expect(recovered).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("隔离 owner 范围，失败任务不能授权流派", async () => {
    const taskStore = new BridgeTaskStore();
    const requestLedger = new BridgeLedger();
    const execute = vi.fn(async () => result);
    for (const owner of ["alice", "bob"]) {
      const runtime = createInProcessPsychologyA2AFactory({
        principal: { owner, tenant: AJ_A2A_TENANT }, taskStore, requestLedger,
      })([{ approach: "cbt", label: "认知行为", revision: "r1", execute }]);
      expect((await runtime.consult({ parentExecutionId: "same-turn", approach: "cbt", consultation, signal: new AbortController().signal })).status).toBe("completed");
    }
    expect(execute).toHaveBeenCalledTimes(2);

    const failed = createInProcessPsychologyA2AFactory({
      principal: { owner: "failed", tenant: AJ_A2A_TENANT }, taskStore, requestLedger,
    })([{ approach: "cbt", label: "认知行为", revision: "r1", execute: async () => { throw new Error("private detail"); } }]);
    expect(await failed.consult({ parentExecutionId: "turn", approach: "cbt", consultation, signal: new AbortController().signal })).toEqual({ status: "unavailable" });
  });

  it("宿主完成结果恢复允许同一修订下重写咨询，但不跨身份或修订", async () => {
    const taskStore = new BridgeTaskStore();
    const requestLedger = new BridgeLedger();
    const recoverCompletedTask = vi.fn(bridgeCompletedTaskRecovery(taskStore, requestLedger));
    const execute = vi.fn(async () => result);
    const create = (revision = "r1", owner = "alice") =>
      createInProcessPsychologyA2AFactory({
        principal: { owner, tenant: AJ_A2A_TENANT },
        taskStore,
        requestLedger,
        recoverCompletedTask,
      })([{ approach: "cbt", label: "认知行为", revision, execute }]);

    const first = await create().consult({
      parentExecutionId: "logical-turn",
      approach: "cbt",
      consultation,
      signal: new AbortController().signal,
    });
    expect(first).toEqual({ status: "completed", plan: result });
    const recovered = await create().consult({
      parentExecutionId: "logical-turn",
      approach: "cbt",
      consultation: { ...consultation, request: "新的协调者咨询措辞" },
      signal: new AbortController().signal,
    });
    expect(recovered).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);

    const stableIdentity = recoverCompletedTask.mock.calls[0]![0].requestIdentity;
    expect(await recoverCompletedTask({
      scope: { tenant: AJ_A2A_TENANT, owner: "bob", agentId: "cbt" },
      requestIdentity: stableIdentity,
    })).toBeUndefined();
    expect(await recoverCompletedTask({
      scope: { tenant: AJ_A2A_TENANT, owner: "alice", agentId: "dbt" },
      requestIdentity: stableIdentity,
    })).toBeUndefined();

    await expect(create("r2").consult({
      parentExecutionId: "logical-turn",
      approach: "cbt",
      consultation,
      signal: new AbortController().signal,
    })).resolves.toEqual({ status: "unavailable" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("同一稳定身份的未完成任务不能因咨询内容变化被重跑", async () => {
    const taskStore = new BridgeTaskStore();
    const requestLedger = new BridgeLedger();
    const execute = vi.fn(async (_input: unknown, signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      signal.throwIfAborted();
      return result;
    });
    const create = () => createInProcessPsychologyA2AFactory({
      principal: { owner: "alice", tenant: AJ_A2A_TENANT },
      taskStore,
      requestLedger,
      recoverCompletedTask: bridgeCompletedTaskRecovery(taskStore, requestLedger),
    })([{ approach: "cbt", label: "认知行为", revision: "r1", execute }]);
    const controller = new AbortController();
    const pending = create().consult({
      parentExecutionId: "pending-turn",
      approach: "cbt",
      consultation,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    await expect(create().consult({
      parentExecutionId: "pending-turn",
      approach: "cbt",
      consultation: { ...consultation, request: "重写后的咨询" },
      signal: new AbortController().signal,
    })).resolves.toEqual({ status: "unavailable" });
    expect(execute).toHaveBeenCalledOnce();

    controller.abort();
    await expect(pending).resolves.toEqual({ status: "canceled" });
  });

  it("恢复查询未完成前取消时不交付迟到的完成任务", async () => {
    const taskStore = new BridgeTaskStore();
    const requestLedger = new BridgeLedger();
    const execute = vi.fn(async () => result);
    const create = (recoverCompletedTask?: PsychologyA2ACompletedTaskRecovery) =>
      createInProcessPsychologyA2AFactory({
        principal: { owner: "alice", tenant: AJ_A2A_TENANT },
        taskStore,
        requestLedger,
        recoverCompletedTask,
      })([{ approach: "cbt", label: "认知行为", revision: "r1", execute }]);

    await expect(create().consult({
      parentExecutionId: "deferred-recovery-turn",
      approach: "cbt",
      consultation,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({ status: "completed" });
    const gate = deferred<void>();
    let recoveryWaiting = false;
    const second = create(async (input) => {
      const task = await bridgeCompletedTaskRecovery(taskStore, requestLedger)(input);
      recoveryWaiting = true;
      await gate.promise;
      return task;
    });
    const controller = new AbortController();
    const pending = second.consult({
      parentExecutionId: "deferred-recovery-turn",
      approach: "cbt",
      consultation,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(recoveryWaiting).toBe(true));
    controller.abort();
    await expect(pending).resolves.toEqual({ status: "canceled" });
    gate.resolve();
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("恢复查询失败时不绕过账本发送", async () => {
    const execute = vi.fn(async () => result);
    const runtime = createInProcessPsychologyA2AFactory({
      principal: { owner: "alice", tenant: AJ_A2A_TENANT },
      taskStore: new BridgeTaskStore(),
      requestLedger: new BridgeLedger(),
      recoverCompletedTask: async () => {
        throw new Error("ledger unavailable");
      },
    })([{ approach: "cbt", label: "认知行为", revision: "r1", execute }]);

    await expect(runtime.consult({
      parentExecutionId: "lookup-error-turn",
      approach: "cbt",
      consultation,
      signal: new AbortController().signal,
    })).resolves.toEqual({ status: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("把父取消信号传到专家并把中断视为不可用，而不晚交付方案", async () => {
    const controller = new AbortController();
    const observed = vi.fn();
    const runtime = createInProcessPsychologyA2AFactory({
      principal: { owner: "alice", tenant: AJ_A2A_TENANT },
      taskStore: new BridgeTaskStore(),
      requestLedger: new BridgeLedger(),
    })([{ approach: "cbt", label: "认知行为", revision: "r1", execute: async (_input, signal) => {
      observed(signal);
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      signal.throwIfAborted();
      return result;
    } }]);
    const pending = runtime.consult({ parentExecutionId: "cancel-turn", approach: "cbt", consultation, signal: controller.signal });
    await vi.waitFor(() => expect(observed).toHaveBeenCalledOnce());
    controller.abort();
    expect(await pending).toEqual({ status: "canceled" });
    expect((observed.mock.calls[0]?.[0] as AbortSignal).aborted).toBe(true);
  });

  it("初始任务持久化延迟跨过父取消后，不再授权迟到的专家执行", async () => {
    const controller = new AbortController();
    const taskStore = new DelayedInitialSaveTaskStore();
    const execute = vi.fn(async () => result);
    const runtime = createInProcessPsychologyA2AFactory({
      principal: { owner: "alice", tenant: AJ_A2A_TENANT },
      taskStore,
      requestLedger: new BridgeLedger(),
    })([{ approach: "cbt", label: "认知行为", revision: "r1", execute }]);
    const pending = runtime.consult({
      parentExecutionId: "delayed-cancel-turn",
      approach: "cbt",
      consultation,
      signal: controller.signal,
    });
    try {
      await taskStore.saveStarted.promise;
      controller.abort();
      await expect(pending).resolves.toEqual({ status: "canceled" });
      taskStore.releaseSave.resolve();
      await vi.waitFor(() => expect(taskStore.savedStates.length).toBeGreaterThan(1));
      expect(execute).not.toHaveBeenCalled();
      expect(taskStore.savedStates).not.toContain(3);
    } finally {
      controller.abort();
      taskStore.releaseSave.resolve();
      await pending;
    }
  });

  it("客户端截止时间也会中止正在运行的进程内专家", async () => {
    vi.useFakeTimers();
    const observed = deferred<AbortSignal>();
    const runtime = createInProcessPsychologyA2AFactory({
      principal: { owner: "alice", tenant: AJ_A2A_TENANT },
      taskStore: new BridgeTaskStore(),
      requestLedger: new BridgeLedger(),
    })([{ approach: "cbt", label: "认知行为", revision: "r1", execute: async (_input, signal) => {
      observed.resolve(signal);
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      signal.throwIfAborted();
      return result;
    } }]);
    try {
      const pending = runtime.consult({
        parentExecutionId: "deadline-turn",
        approach: "cbt",
        consultation,
        signal: new AbortController().signal,
      });
      const signal = await observed.promise;
      await vi.advanceTimersByTimeAsync(60_001);
      expect(signal.aborted).toBe(true);
      await expect(pending).resolves.toEqual({ status: "canceled" });
    } finally {
      vi.useRealTimers();
    }
  });
});
