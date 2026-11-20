import type { ExpertExecutionDiagnostic } from "@cfp/a-j-oker-contracts";
import { DeepSeekError } from "../models/deepseek";

export const EXPERT_EXECUTION_MAX_ATTEMPTS = 3;

type ExpertExecutionErrorKind = ExpertExecutionDiagnostic["errorKind"];
type ExpertExecutionSafeCause = ExpertExecutionDiagnostic["cause"];

export class ExpertExecutionError extends Error {
  constructor(
    readonly expertKind: ExpertExecutionErrorKind,
    readonly retryable: boolean,
    readonly safeStatus?: number,
    readonly safeCode?: string,
    readonly safeCause: ExpertExecutionSafeCause = "unknown",
  ) {
    super("Expert execution failed");
  }
}

interface ExpertExecutionClassification {
  retryable: boolean;
  canceled: boolean;
  diagnostic: Omit<ExpertExecutionDiagnostic, "disposition">;
}

function safeErrorName(error: unknown): ExpertExecutionDiagnostic["errorName"] {
  const name = (error as { constructor?: { name?: unknown } } | null | undefined)
    ?.constructor?.name;
  switch (name) {
    case "DeepSeekError":
    case "ZodError":
    case "AbortError":
    case "TimeoutError":
      return name;
    default:
      return "Error";
  }
}

function safeTransportCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("diagnostic" in error)) return undefined;
  const diagnostic = (error as { diagnostic?: { transportCode?: unknown; transportName?: unknown } }).diagnostic;
  const code = diagnostic?.transportCode ?? diagnostic?.transportName;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : undefined;
}

function responseCause(error: DeepSeekError): ExpertExecutionSafeCause {
  switch (error.diagnostic.responseStage) {
    case "response_json":
      return "response_json";
    case "response_schema":
      return "response_schema";
    case "envelope":
      return "response_envelope";
    default:
      return "response_schema";
  }
}

function classifyDeepSeek(
  error: DeepSeekError,
): {
  retryable: boolean;
  expertKind: ExpertExecutionErrorKind;
  safeCause: ExpertExecutionSafeCause;
} {
  if (error.kind === "credential") {
    return { retryable: false, expertKind: "auth", safeCause: "credential" };
  }
  if (error.kind === "transport") {
    return {
      retryable: true,
      expertKind: "provider_network",
      safeCause: error.diagnostic.timeout ? "timeout" : "network",
    };
  }
  if (error.kind === "response") {
    return {
      retryable: true,
      expertKind: "provider_response",
      safeCause: responseCause(error),
    };
  }
  const status = error.status ?? 0;
  return {
    retryable: status === 408 || status === 429 || status >= 500,
    expertKind: "provider_http",
    safeCause: "http_status",
  };
}

export function classifyExpertExecutionError(input: {
  error: unknown;
  signal: AbortSignal;
  executionId: string;
  taskId: string;
  expertId: ExpertExecutionDiagnostic["expertId"];
  attempt: number;
  phase?: ExpertExecutionDiagnostic["phase"];
}): ExpertExecutionClassification {
  const { error, signal } = input;
  const base = {
    executionId: input.executionId,
    taskId: input.taskId,
    expertId: input.expertId,
    attempt: input.attempt,
    phase: input.phase ?? "execution",
  };
  if (signal.aborted || error instanceof DOMException && error.name === "AbortError") {
    return {
      retryable: false,
      canceled: true,
      diagnostic: {
        ...base,
        phase: "terminal",
        errorKind: "cancel",
        errorName: safeErrorName(error),
        cause: "canceled",
      },
    };
  }

  if (error instanceof ExpertExecutionError) {
    return {
      retryable: error.retryable,
      canceled: false,
      diagnostic: {
        ...base,
        errorKind: error.expertKind,
        errorName: "Error",
        ...(error.safeStatus === undefined ? {} : { status: error.safeStatus }),
        ...(error.safeCode === undefined ? {} : { code: error.safeCode }),
        cause: error.safeCause,
      },
    };
  }

  if (error instanceof DeepSeekError) {
    const classification = classifyDeepSeek(error);
    return {
      retryable: classification.retryable,
      canceled: false,
      diagnostic: {
        ...base,
        errorKind: classification.expertKind,
        errorName: "DeepSeekError",
        ...(error.status === undefined ? {} : { status: error.status }),
        ...(safeTransportCode(error) === undefined ? {} : { code: safeTransportCode(error) }),
        cause: classification.safeCause,
      },
    };
  }

  if (error instanceof Error) {
    if (error.message === "Specialist did not submit a plan") {
      return {
        retryable: true,
        canceled: false,
        diagnostic: {
          ...base,
          phase: "validation",
          errorKind: "no_submission",
          errorName: safeErrorName(error),
          cause: "no_submission",
        },
      };
    }
    if (error.message === "Psychology specialist returned another approach") {
      return {
        retryable: true,
        canceled: false,
        diagnostic: {
          ...base,
          phase: "validation",
          errorKind: "plan_validation",
          errorName: safeErrorName(error),
          cause: "approach_mismatch",
        },
      };
    }
    if (error.name === "ZodError" || error.constructor.name === "ZodError") {
      return {
        retryable: true,
        canceled: false,
        diagnostic: {
          ...base,
          phase: "validation",
          errorKind: "plan_validation",
          errorName: "ZodError",
          cause: "plan_schema",
        },
      };
    }
    if (error.message === "Specialist execution failed") {
      return {
        retryable: true,
        canceled: false,
        diagnostic: {
          ...base,
          errorKind: "provider_response",
          errorName: safeErrorName(error),
          cause: "response_schema",
        },
      };
    }
  }

  return {
    retryable: false,
    canceled: false,
    diagnostic: {
      ...base,
      errorKind: "unknown",
      errorName: safeErrorName(error),
      cause: "unknown",
    },
  };
}

export function withDisposition(
  diagnostic: Omit<ExpertExecutionDiagnostic, "disposition">,
  disposition: ExpertExecutionDiagnostic["disposition"],
): ExpertExecutionDiagnostic {
  return { ...diagnostic, disposition };
}
