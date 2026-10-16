import { AppError } from "../domain/contracts";
import { configuredGreenReviewer } from "./aliyun-image-review";

export type ImageReview = { decision: "allow" | "block" | "uncertain" | "unavailable"; version: string; category: string };
export type ImageReviewer = (bytes: Buffer) => Promise<ImageReview>;
export function imageReviewConfigured() {
  return process.env.HELLO_IMAGE_REVIEW_MODE === "aliyun-green" &&
    !!(process.env.HELLO_GREEN_ACCESS_KEY_ID && process.env.HELLO_GREEN_ACCESS_KEY_SECRET);
}
const configuredImageReviewer: ImageReviewer = async (bytes) => imageReviewConfigured()
  ? configuredGreenReviewer(bytes)
  : { decision: "unavailable", version: "unconfigured", category: "image_unreviewed" };

async function reviewImage(bytes: Buffer, reviewer = configuredImageReviewer) {
  let result: ImageReview;
  try { result = await reviewer(bytes); }
  catch { result = { decision: "unavailable", version: "review-error", category: "image_unreviewed" }; }
  if (result.decision === "unavailable") throw new AppError(503, "图片审核暂不可用，请稍后重试或使用文字");
  if (result.decision !== "allow") throw new AppError(422, "这张图片未通过审核，请更换图片或使用文字");
  return result;
}

export async function reviewUpload(bytes: Buffer): Promise<"allow" | "reject"> {
  await reviewImage(bytes);
  return "allow";
}
