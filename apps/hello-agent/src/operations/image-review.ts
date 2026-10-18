import { createHash } from "node:crypto";
import { z } from "zod";
import type { Repository } from "../cms/repository";
import { ContentReviewError } from "../domain/contracts";
import { OperationsService, transaction } from "./service";
import { audit } from "./audit";
import { assertReviewWrite } from "./review-write";
export type ImageReview = { decision: "allow" | "block" | "uncertain" | "unavailable"; version: string; category: string };
export type ImageReviewer = (bytes: Buffer) => Promise<ImageReview>;
export class ImageReviewUnavailableError extends ContentReviewError {}
const verdict = z.object({ decision: z.enum(["allow", "block", "uncertain"]), version: z.string().min(1).max(100), category: z.string().min(1).max(80) }).strict();
export function imageReviewConfigured() {
  return process.env.HELLO_IMAGE_REVIEW_MODE === "aliyun-green"
    ? !!(process.env.HELLO_GREEN_ACCESS_KEY_ID && process.env.HELLO_GREEN_ACCESS_KEY_SECRET)
    : !!(process.env.HELLO_IMAGE_REVIEW_URL && process.env.HELLO_IMAGE_REVIEW_TOKEN);
}
// 只向部署者显式配置的受信任审核代理发送压缩后的像素；不接受用户传入 URL。
export const configuredImageReviewer: ImageReviewer = async (bytes) => {
  if (process.env.HELLO_IMAGE_REVIEW_MODE === "aliyun-green") {
    const { configuredGreenReviewer } = await import("./aliyun-image-review");
    return configuredGreenReviewer(bytes);
  }
  const endpoint = process.env.HELLO_IMAGE_REVIEW_URL;
  const key = process.env.HELLO_IMAGE_REVIEW_TOKEN;
  if (!endpoint || !key) return { decision: "unavailable", version: "unconfigured", category: "image_unreviewed" };
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid endpoint");
    const result = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ mimeType: "image/jpeg", base64: bytes.toString("base64") }) });
    if (!result.ok) throw new Error("review failed");
    const text = await result.text();
    if (text.length > 4096) throw new Error("oversize verdict");
    return verdict.parse(JSON.parse(text));
  } catch { return { decision: "unavailable", version: "provider-unavailable", category: "image_unreviewed" }; }
};
export async function reviewImage(repo: Repository, bytes: Buffer, reviewer = configuredImageReviewer, source: { stage?: "input_image" | "output_image"; turnId?: number; sessionId?: number; mediaId?: number } = {}) {
  let result: ImageReview;
  try { result = await reviewer(bytes); } catch { result = { decision: "unavailable", version: "review-error", category: "image_unreviewed" }; }
  const digest = createHash("sha256").update(bytes).digest("hex");
  await transaction(repo.payload, async (req) => {
    await assertReviewWrite(repo.owner.id, req);
    await audit(repo.payload, "system:image-review", `image.${result.decision}`, digest, "图片像素审核", { version: result.version, category: result.category, ...source }, req);
    if (result.decision !== "allow") await new OperationsService(repo.payload).createCase({
      owner: repo.owner.id, source: "image", category: result.category, stage: source.stage || "input_image", turnId: source.turnId, sessionId: source.sessionId, mediaId: source.mediaId, decision: result.decision,
      ruleVersion: "image-gateway-v1", modelVersion: result.version,
    }, `图片 SHA-256：${digest}；${bytes.length} 字节。未保留被拒图片像素。`, req);
  });
  if (result.decision === "unavailable") throw new ImageReviewUnavailableError(503, source.stage === "output_image"
    ? "图片审核服务暂不可用，可稍后继续取图；图片尚未保存或展示"
    : "图片审核服务暂不可用，本次图片未保存或展示；可以先使用文字");
  if (result.decision !== "allow") throw new ContentReviewError(result.decision === "block" ? 422 : 503, result.decision === "block"
    ? "图片未通过内容审核，未保存图片；可在投诉与申诉入口申请复核"
    : "图片审核服务暂不可用，本次图片未保存或展示；可以先使用文字");
  return result;
}
