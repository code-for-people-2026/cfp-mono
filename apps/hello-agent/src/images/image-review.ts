import { greenReviewCredentials } from "./review-config";

export type ImageReview = { decision: "allow" | "block" | "uncertain" | "unavailable"; version: string; category: string };
export type ImageReviewer = (bytes: Buffer) => Promise<ImageReview>;
export function imageReviewConfigured() {
  return process.env.HELLO_IMAGE_REVIEW_MODE === "aliyun-green" &&
    !!greenReviewCredentials();
}
