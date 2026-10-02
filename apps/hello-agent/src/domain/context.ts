import { Repository } from "../cms/repository";
import { SUMMARY_PROMPT_VERSION } from "../agent/summary-instruction";
import { summarizeContext, type Summarizer } from "../agent/summarize";
import { AppError } from "./contracts";
import {
  memorySchema,
  describeMemory,
  toMemoryTurn,
  memoryTokens,
  summarySchema,
  RECENT_TURNS,
  MEMORY_BUDGET,
  type Memory,
} from "./context-policy";
import {
  adConfiguration,
  issueReward,
  assertReward,
  finishReward,
} from "./rewarded-ads";

export class ContextService {
  constructor(
    readonly repo: Repository,
    private summarize: Summarizer = summarizeContext,
    private now = Date.now,
  ) {}

  private async read(sessionId: number) {
    const row = await this.repo.get("sessions", sessionId);
    const memory = memorySchema.parse(row.memory || {});
    const turns = (
      await this.repo.all("greetings", {
        and: [
          { sessionId: { equals: sessionId } },
          { status: { equals: "completed" } },
          { id: { greater_than: memory.throughId } },
        ],
      })
    ).map(toMemoryTurn);
    return { memory, turns };
  }
  private save(sessionId: number, memory: Memory) {
    return this.repo.update("sessions", sessionId, { memory });
  }
  async view(sessionId: number) {
    const { memory, turns } = await this.read(sessionId);
    return {
      ...describeMemory(memory, turns),
      rewardReady:
        memory.reward?.completedAt !== undefined &&
        memory.reward.expiresAt > this.now(),
      advertisement: adConfiguration(),
    };
  }
  async modelContext(sessionId: number) {
    const { memory, turns } = await this.read(sessionId);
    return {
      memory: memory.summary,
      previous: turns.map(({ input, greeting }) => ({ input, greeting })),
    };
  }
  async ensureRoom(sessionId: number) {
    const { memory, turns } = await this.read(sessionId);
    if (memoryTokens(memory.summary, turns) >= MEMORY_BUDGET)
      throw new AppError(
        409,
        "记忆空间已满，请在阿J页面看广告、整理记忆后继续；原聊天记录仍保留",
      );
  }
  async startAd(sessionId: number) {
    if (this.repo.owner.auth === "bearer")
      throw new AppError(403, "广告必须由用户在阿J页面观看");
    const release = await this.repo.acquire(sessionId);
    try {
      const { memory, turns } = await this.read(sessionId);
      if (turns.length <= RECENT_TURNS)
        throw new AppError(409, "再聊几句就可以整理，最近两轮会保留原文");
      if (memoryTokens(memory.summary, turns.slice(0, -RECENT_TURNS)) > 24_000)
        throw new AppError(
          409,
          "较早记录超过本版单次整理上限，请联系开发者处理；无需先看广告",
        );
      const config = adConfiguration();
      if (config.mode === "disabled")
        throw new AppError(503, "广告尚未配置，暂时不能整理记忆");
      if (
        memory.reward?.completedAt !== undefined &&
        memory.reward.expiresAt > this.now()
      )
        return { ...config, rewardId: memory.reward.id, completed: true };
      const reward = issueReward(memory.revision, config.mode, this.now());
      await this.save(sessionId, { ...memory, reward });
      return { ...config, rewardId: reward.id, completed: false };
    } finally {
      await release();
    }
  }
  async finishAd(sessionId: number, rewardId: string, completed: boolean) {
    if (this.repo.owner.auth === "bearer")
      throw new AppError(403, "Agent 不能代替用户确认广告观看");
    if (!completed) throw new AppError(409, "广告未完整观看，记忆没有变化");
    const release = await this.repo.acquire(sessionId);
    try {
      const { memory } = await this.read(sessionId);
      const reward = assertReward(
        memory.reward,
        rewardId,
        memory.revision,
        this.now(),
      );
      if (adConfiguration().mode !== reward.mode)
        throw new AppError(409, "广告配置已变更，请重试");
      if (reward.mode === "wechat" && this.repo.owner.auth !== "miniapp")
        throw new AppError(403, "微信广告只能在小程序中观看");
      await this.save(sessionId, {
        ...memory,
        reward: finishReward(reward, this.now()),
      });
      return { completed: true };
    } finally {
      await release();
    }
  }
  async compact(sessionId: number, rewardId: string, apiKey?: string) {
    const release = await this.repo.acquire(sessionId);
    try {
      const { memory, turns } = await this.read(sessionId);
      // 网络重试返回上次结果，不重复扣资格或调用模型。
      if (memory.lastCompaction?.rewardId === rewardId)
        return await this.view(sessionId);
      const reward = assertReward(
        memory.reward,
        rewardId,
        memory.revision,
        this.now(),
      );
      if (reward.completedAt === undefined)
        throw new AppError(403, "广告尚未完整观看");
      const candidates = turns.slice(0, -RECENT_TURNS);
      if (!candidates.length) throw new AppError(409, "暂无可整理的较早内容");
      const key = apiKey || process.env.DEEPSEEK_API_KEY;
      if (!key)
        throw new AppError(
          503,
          "压缩需要模型密钥；观看资格仍保留，可配置后重试",
        );
      // 历史异常积压时明确报错，不静默截断或超长调用。正常预算内不会触及此界限。
      if (memoryTokens(memory.summary, candidates) > 24_000)
        throw new AppError(
          409,
          "较早记录超过本版单次整理上限，观看资格保留，请联系开发者处理",
        );
      let summary: string;
      try {
        summary = summarySchema.parse({
          summary: await this.summarize({
            summary: memory.summary,
            turns: candidates,
            apiKey: key,
          }),
        }).summary;
      } catch {
        throw new AppError(
          502,
          "记忆整理失败，原记录和观看资格均保留，可直接重试",
        );
      }
      const beforeTokens = memoryTokens(memory.summary, turns);
      const afterTokens = memoryTokens(summary, turns.slice(-RECENT_TURNS));
      if (afterTokens >= beforeTokens)
        throw new AppError(
          502,
          "摘要没有节省记忆空间，未替换原上下文，可直接重试",
        );
      await this.save(sessionId, {
        revision: memory.revision + 1,
        summary,
        throughId: candidates[candidates.length - 1].id,
        compressions: memory.compressions + 1,
        lastCompaction: {
          rewardId,
          beforeTokens,
          afterTokens,
          compressedAt: new Date(this.now()).toISOString(),
          promptVersion: SUMMARY_PROMPT_VERSION,
        },
      });
      return await this.view(sessionId);
    } finally {
      await release();
    }
  }
}
