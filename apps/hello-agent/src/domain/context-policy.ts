import { z } from "zod";
import type { Greeting } from "../payload-types";
import type { MemoryStatus } from "@cfp/hello-agent-contracts";
import { inputSchema } from "./contracts";

// 这是产品的对话记忆预算，不是供应商上下文窗口，也不是计费 token。
export const MEMORY_BUDGET = 18_000;
export const RECENT_TURNS = 2;
export const summarySchema = z.object({
  summary: z.string().trim().min(1).max(900),
});
export const rewardSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  mode: z.enum(["demo", "wechat"]),
  issuedAt: z.number(),
  expiresAt: z.number(),
  completedAt: z.number().optional(),
});
const compactionResult = z.object({
  compressedAt: z.string(),
  beforeTokens: z.number(),
  afterTokens: z.number(),
  promptVersion: z.string(),
});
export const memorySchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  summary: z.string().default(""),
  throughId: z.number().int().nonnegative().default(0),
  compressions: z.number().int().nonnegative().default(0),
  reward: rewardSchema.optional(),
  // 兼容已存在的广告整理记录；测试版记录不带 rewardId，也不生成观看资格。
  lastCompaction: z
    .union([
      compactionResult.extend({ rewardId: z.string() }),
      compactionResult.extend({
        source: z.literal("preview"),
        requestId: z.string().uuid(),
      }),
    ])
    .optional(),
});
export type Memory = z.infer<typeof memorySchema>;
export type Reward = z.infer<typeof rewardSchema>;
export type MemoryTurn = {
  id: number;
  input: { text: string; mediaIds: number[] };
  greeting: string;
};

export function estimateTokens(text: string) {
  let ascii = 0;
  let wide = 0;
  for (const character of text) {
    if (character.codePointAt(0)! < 128) ascii++;
    else wide++;
  }
  return Math.ceil(ascii / 4 + wide * 1.5);
}
export function toMemoryTurn(row: Greeting): MemoryTurn {
  return {
    id: row.id,
    input: inputSchema.parse(row.input),
    greeting: String(row.greeting || ""),
  };
}
export function memoryTokens(summary: string, turns: MemoryTurn[]) {
  // 历史不重复传图片二进制；图片编号及既有回复仍可帮助续接话题。
  return (
    estimateTokens(summary) +
    turns.reduce(
      (total, turn) =>
        total +
        estimateTokens(
          JSON.stringify({ input: turn.input, greeting: turn.greeting }),
        ) +
        12,
      0,
    )
  );
}
export function describeMemory(
  memory: Memory,
  turns: MemoryTurn[],
): Omit<MemoryStatus, "rewardReady" | "advertisement" | "recoveryMode"> & {
  lastCompaction?: Memory["lastCompaction"];
} {
  const usedTokens = memoryTokens(memory.summary, turns);
  const remainingPercent = Math.max(
    0,
    Math.floor((1 - usedTokens / MEMORY_BUDGET) * 100),
  );
  const candidates = turns.slice(0, -RECENT_TURNS);
  return {
    revision: memory.revision,
    usedTokens,
    budgetTokens: MEMORY_BUDGET,
    remainingPercent,
    level:
      remainingPercent === 0
        ? "empty"
        : remainingPercent <= 25
          ? "low"
          : "healthy",
    canCompact: candidates.length > 0,
    candidateCount: candidates.length,
    recentTurns: RECENT_TURNS,
    compressions: memory.compressions,
    summary: memory.summary,
    lastCompaction: memory.lastCompaction,
  };
}
