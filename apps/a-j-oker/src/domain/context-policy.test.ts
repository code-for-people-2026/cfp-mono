import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeMemory,
  estimateTokens,
  memorySchema,
  memoryTokens,
  summarySchema,
} from "./context-policy";
import {
  adConfiguration,
  assertReward,
  finishReward,
  issueReward,
} from "./rewarded-ads";

afterEach(() => vi.unstubAllEnvs());
describe("记忆血条与观看资格", () => {
  it("没有记录时满血，中文与英文均纳入估算", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("阿J")).toBe(2);
    expect(describeMemory(memorySchema.parse({}), []).remainingPercent).toBe(
      100,
    );
  });
  it("超预算显示空血，不出现负数；摘要也占空间", () => {
    const memory = memorySchema.parse({ summary: "记".repeat(13000) });
    expect(describeMemory(memory, []).remainingPercent).toBe(0);
    expect(describeMemory(memory, []).level).toBe("empty");
    expect(memoryTokens("摘要", [])).toBeGreaterThan(0);
  });
  it("保留最近两轮，少量对话不要求用户看广告", () => {
    const turn = {
      id: 1,
      input: { text: "新工作", mediaIds: [] },
      greeting: "一步一步来",
    };
    expect(
      describeMemory(memorySchema.parse({}), [turn, turn]).canCompact,
    ).toBe(false);
    expect(
      describeMemory(memorySchema.parse({}), [turn, turn, turn]).candidateCount,
    ).toBe(1);
    expect(() => summarySchema.parse({ summary: "" })).toThrow();
    expect(() => summarySchema.parse({ summary: "字".repeat(901) })).toThrow();
  });
  it("最长的两轮加摘要仍有余量，不会满血却没有可压缩内容", () => {
    const turn = {
      id: 1,
      input: { text: "字".repeat(4000), mediaIds: [1, 2, 3] },
      greeting: "字".repeat(1000),
    };
    const view = describeMemory(
      memorySchema.parse({ summary: "记".repeat(900) }),
      [turn, turn],
    );
    expect(view.remainingPercent).toBeGreaterThan(0);
    expect(view.canCompact).toBe(false);
  });
  it("观看资格绑定版本，提前结束、过期和重放被拒绝", () => {
    const reward = issueReward(2, "demo", 1000);
    expect(() => finishReward(reward, 5999)).toThrow(/尚未/);
    expect(finishReward(reward, 6000).completedAt).toBe(6000);
    expect(() => assertReward(reward, reward.id, 3, 6000)).toThrow(/广告/);
    expect(() => assertReward(reward, reward.id, 2, reward.expiresAt)).toThrow(
      /过期/,
    );
    expect(() => assertReward(reward, "other", 2, 6000)).toThrow(/广告/);
  });
  it("非本地环境不能自动开启演示或未验签的微信回执", () => {
    vi.stubEnv("HELLO_ORIGIN", "https://example.com");
    vi.stubEnv("HELLO_AD_MODE", "wechat");
    vi.stubEnv("WECHAT_REWARDED_AD_UNIT_ID", "test-ad");
    expect(adConfiguration().mode).toBe("disabled");
    vi.stubEnv("HELLO_ORIGIN", "http://127.0.0.1:3310");
    expect(adConfiguration().mode).toBe("wechat");
    vi.stubEnv("HELLO_AD_MODE", "demo");
    expect(adConfiguration().mode).toBe("demo");
  });
});
