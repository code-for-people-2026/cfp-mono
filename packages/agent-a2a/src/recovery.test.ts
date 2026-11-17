import { describe, expect, it, vi } from "vitest";
import { TaskState } from "@a2a-js/sdk";

import { recoverA2ASendMessage } from "./recovery";
import type { PeerOutcome, SendMessageRequest, Task } from "./index";

function task(state: TaskState, id = "task-1"): Task {
  return {
    id,
    contextId: "context-1",
    status: {
      state,
      message: undefined,
      timestamp: "2026-11-16T00:00:00.000Z",
    },
    artifacts: [],
    history: [],
    metadata: {},
  };
}

const completedTask = task(TaskState.TASK_STATE_COMPLETED);
const workingTask = task(TaskState.TASK_STATE_WORKING);

function request(messageId: string): SendMessageRequest {
  return {
    message: {
      messageId,
      contextId: "",
      taskId: "",
      role: 1,
      parts: [],
      metadata: {},
      extensions: [],
      referenceTaskIds: [],
    },
    tenant: "",
    configuration: {
      acceptedOutputModes: [],
      taskPushNotificationConfig: undefined,
      historyLength: 1,
      returnImmediately: false,
    },
    metadata: {},
  };
}

function failed(kind: "network" | "timeout" | "protocol" | "budget" | "unknown") {
  return {
    status: "failed" as const,
    failure: { kind, message: "A2A peer call failed" },
  };
}

function ok(value: Task): PeerOutcome<Task> {
  return { status: "ok", value };
}

function never(): Promise<never> {
  return new Promise(() => undefined);
}

describe("A2A send recovery", () => {
  it("retries only a transient request failure with the exact same request", async () => {
    const sendRequest = request("same-id");
    const send = vi.fn(async (
      _request: SendMessageRequest,
      _options?: { signal?: AbortSignal },
    ) => (
      send.mock.calls.length === 1 ? failed("network") : ok(completedTask)
    ));

    const outcome = await recoverA2ASendMessage({
      request: sendRequest,
      send,
      recoverTask: async () => undefined,
      maxAttempts: 3,
      deadlineMs: 1_000,
      retryDelayMs: 0,
    });

    expect(outcome).toMatchObject({ status: "ok", task: completedTask, attempts: 2, origin: "send" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe(sendRequest);
    expect(send.mock.calls[1]?.[0]).toBe(sendRequest);
    expect(send.mock.calls[0]?.[0]).toEqual(send.mock.calls[1]?.[0]);
  });

  it("bounds a send implementation that never observes its abort signal", async () => {
    vi.useFakeTimers();
    try {
      let sendSignal: AbortSignal | undefined;
      const send = vi.fn((
        _request: SendMessageRequest,
        options?: { signal?: AbortSignal },
      ) => {
        sendSignal = options?.signal;
        return never();
      });
      const pending = recoverA2ASendMessage({
        request: request("hung-send"),
        send,
        recoverTask: async () => undefined,
        maxAttempts: 3,
        deadlineMs: 20,
        retryDelayMs: 0,
      });
      await vi.advanceTimersByTimeAsync(20);
      await expect(pending).resolves.toMatchObject({
        status: "failed",
        failure: { kind: "timeout" },
        attempts: 1,
      });
      expect(send).toHaveBeenCalledOnce();
      expect(sendSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a recovery lookup that never resolves", async () => {
    vi.useFakeTimers();
    try {
      let lookups = 0;
      const recoverTask = vi.fn(async (): Promise<Task | undefined> => {
        // The first lookup proves no task exists; the post-send lookup hangs.
        return ++lookups === 1 ? undefined : never();
      });
      const pending = recoverA2ASendMessage({
        request: request("hung-recovery"),
        send: async () => failed("network"),
        recoverTask,
        maxAttempts: 3,
        deadlineMs: 20,
        retryDelayMs: 0,
      });
      await vi.advanceTimersByTimeAsync(20);
      await expect(pending).resolves.toMatchObject({
        status: "failed",
        failure: { kind: "timeout" },
        attempts: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls a successful WORKING response without sending again", async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn(async () => ok(workingTask));
      const recoverTask = vi.fn(async (): Promise<Task | undefined> => {
        if (recoverTask.mock.calls.length === 1) return undefined;
        return recoverTask.mock.calls.length === 2 ? workingTask : completedTask;
      });
      const pending = recoverA2ASendMessage({
        request: request("send-working"),
        send,
        recoverTask,
        maxAttempts: 3,
        deadlineMs: 100,
        retryDelayMs: 0,
      });
      await vi.advanceTimersByTimeAsync(20);
      await expect(pending).resolves.toMatchObject({
        status: "ok",
        task: completedTask,
        attempts: 1,
        origin: "send",
      });
      expect(send).toHaveBeenCalledOnce();
      expect(recoverTask).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a pre-existing terminal task before any send, including terminal failures", async () => {
    const send = vi.fn(async () => ok(completedTask));
    const recoverTask = vi.fn(async () => task(TaskState.TASK_STATE_FAILED));

    const outcome = await recoverA2ASendMessage({
      request: request("preexisting"),
      send,
      recoverTask,
      maxAttempts: 3,
      deadlineMs: 100,
      retryDelayMs: 0,
    });

    expect(outcome).toMatchObject({
      status: "ok",
      task: { status: { state: TaskState.TASK_STATE_FAILED } },
      attempts: 0,
      origin: "recovery",
    });
    expect(send).not.toHaveBeenCalled();
    expect(recoverTask).toHaveBeenCalledOnce();
  });

  it("keeps polling positive and bounded when the configured backoff is zero", async () => {
    vi.useFakeTimers();
    try {
      const recoverTask = vi.fn(async (): Promise<Task | undefined> => {
        if (recoverTask.mock.calls.length === 1) return undefined;
        return recoverTask.mock.calls.length === 2 ? workingTask : completedTask;
      });
      const pending = recoverA2ASendMessage({
        request: request("zero-poll"),
        send: async () => failed("network"),
        recoverTask,
        maxAttempts: 3,
        deadlineMs: 100,
        retryDelayMs: 0,
      });
      await vi.advanceTimersByTimeAsync(20);
      await expect(pending).resolves.toMatchObject({
        status: "ok",
        task: completedTask,
        origin: "recovery",
      });
      expect(recoverTask).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("distinguishes caller cancellation from timeout during a hung recovery", async () => {
    const controller = new AbortController();
    let cancelLookups = 0;
    const recoverTask = vi.fn(async (): Promise<Task | undefined> => (
      ++cancelLookups === 1 ? undefined : never()
    ));
    const pending = recoverA2ASendMessage({
      request: request("cancel-recovery"),
      send: async () => failed("network"),
      recoverTask,
      maxAttempts: 3,
      deadlineMs: 10_000,
      retryDelayMs: 0,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(recoverTask).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(pending).resolves.toEqual({ status: "canceled", attempts: 1 });
  });

  it("distinguishes caller cancellation from timeout during backoff", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    try {
      const pending = recoverA2ASendMessage({
        request: request("cancel-backoff"),
        send: async () => failed("network"),
        recoverTask: async () => undefined,
        maxAttempts: 3,
        deadlineMs: 10_000,
        retryDelayMs: 100,
        signal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      await expect(pending).resolves.toEqual({ status: "canceled", attempts: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry permanent protocol failures", async () => {
    const send = vi.fn(async () => failed("protocol"));

    const outcome = await recoverA2ASendMessage({
      request: request("protocol"),
      send,
      recoverTask: async () => undefined,
      maxAttempts: 3,
      deadlineMs: 1_000,
      retryDelayMs: 0,
    });

    expect(outcome).toMatchObject({ status: "failed", failure: { kind: "protocol" }, attempts: 1 });
    expect(send).toHaveBeenCalledOnce();
  });

  it("does not speculate after an unknown send throw or recovery failure", async () => {
    const send = vi.fn(async () => {
      throw new Error("unclassified peer failure");
    });
    let unknownLookups = 0;
    const noExistingTask = vi.fn(async (): Promise<Task | undefined> => {
      return ++unknownLookups === 1 ? undefined : undefined;
    });
    await expect(recoverA2ASendMessage({
      request: request("unknown-send"),
      send,
      recoverTask: noExistingTask,
      maxAttempts: 3,
      deadlineMs: 1_000,
      retryDelayMs: 0,
    })).resolves.toMatchObject({
      status: "failed",
      failure: { kind: "unknown" },
      attempts: 1,
    });
    expect(send).toHaveBeenCalledOnce();

    const retryingSend = vi.fn(async () => failed("network"));
    let recoveryLookups = 0;
    const throwingRecovery = vi.fn(async (): Promise<Task | undefined> => {
      if (++recoveryLookups === 1) return undefined;
      throw new Error("durable lookup failed");
    });
    await expect(recoverA2ASendMessage({
      request: request("unknown-recovery"),
      send: retryingSend,
      recoverTask: throwingRecovery,
      maxAttempts: 3,
      deadlineMs: 1_000,
      retryDelayMs: 0,
    })).resolves.toMatchObject({
      status: "failed",
      failure: { kind: "unknown" },
      attempts: 1,
    });
    expect(retryingSend).toHaveBeenCalledOnce();
  });

  it("recovers a durably committed task after the response is lost without resending", async () => {
    const send = vi.fn(async () => failed("network"));
    let lostLookups = 0;
    const recoverTask = vi.fn(async (): Promise<Task | undefined> => (
      ++lostLookups === 1 ? undefined : completedTask
    ));

    const outcome = await recoverA2ASendMessage({
      request: request("lost-response"),
      send,
      recoverTask,
      maxAttempts: 3,
      deadlineMs: 1_000,
      retryDelayMs: 0,
    });

    expect(outcome).toMatchObject({
      status: "ok",
      task: completedTask,
      attempts: 1,
      origin: "recovery",
    });
    expect(send).toHaveBeenCalledOnce();
    expect(recoverTask).toHaveBeenCalledTimes(2);
  });

  it("stops at the explicit send bound when no durable task exists", async () => {
    const send = vi.fn(async () => failed("network"));

    const outcome = await recoverA2ASendMessage({
      request: request("exhausted"),
      send,
      recoverTask: async () => undefined,
      maxAttempts: 2,
      deadlineMs: 1_000,
      retryDelayMs: 0,
    });

    expect(outcome).toMatchObject({ status: "failed", attempts: 2, failure: { kind: "network" } });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not start after caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn(async () => failed("network"));

    const outcome = await recoverA2ASendMessage({
      request: request("canceled"),
      send,
      recoverTask: async () => undefined,
      maxAttempts: 3,
      deadlineMs: 1_000,
      retryDelayMs: 0,
      signal: controller.signal,
    });

    expect(outcome).toEqual({ status: "canceled", attempts: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
