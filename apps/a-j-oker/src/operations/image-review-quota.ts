import { createHash } from "node:crypto";
import type { Payload } from "payload";
import { reserveDailyQuota } from "../cms/daily-quota";
import { AppError } from "../domain/contracts";

function dailyLimit(scope: "OWNER" | "GLOBAL", fallback: number) {
  const configured = process.env[`HELLO_IMAGE_REVIEW_${scope}_DAILY_LIMIT`] ?? String(fallback);
  const value = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(value)) throw new AppError(503, "图片审核额度配置无效，请联系管理员");
  return value;
}

// Uploads, legacy images and output retries all spend platform review credits.
// A provider failure may already have been billed, so reservations are final.
export async function reserveImageReview(payload: Payload, owner: string) {
  const digest = createHash("sha256").update(owner).digest("hex");
  await reserveDailyQuota(payload, {
    namespace: "image-review",
    counters: [{ key: `owner:${digest}`, limit: dailyLimit("OWNER", 100) }, { key: "global", limit: dailyLimit("GLOBAL", 1000) }],
    exhaustedMessage: "当前身份或全站今日图片审核额度已用完，请稍后重试；待审核图片尚未保存或展示",
    unavailableMessage: "暂时无法确认图片审核额度，请稍后重试",
  });
}
