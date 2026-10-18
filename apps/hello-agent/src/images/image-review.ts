export type ImageReview = { decision: "allow" | "block" | "uncertain" | "unavailable"; version: string; category: string };
export type ImageReviewer = (bytes: Buffer) => Promise<ImageReview>;
export function imageReviewConfigured() {
  return process.env.HELLO_IMAGE_REVIEW_MODE === "aliyun-green" &&
    !!(process.env.HELLO_GREEN_ACCESS_KEY_ID && process.env.HELLO_GREEN_ACCESS_KEY_SECRET);
}
