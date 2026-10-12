import { z } from "zod";
import { A2UI_EVENT, applyA2ui, type Surfaces } from "./a2ui";

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

export type RunProgress = { text: string; surfaces: Surfaces; step: string };
const eventSchema = z.object({
  type: z.string(),
  messageId: z.string().optional(),
  delta: z.string().optional(),
  stepName: z.string().optional(),
  name: z.string().optional(),
  value: z.unknown().optional(),
  message: z.string().optional(),
  runId: z.string().optional(),
  threadId: z.string().optional(),
});
export function createRunReader(
  runId: string,
  onProgress?: (progress: RunProgress) => void,
) {
  let started = false;
  let finished = false;
  let textMessage: string | undefined;
  let count = 0;
  let progress: RunProgress = {
    text: "",
    surfaces: {},
    step: "阿 Q +正在想一想…",
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
      if (event.type === "RUN_ERROR")
        throw new Error(event.message || "本轮生成失败");
      if (event.type === "STEP_STARTED")
        progress = { ...progress, step: event.stepName || progress.step };
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
          surfaces: applyA2ui(progress.surfaces, event.value),
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
