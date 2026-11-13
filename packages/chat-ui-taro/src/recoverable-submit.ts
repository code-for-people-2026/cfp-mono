export type RecoverableSubmissionStatus =
  | "completed"
  | "running"
  | "failed"
  | "missing";

export interface RecoverableSubmission<
  TScope extends string | number,
  TRequest,
> {
  scope: TScope;
  requestId: string;
  request: TRequest;
}

export interface RecoverableSubmitConfig<
  TScope extends string | number,
  TRequest,
  TResult,
> {
  createRequestId(): string;
  fingerprint(request: TRequest): string;
  lookup(submission: RecoverableSubmission<TScope, TRequest>): Promise<
    TResult | undefined
  >;
  classify(result: TResult | undefined): RecoverableSubmissionStatus;
  send(submission: RecoverableSubmission<TScope, TRequest>): Promise<TResult>;
}

export type RecoverableSubmitOutcome<TResult> =
  | { type: "completed"; result: TResult; recovered: boolean }
  | {
      type: "failed";
      error?: unknown;
      confirmedFailed: boolean;
      running: boolean;
    }
  | { type: "busy" }
  | { type: "missing" }
  | { type: "stale" };

export type RecoverableCheckOutcome<TResult> =
  | { type: "completed"; result: TResult }
  | { type: "failed" }
  | { type: "running" }
  | { type: "missing" }
  | { type: "error"; error: unknown }
  | { type: "stale" };

interface StoredSubmission<TScope extends string | number, TRequest>
  extends RecoverableSubmission<TScope, TRequest> {
  fingerprint: string;
}

interface Inspection<TResult> {
  status: RecoverableSubmissionStatus;
  result?: TResult;
}

interface Operation<TScope extends string | number> {
  epoch: number;
  scope: TScope;
}

export function createRecoverableSubmitController<
  TScope extends string | number,
  TRequest,
  TResult,
>(config: RecoverableSubmitConfig<TScope, TRequest, TResult>) {
  const pending = new Map<TScope, StoredSubmission<TScope, TRequest>>();
  let activeOperation: Operation<TScope> | undefined;
  let epoch = 0;

  const isCurrent = (operation: Operation<TScope>) =>
    activeOperation === operation && operation.epoch === epoch;

  const inspect = async (
    submission: RecoverableSubmission<TScope, TRequest>,
  ): Promise<Inspection<TResult>> => {
    const result = await config.lookup(submission);
    return { status: config.classify(result), result };
  };
  const safeInspect = async (
    submission: RecoverableSubmission<TScope, TRequest>,
  ): Promise<Inspection<TResult>> => {
    try {
      return await inspect(submission);
    } catch {
      // A failed recovery query is unknown, not an authoritative failure.
      return { status: "missing" };
    }
  };
  const completed = (
    operation: Operation<TScope>,
    result: TResult,
    recovered: boolean,
  ): RecoverableSubmitOutcome<TResult> => {
    if (!isCurrent(operation)) return { type: "stale" };
    pending.delete(operation.scope);
    return { type: "completed", result, recovered };
  };
  const failed = (
    error: unknown,
    status: RecoverableSubmissionStatus,
  ): RecoverableSubmitOutcome<TResult> => ({
    type: "failed",
    error,
    confirmedFailed: status === "failed",
    running: status === "running",
  });
  const recover = async (
    submission: StoredSubmission<TScope, TRequest>,
    error: unknown,
    operation: Operation<TScope>,
  ): Promise<RecoverableSubmitOutcome<TResult>> => {
    const inspection = await safeInspect(submission);
    if (!isCurrent(operation)) return { type: "stale" };
    if (inspection.status === "completed" && inspection.result !== undefined)
      return completed(operation, inspection.result, true);
    if (inspection.status === "failed")
      pending.delete(submission.scope);
    return failed(error, inspection.status);
  };

  return {
    hasPending(scope?: TScope) {
      return scope === undefined ? pending.size > 0 : pending.has(scope);
    },
    pendingFor(scope: TScope): RecoverableSubmission<TScope, TRequest> | undefined {
      const current = pending.get(scope);
      if (!current) return undefined;
      return {
        scope: current.scope,
        requestId: current.requestId,
        request: current.request,
      };
    },
    reset() {
      epoch++;
      pending.clear();
      // Detach unresolved operations from the new identity scope. Their late
      // results and lock releases cannot affect a newer operation.
      activeOperation = undefined;
    },
    async submit(
      scope: TScope,
      request: TRequest,
    ): Promise<RecoverableSubmitOutcome<TResult>> {
      if (activeOperation) return { type: "busy" };
      const operation: Operation<TScope> = { epoch, scope };
      activeOperation = operation;
      try {
        let submission = pending.get(scope);
        if (submission && submission.fingerprint !== config.fingerprint(request))
          submission = undefined;
        if (submission) {
          let inspection: Inspection<TResult>;
          try {
            inspection = await inspect(submission);
          } catch (error) {
            const recovery = await recover(submission, error, operation);
            if (recovery.type === "failed" && recovery.confirmedFailed)
              pending.delete(scope);
            return recovery;
          }
          if (!isCurrent(operation)) return { type: "stale" };
          if (inspection.status === "completed" && inspection.result !== undefined)
            return completed(operation, inspection.result, true);
          if (inspection.status === "running")
            return failed(undefined, inspection.status);
          // Only an explicit failed status may retire an ambiguous request id.
          if (inspection.status === "failed") {
            pending.delete(scope);
            submission = undefined;
          }
        }

        submission = {
          scope,
          requestId: submission?.requestId || config.createRequestId(),
          request,
          fingerprint: config.fingerprint(request),
        };
        pending.set(scope, submission);
        try {
          const result = await config.send(submission);
          if (!isCurrent(operation)) return { type: "stale" };
          const status = config.classify(result);
          if (status === "completed") return completed(operation, result, false);
          if (status === "failed") pending.delete(scope);
          return failed(undefined, status);
        } catch (error) {
          if (!isCurrent(operation)) return { type: "stale" };
          return await recover(submission, error, operation);
        }
      } finally {
        if (activeOperation === operation) activeOperation = undefined;
      }
    },
    async check(scope: TScope): Promise<RecoverableCheckOutcome<TResult>> {
      if (activeOperation) return { type: "running" };
      const submission = pending.get(scope);
      if (!submission) return { type: "missing" };
      const operation: Operation<TScope> = { epoch, scope };
      activeOperation = operation;
      try {
        const inspection = await inspect(submission);
        if (!isCurrent(operation)) return { type: "stale" };
        if (inspection.status === "completed" && inspection.result !== undefined) {
          pending.delete(scope);
          return { type: "completed", result: inspection.result };
        }
        if (inspection.status === "failed") {
          pending.delete(scope);
          return { type: "failed" };
        }
        if (inspection.status === "running") return { type: "running" };
        return { type: "missing" };
      } catch (error) {
        if (!isCurrent(operation)) return { type: "stale" };
        return { type: "error", error };
      } finally {
        if (activeOperation === operation) activeOperation = undefined;
      }
    },
  };
}

export type RecoverableSubmitController<
  TScope extends string | number,
  TRequest,
  TResult,
> = ReturnType<
  typeof createRecoverableSubmitController<TScope, TRequest, TResult>
>;
