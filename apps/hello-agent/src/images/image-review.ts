import { AppError } from "../domain/contracts";
import { configuredGreenReviewer } from "./aliyun-image-review";

export type ImageReview = { decision: "allow" | "block" | "uncertain" | "unavailable"; version: string; category: string };
export type ImageReviewer = (bytes: Buffer) => Promise<ImageReview>;
export class ImageReviewBlockedError extends AppError {}
export class ImageReviewUnavailableError extends AppError {}
export function imageReviewConfigured() {
  return process.env.HELLO_IMAGE_REVIEW_MODE === "aliyun-green" &&
    !!(process.env.HELLO_GREEN_ACCESS_KEY_ID && process.env.HELLO_GREEN_ACCESS_KEY_SECRET);
}
export const configuredImageReviewer: ImageReviewer = async (bytes) => imageReviewConfigured()
  ? configuredGreenReviewer(bytes)
  : { decision: "unavailable", version: "unconfigured", category: "image_unreviewed" };

export async function reviewImage(bytes: Buffer, reviewer = configuredImageReviewer) {
  let result: ImageReview;
  try { result = await reviewer(bytes); }
  catch { result = { decision: "unavailable", version: "review-error", category: "image_unreviewed" }; }
  if (result.decision === "unavailable") throw new ImageReviewUnavailableError(503, "图片审核暂不可用，可稍后继续取图；图片尚未保存或展示");
  if (result.decision !== "allow") throw new ImageReviewBlockedError(422, "图片未通过内容审核，未保存或展示，请更换画面描述");
  return result;
}

export async function reviewUpload(bytes: Buffer): Promise<"allow" | "reject"> {
  await reviewImage(bytes);
  return "allow";
}
