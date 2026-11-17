import { TaskState, type Message, type SendMessageRequest, type Task } from "@a2a-js/sdk";

import type { PeerFailure, PeerOutcome } from "./client";

export type A2ASendRecoveryOutcome =
  | { status: "ok"; task: Task; attempts: number; origin: "send" | "recovery" }
  | { status: "failed"; failure: PeerFailure; attempts: number }
  | { status: "canceled"; attempts: number };

export interface RecoverA2ASendMessageOptions {
  request: SendMessageRequest;
  send: (
    request: SendMessageRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<PeerOutcome<Message | Task>>;
  recoverTask: (
    request: SendMessageRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<Task | undefined>;
  maxAttempts: number;
  deadlineMs: number;
  retryDelayMs?: number;
  retryDelayMultiplier?: number;
  maxRetryDelayMs?: number;
  signal?: AbortSignal;
}

const TERMINAL_TASK_STATES = new Set<TaskState>([
  TaskState.TASK_STATE_COMPLETED,
  TaskState.TASK_STATE_FAILED,
  TaskState.TASK_STATE_CANCELED,
  TaskState.TASK_STATE_REJECTED,
]);

class RecoveryDeadline {
  readonly controller = new AbortController();
  readonly signal: AbortSignal;
  #timer: ReturnType<typeof setTimeout>;
  #timedOut = false;

  constructor(deadlineMs: number, external?: AbortSignal) {
    this.signal = external ? AbortSignal.any([external, this.controller.signal]) : this.controller.signal;
    if (external?.aborted) this.controller.abort();
    this.#timer = setTimeout(() => {
      this.#timedOut = true;
      this.controller.abort();
    }, deadlineMs);
    this.#timer.unref?.();
  }

  get timedOut() {
    return this.#timedOut;
  }

  cleanup() {
    clearTimeout(this.#timer);
  }
}

function operationAborted(): DOMException {
  return new DOMException("The A2A recovery operation was aborted", "AbortError");
}

async function withDeadline<T>(promise: Promise<T>, deadline: RecoveryDeadline): Promise<T> {
  if (deadline.signal.aborted) {
    void promise.catch(() => undefined);
    throw operationAborted();
  }
  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => deadline.signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(operationAborted());
    };
    deadline.signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        if (deadline.signal.aborted) reject(operationAborted());
        else resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function transient(failure: PeerFailure): boolean {
  return failure.kind === "network" || failure.kind === "timeout";
}

function delayForAttempt(options: RecoverA2ASendMessageOptions, attempt: number): number {
  const initial = options.retryDelayMs ?? 0;
  const multiplier = options.retryDelayMultiplier ?? 1;
  const max = options.maxRetryDelayMs ?? initial;
  if (
    !Number.isFinite(initial) || initial < 0
    || !Number.isFinite(multiplier) || multiplier < 1
    || !Number.isFinite(max) || max < initial
  ) {
    throw new Error("Invalid A2A recovery backoff policy");
  }
  return Math.min(max, Math.floor(initial * multiplier ** Math.max(0, attempt - 1)));
}

function pollDelayForAttempt(
  options: RecoverA2ASendMessageOptions,
  attempt: number,
  deadlineAt: number,
): number {
  const configured = Math.max(1, delayForAttempt(options, attempt));
  const remaining = deadlineAt - Date.now();
  return Math.max(1, Math.min(configured, remaining));
}

function abortDelay(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("The A2A operation was aborted", "AbortError"));
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The A2A operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Opt-in idempotent recovery for a strict one-shot A2A client.
 * A retry uses the exact request object and identity. After an ambiguous
 * transient failure, the durable task is consulted before any resend.
 */
export async function recoverA2ASendMessage(
  options: RecoverA2ASendMessageOptions,
): Promise<A2ASendRecoveryOutcome> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new Error("A2A recovery maxAttempts must be a positive integer");
  }
  if (!Number.isInteger(options.deadlineMs) || options.deadlineMs < 1) {
    throw new Error("A2A recovery deadlineMs must be a positive integer");
  }
  const deadlineAt = Date.now() + options.deadlineMs;
  let attempts = 0;
  let lastFailure: PeerFailure = { kind: "unknown", message: "A2A peer call failed" };
  const signal = options.signal;
  const deadline = new RecoveryDeadline(options.deadlineMs, signal);
  const timeoutFailure = (): PeerFailure => ({
    kind: "timeout",
    message: deadline.timedOut
      ? "A2A send recovery exceeded its deadline"
      : "The A2A recovery operation was aborted by its deadline",
  });

  const lookupTask = async (): Promise<Task | undefined | "canceled" | "timeout" | "unknown"> => {
    try {
      return await withDeadline(
        options.recoverTask(options.request, { signal: deadline.signal }),
        deadline,
      );
    } catch {
      if (signal?.aborted) return "canceled";
      if (deadline.signal.aborted) return "timeout";
      return "unknown";
    }
  };

  const pollExistingTask = async (): Promise<
    { status: "ok"; task: Task } | { status: "failed"; failure: PeerFailure } | { status: "canceled" }
  > => {
    while (Date.now() < deadlineAt) {
      try {
        await abortDelay(deadline.signal, pollDelayForAttempt(options, attempts, deadlineAt));
      } catch {
        return signal?.aborted
          ? { status: "canceled" }
          : { status: "failed", failure: timeoutFailure() };
      }
      const polled = await lookupTask();
      if (polled === "canceled") return { status: "canceled" };
      if (polled === "timeout") return { status: "failed", failure: timeoutFailure() };
      if (polled === undefined || polled === "unknown") {
        return {
          status: "failed",
          failure: polled === undefined
            ? { kind: "unknown", message: "A2A durable task disappeared during recovery" }
            : { kind: "unknown", message: "A2A task recovery failed" },
        };
      }
      if (polled.status?.state !== undefined && TERMINAL_TASK_STATES.has(polled.status.state)) {
        return { status: "ok", task: polled };
      }
    }
    return { status: "failed", failure: timeoutFailure() };
  };

  try {
    // A ledger-visible task owns the request identity before this client can
    // reserve another one. This also covers a business task already running.
    const existing = await lookupTask();
    if (existing === "canceled") return { status: "canceled", attempts };
    if (existing === "timeout") return { status: "failed", attempts, failure: timeoutFailure() };
    if (existing === "unknown") {
      return {
        status: "failed",
        attempts,
        failure: { kind: "unknown", message: "A2A task recovery failed" },
      };
    }
    if (existing) {
      if (existing.status?.state !== undefined && TERMINAL_TASK_STATES.has(existing.status.state)) {
        return { status: "ok", task: existing, attempts, origin: "recovery" };
      }
      const polled = await pollExistingTask();
      if (polled.status === "canceled") return { status: "canceled", attempts };
      if (polled.status === "failed") return { status: "failed", attempts, failure: polled.failure };
      return { status: "ok", task: polled.task, attempts, origin: "recovery" };
    }

    while (attempts < options.maxAttempts) {
      if (deadline.signal.aborted) {
        return signal?.aborted
          ? { status: "canceled", attempts }
          : { status: "failed", attempts, failure: timeoutFailure() };
      }
      attempts++;
      let outcome: Awaited<ReturnType<RecoverA2ASendMessageOptions["send"]>>;
      try {
        outcome = await withDeadline(
          options.send(options.request, { signal: deadline.signal }),
          deadline,
        );
      } catch {
        if (signal?.aborted) return { status: "canceled", attempts };
        if (deadline.signal.aborted) return { status: "failed", attempts, failure: timeoutFailure() };
        return {
          status: "failed",
          attempts,
          failure: { kind: "unknown", message: "A2A peer send threw an unclassified failure" },
        };
      }

      if (signal?.aborted) return { status: "canceled", attempts };
      if (outcome.status === "canceled") return { status: "canceled", attempts };
      if (outcome.status === "ok") {
        if ("messageId" in outcome.value) {
          return {
            status: "failed",
            attempts,
            failure: { kind: "protocol", message: "A2A peer returned a message where a durable task is required" },
          };
        }
        if (outcome.value.status?.state !== undefined && TERMINAL_TASK_STATES.has(outcome.value.status.state)) {
          return { status: "ok", task: outcome.value, attempts, origin: "send" };
        }
        // A successful WORKING/SUBMITTED response still owns the task. Poll
        // that exact durable identity rather than issuing another send.
        const polled = await pollExistingTask();
        if (polled.status === "canceled") return { status: "canceled", attempts };
        if (polled.status === "failed") return { status: "failed", attempts, failure: polled.failure };
        return { status: "ok", task: polled.task, attempts, origin: "send" };
      }

      lastFailure = outcome.failure;
      if (!transient(lastFailure)) return { status: "failed", failure: lastFailure, attempts };

      const recovered = await lookupTask();
      if (recovered === "canceled") return { status: "canceled", attempts };
      if (recovered === "timeout") return { status: "failed", attempts, failure: timeoutFailure() };
      if (recovered === "unknown") {
        return {
          status: "failed",
          attempts,
          failure: { kind: "unknown", message: "A2A task recovery failed" },
        };
      }
      if (recovered) {
        if (recovered.status?.state !== undefined && TERMINAL_TASK_STATES.has(recovered.status.state)) {
          return { status: "ok", task: recovered, attempts, origin: "recovery" };
        }
        const polled = await pollExistingTask();
        if (polled.status === "canceled") return { status: "canceled", attempts };
        if (polled.status === "failed") return { status: "failed", attempts, failure: polled.failure };
        return { status: "ok", task: polled.task, attempts, origin: "recovery" };
      }

      if (attempts >= options.maxAttempts || Date.now() >= deadlineAt) break;
      try {
        await abortDelay(deadline.signal, delayForAttempt(options, attempts));
      } catch {
        return signal?.aborted
          ? { status: "canceled", attempts }
          : { status: "failed", attempts, failure: timeoutFailure() };
      }
    }
    return {
      status: "failed",
      attempts,
      failure: deadline.signal.aborted ? timeoutFailure() : lastFailure,
    };
  } finally {
    deadline.cleanup();
  }
}
