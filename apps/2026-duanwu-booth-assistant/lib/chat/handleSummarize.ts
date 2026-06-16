import { callDeepSeek, type DeepSeekMessage } from "@/lib/deepseek/client";
import { summarizeRateLimiter } from "@/lib/rateLimit";
import { summarizeRequestSchema } from "@/lib/validation";
import { buildSummaryPrompt } from "./buildChatPrompt";

type HandleSummarizeInput = {
  body: unknown;
  ip: string;
  now?: number;
  callModel?: typeof callDeepSeek;
};

export async function handleSummarize(input: HandleSummarizeInput) {
  const limit = summarizeRateLimiter.check(input.ip, input.now);
  if (!limit.allowed) {
    return Response.json({ error: "请求有点太频繁了，可以稍等一下再试。" }, { status: 429 });
  }

  const parsed = summarizeRequestSchema.safeParse(input.body);
  if (!parsed.success) {
    return Response.json({ error: "摘要内容太长或格式不对。" }, { status: 400 });
  }

  const prompt = [
    parsed.data.previousSummary ? `已有摘要：${parsed.data.previousSummary}` : "已有摘要：无",
    buildSummaryPrompt(parsed.data.messages),
  ].join("\n\n");

  const messages: DeepSeekMessage[] = [
    { role: "system", content: prompt },
    { role: "user", content: "请生成更新后的对话摘要。" },
  ];

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 12_000);
    const summary = await (input.callModel ?? callDeepSeek)({
      messages,
      maxTokens: 300,
      signal: controller.signal,
    });

    return Response.json({ summary });
  } catch {
    return Response.json({ error: "摘要生成失败，本轮对话仍可继续。" }, { status: 502 });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
