import { createHash } from "node:crypto";
import type { Payload } from "payload";
import { reserveDailyQuota } from "../cms/daily-quota";
import { AppError } from "../domain/contracts";

function dailyLimit(scope: "OWNER" | "GLOBAL", fallback: number) {
  const configured = process.env[`HELLO_IMAGE_${scope}_DAILY_LIMIT`] ?? String(fallback);
  const value = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(value)) throw new AppError(503, "图片生成额度配置无效，请联系管理员");
  return value;
}

// All modes use the platform's image credentials, including text-model BYOK.
// Reserve before the first submit; uncertain results never refund this budget.
export async function reserveImageTask(payload: Payload, owner: string) {
  const digest = createHash("sha256").update(owner).digest("hex");
  await reserveDailyQuota(payload, {
    namespace: "image",
    counters: [{ key: `owner:${digest}`, limit: dailyLimit("OWNER", 10) }, { key: "global", limit: dailyLimit("GLOBAL", 100) }],
    exhaustedMessage: "当前身份或全站今日生图额度已用完，请稍后再试；已有图片仍可继续取图",
    unavailableMessage: "暂时无法确认图片生成额度，请稍后重试",
  });
}
