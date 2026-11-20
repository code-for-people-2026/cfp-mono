export type A2AExecutionRetryDisposition =
  | "retry_scheduled"
  | "retry_exhausted"
  | "nonretryable"
  | "canceled";

export interface A2AExecutionRetryFailure<TDiagnostic> {
  disposition: A2AExecutionRetryDisposition;
  attempt: number;
  diagnostic: TDiagnostic;
}

export interface A2AExecutionRetryClassification<TDiagnostic> {
  retryable: boolean;
  canceled: boolean;
  diagnostic: TDiagnostic;
}

export interface RetryA2AExecutionOptions<T, TDiagnostic> {
  execute: (attempt: number) => Promise<T>;
  classify: (error: unknown, attempt: number) => A2AExecutionRetryClassification<TDiagnostic>;
  onFailure: (failure: A2AExecutionRetryFailure<TDiagnostic>) => void;
  maxAttempts: number;
  signal: AbortSignal;
  retryDelayMs?: number;
}

export type A2AExecutionRetryOutcome<T> =
  | { status: "completed"; value: T; attempt: number }
  | { status: "failed"; failure: { disposition: A2AExecutionRetryDisposition; attempt: number } }
  | { status: "canceled" };

function abortDelay(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("The A2A execution retry was aborted", "AbortError"));
  }
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("The A2A execution retry was aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Runs bounded business execution retries inside one already-owned A2A task.
 * The caller owns error classification and diagnostic sanitization; this helper
 * only enforces the fixed attempt count, cancellation, and bounded delay.
 */
export async function retryA2AExecution<T, TDiagnostic>(
  options: RetryA2AExecutionOptions<T, TDiagnostic>,
): Promise<A2AExecutionRetryOutcome<T>> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new Error("A2A execution retry maxAttempts must be a positive integer");
  }
  const retryDelayMs = options.retryDelayMs ?? 0;
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 1_000) {
    throw new Error("A2A execution retry delay must be between 0 and 1000ms");
  }

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    if (options.signal.aborted) return { status: "canceled" };
    try {
      const value = await options.execute(attempt);
      options.signal.throwIfAborted();
      return { status: "completed", value, attempt };
    } catch (error) {
      if (options.signal.aborted) {
        options.onFailure({
          disposition: "canceled",
          attempt,
          diagnostic: options.classify(error, attempt).diagnostic,
        });
        return { status: "canceled" };
      }
      const classification = options.classify(error, attempt);
      if (classification.canceled) {
        options.onFailure({ disposition: "canceled", attempt, diagnostic: classification.diagnostic });
        return { status: "canceled" };
      }
      const disposition = classification.retryable && attempt < options.maxAttempts
        ? "retry_scheduled"
        : classification.retryable
          ? "retry_exhausted"
          : "nonretryable";
      options.onFailure({ disposition, attempt, diagnostic: classification.diagnostic });
      if (disposition !== "retry_scheduled") {
        return { status: "failed", failure: { disposition, attempt } };
      }
      try {
        await abortDelay(options.signal, retryDelayMs);
      } catch {
        return { status: "canceled" };
      }
    }
  }

  throw new Error("A2A execution retry loop exited before reaching a disposition");
}
