import Taro from "@tarojs/taro";
export type PersistedSubmissionFailure = {
  requestId: string;
  message: string;
  code?: string;
  retryable?: boolean;
  definitive?: boolean;
  occurredAt: number;
};

const keyFor = (sessionId: number) =>
  `hello-submission-failure:${HELLO_API_ORIGIN}:${sessionId}`;

function safeCode(value: unknown) {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)
    ? value
    : undefined;
}

export function rememberSubmissionFailure(
  sessionId: number,
  requestId: string,
  error: unknown,
) {
  // Never persist the submitted text, media ids, URL, headers, or a raw
  // provider/transport exception. Only the safe public error envelope remains.
  if (!(error instanceof Error)) return;
  const source = error as Error & {
    code?: unknown;
    retryable?: unknown;
    definitive?: unknown;
  };
  if (typeof source.message !== "string") return;
  const code = safeCode(source.code);
  const retryable = source.retryable;
  const definitive = source.definitive;
  if (!code) return;
  const record: PersistedSubmissionFailure = {
    requestId,
    message: source.message.slice(0, 300),
    ...(code ? { code } : {}),
    ...(typeof retryable === "boolean" ? { retryable } : {}),
    ...(typeof definitive === "boolean" ? { definitive } : {}),
    occurredAt: Date.now(),
  };
  try {
    Taro.setStorageSync(keyFor(sessionId), record);
  } catch {
    // Showing the current error is still more important than durable recall.
  }
}

export function readSubmissionFailure(
  sessionId: number,
): PersistedSubmissionFailure | undefined {
  try {
    const value = Taro.getStorageSync<PersistedSubmissionFailure>(
      keyFor(sessionId),
    );
    if (!value || typeof value !== "object") return undefined;
    if (
      typeof value.requestId !== "string" ||
      typeof value.message !== "string" ||
      typeof value.occurredAt !== "number"
    )
      return undefined;
    return {
      requestId: value.requestId,
      message: value.message.slice(0, 300),
      ...(safeCode(value.code) ? { code: safeCode(value.code) } : {}),
      ...(typeof value.retryable === "boolean" ? { retryable: value.retryable } : {}),
      ...(typeof value.definitive === "boolean" ? { definitive: value.definitive } : {}),
      occurredAt: value.occurredAt,
    };
  } catch {
    return undefined;
  }
}

export function clearSubmissionFailure(sessionId: number) {
  try {
    Taro.removeStorageSync(keyFor(sessionId));
  } catch {
    // Storage cleanup is best-effort.
  }
}
