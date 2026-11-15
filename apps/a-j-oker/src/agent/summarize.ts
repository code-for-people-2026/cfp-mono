import { completeDeepSeek, DEFAULT_MODEL } from "../models/deepseek";
import { summarySchema, type MemoryTurn } from "../domain/context-policy";
import { SUMMARY_INSTRUCTION } from "./summary-instruction";

export type Summarizer = (request: {
  summary: string;
  turns: MemoryTurn[];
  apiKey: string;
}) => Promise<string>;
export const summarizeContext: Summarizer = async ({
  summary,
  turns,
  apiKey,
}) => {
  const response = await completeDeepSeek(
    {
      model: process.env.HELLO_MODEL || DEFAULT_MODEL,
      messages: [
        { role: "system", content: SUMMARY_INSTRUCTION },
        {
          role: "user",
          content: JSON.stringify({
            previousSummary: summary,
            earlierTurns: turns,
          }),
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "save_context_summary",
            description: "返回精简的中文对话记忆，不直接写数据库。",
            parameters: {
              type: "object",
              properties: { summary: { type: "string" } },
              required: ["summary"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "save_context_summary" },
      },
      max_tokens: 1500,
    },
    apiKey,
  );
  const choice = response.choices[0];
  const calls = choice.message.tool_calls;
  if (
    choice.finish_reason !== "tool_calls" ||
    calls?.length !== 1 ||
    calls[0].function.name !== "save_context_summary"
  )
    throw new Error("记忆摘要未完整返回");
  return summarySchema.parse(JSON.parse(calls[0].function.arguments)).summary;
};
