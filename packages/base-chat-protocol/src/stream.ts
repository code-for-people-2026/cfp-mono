import { z } from "zod";
import { A2UI_EVENT, validateA2uiMessages, type A2uiMessage } from "./a2ui";

// SSE framing is independent of the browser's UTF-8 decoder and works with buffered native responses.
export function createSseDecoder(onEvent: (event: unknown) => void) {
  let buffer = "";
  function drain() {
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) onEvent(JSON.parse(data));
    }
  }
  return {
    push(chunk: string) {
      buffer += chunk;
      if (buffer.length > 256_000) throw new Error("回复数据过大");
      drain();
    },
    finish() {
      drain();
      if (buffer.trim()) throw new Error("回复传输中断，请刷新记录");
    },
  };
}

export const textResponseSchema = z.string();

export type RunProgress = {
  text: string;
  messages: A2uiMessage[];
  step: string;
  // Generic stable stage identifier (for example a producer's lifecycle step).
  // Absent for older producers; hosts decide all human-readable wording.
  stageId?: string;
  // An optional committed producer message shown before the final answer. It
  // has its own stable identity so a host can deduplicate transport replays
  // without confusing it with streamed final text.
  interimMessage?: RunInterimMessage;
};
export type RunInterimMessage = {
  id: string;
  text: string;
};
export interface RunReaderOptions {
  catalogIds?: readonly string[];
  initialStep?: string;
}

const stageIdentifierSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "进度阶段标识格式不正确");

const interimMessageSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,79}$/, "过渡消息标识格式不正确"),
  text: z.string().trim().min(1).max(500),
});

function stageIdFromMetadata(metadata: unknown) {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const value = "stageId" in metadata ? metadata.stageId : undefined;
  if (typeof value !== "string") return undefined;
  const stageId = stageIdentifierSchema.safeParse(value, { jitless: true });
  return stageId.success ? stageId.data : undefined;
}

function interimMessageFromMetadata(metadata: unknown) {
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const value = "interimMessage" in metadata
    ? metadata.interimMessage
    : undefined;
  const message = interimMessageSchema.safeParse(value, { jitless: true });
  return message.success ? message.data : undefined;
}

const eventSchema = z.object({
  type: z.string(),
  messageId: z.string().optional(),
  delta: z.string().optional(),
  stepName: z.string().optional(),
  name: z.string().optional(),
  value: z.unknown().optional(),
  message: z.string().optional(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  runId: z.string().optional(),
  threadId: z.string().optional(),
});

export class RunProtocolError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly retryable?: boolean,
    readonly definitive?: boolean,
  ) {
    super(message);
  }
}

function errorMetadata(metadata: unknown) {
  if (typeof metadata !== "object" || metadata === null) return {};
  const retryable = "retryable" in metadata ? metadata.retryable : undefined;
  const definitive = "definitive" in metadata ? metadata.definitive : undefined;
  return {
    ...(typeof retryable === "boolean" ? { retryable } : {}),
    ...(typeof definitive === "boolean" ? { definitive } : {}),
  };
}

export function createRunReader(
  runId: string,
  onProgress?: (progress: RunProgress) => void,
  options: RunReaderOptions = {},
) {
  let started = false;
  let finished = false;
  let textMessage: string | undefined;
  let count = 0;
  let progress: RunProgress = {
    text: "",
    messages: [],
    step: options.initialStep ?? "Working…",
  };
  const decoder = createSseDecoder((value) => {
    const event = eventSchema.parse(value, { jitless: true });
    if (++count > 128 || finished) throw new Error("回复事件顺序不正确");
    if (event.type === "RUN_STARTED") {
      if (started || event.runId !== runId)
        throw new Error("回复与本轮请求不匹配");
      started = true;
    } else {
      if (!started) throw new Error("回复尚未开始");
      if (event.type === "RUN_ERROR") {
        const failureMetadata = errorMetadata(event.metadata);
        throw new RunProtocolError(
          event.message || "本轮生成失败",
          event.code,
          failureMetadata.retryable,
          failureMetadata.definitive,
        );
      }
      if (event.type === "STEP_STARTED") {
        const stageId = stageIdFromMetadata(event.metadata);
        const interimMessage = interimMessageFromMetadata(event.metadata);
        const progressWithoutStage = { ...progress };
        delete progressWithoutStage.stageId;
        // A stage without an interim message keeps an already committed
        // preamble visible while the same run continues.
        progress = {
          ...progressWithoutStage,
          step: event.stepName || progress.step,
          ...(stageId ? { stageId } : {}),
          ...(interimMessage
            ? { interimMessage }
            : progressWithoutStage.interimMessage
              ? { interimMessage: progressWithoutStage.interimMessage }
              : {}),
        };
      }
      if (event.type === "TEXT_MESSAGE_START") textMessage = event.messageId;
      if (event.type === "TEXT_MESSAGE_CONTENT") {
        if (!textMessage || event.messageId !== textMessage || !event.delta)
          throw new Error("回复文字格式不正确");
        if (progress.text.length + event.delta.length > 4000)
          throw new Error("回复文字过长");
        progress = { ...progress, text: progress.text + event.delta };
      }
      if (event.type === "TEXT_MESSAGE_END") {
        if (!textMessage || event.messageId !== textMessage)
          throw new Error("回复文字未正确结束");
        textMessage = undefined;
      }
      if (event.type === "CUSTOM" && event.name === A2UI_EVENT)
        progress = {
          ...progress,
          messages: validateA2uiMessages(
            [...progress.messages, event.value],
            options,
          ),
        };
      if (event.type === "RUN_FINISHED") {
        if (event.runId !== runId || textMessage)
          throw new Error("回复未正确结束");
        finished = true;
      }
    }
    onProgress?.(progress);
  });
  return {
    push: decoder.push,
    finish() {
      decoder.finish();
      if (!finished) throw new Error("回复传输中断，请刷新记录后重试");
      return progress;
    },
  };
}
