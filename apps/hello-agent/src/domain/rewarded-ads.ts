import { randomUUID } from "node:crypto";
import { AppError } from "./contracts";
import type { Reward } from "./context-policy";

const DEMO_WATCH_MS = 5000;
export function adConfiguration() {
  const origin = new URL(process.env.HELLO_ORIGIN || "http://127.0.0.1:3310");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  const adUnitId = process.env.WECHAT_REWARDED_AD_UNIT_ID || "";
  // 正式广告回执尚无服务端验签：仅明确开启本地联调时接受客户端完整观看声明。
  if (local && adUnitId && process.env.HELLO_AD_MODE === "wechat")
    return { mode: "wechat" as const, adUnitId, demoSeconds: 5 };
  if (local && process.env.HELLO_AD_MODE !== "disabled")
    return { mode: "demo" as const, adUnitId: "", demoSeconds: 5 };
  return { mode: "disabled" as const, adUnitId: "", demoSeconds: 5 };
}
export function issueReward(
  revision: number,
  mode: Reward["mode"],
  now: number,
): Reward {
  return {
    id: randomUUID(),
    revision,
    mode,
    issuedAt: now,
    expiresAt: now + 15 * 60_000,
  };
}
export function assertReward(
  reward: Reward | undefined,
  id: string,
  revision: number,
  now: number,
) {
  if (!reward || reward.id !== id || reward.revision !== revision)
    throw new AppError(403, "请先完整观看一次广告再整理记忆");
  if (reward.expiresAt <= now)
    throw new AppError(410, "观看资格已过期，请重新观看");
  return reward;
}
export function finishReward(reward: Reward, now: number) {
  if (reward.completedAt !== undefined) return reward;
  if (reward.mode === "demo" && now - reward.issuedAt < DEMO_WATCH_MS)
    throw new AppError(409, "演示广告尚未播放完成");
  return { ...reward, completedAt: now };
}
