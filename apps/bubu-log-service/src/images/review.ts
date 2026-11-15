import { z } from "zod";
import type { PayloadRequest } from "payload";
import { AppError } from "../contracts";
import type { ActorScope } from "../identity";
import type { PrivacyService } from "../privacy/service";
import type { AttachmentMime } from "../records/attachments";
import { hash } from "../records/persistence";

export const REVIEW_VERSION = "aliyun-green-baselineCheck-2022-03-02-v1";
export type ImageReviewer = (bytes: Buffer, mime: AttachmentMime, beforeDisclosure: () => Promise<void>) => Promise<"allow" | "block" | "uncertain" | "unavailable">;
export interface ImageReviewProof { version: string; sha256: string; at: string }
const counterSchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: z.number().int().nonnegative() }).strict();
const unavailable = () => new AppError(503, "IMAGE_REVIEW_UNAVAILABLE", "图片检测暂时不可用，请稍后重试。可以先用文字记录。");

/** One runtime gate. Counters contain no image, message, sender or provider response. */
export class ImageReviewService {
  private active = 0;
  constructor(private readonly privacy: PrivacyService, private readonly reviewer?: ImageReviewer,
    private readonly limits = { family: 100, global: 1000 }) {
    if (![limits.family, limits.global].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1000) || limits.family > limits.global) throw new Error("Invalid image review limits");
  }
  get configured() { return !!this.reviewer && this.privacy.policy().imageProcessingReady; }
  /** Reserve inside the authorized upload transaction, before any external call. Failure also consumes a unit. */
  async reserve(scope: ActorScope, req: PayloadRequest) {
    if (!this.configured) throw unavailable();
    const day = new Date(this.privacy.identity.now()).toISOString().slice(0, 10);
    const rows = [
      { key: "image-review:global", scope: {}, limit: this.limits.global },
      { key: `image-review:family:${hash(scope.babyId)}`, scope: { babyId: scope.babyId }, limit: this.limits.family },
    ];
    for (const row of rows) {
      const raw = await this.privacy.repository.get("privacy-state", row.key, req);
      const previous = raw === undefined ? undefined : counterSchema.parse(raw);
      // Clock reversal must not reset the budget.
      if (previous && previous.day > day) throw unavailable();
      const count = previous?.day === day ? previous.count : 0;
      if (count >= row.limit) throw new AppError(429, "IMAGE_REVIEW_LIMIT", "今天的图片检测次数已用完，可以先用文字记录，稍后再补照片。");
      await this.privacy.repository.put("privacy-state", row.key, { day, count: count + 1 }, row.scope, req);
    }
  }
  /** No SQLite transaction is held while the supplier handles normalized pixels. */
  async inspect(bytes: Buffer, mime: AttachmentMime, sha256: string, beforeDisclosure: () => Promise<void>): Promise<ImageReviewProof> {
    if (!this.configured || this.active >= 2) throw unavailable();
    this.active++;
    try {
      // The adapter has a bounded overall deadline and never starts the next network step after it expires.
      let verdict: Awaited<ReturnType<ImageReviewer>>;
      try { verdict = await this.reviewer!(bytes, mime, beforeDisclosure); } catch (error) { if (error instanceof AppError) throw error; throw unavailable(); }
      if (verdict === "block" || verdict === "uncertain") throw new AppError(422, "IMAGE_REVIEW_NOT_ACCEPTED", "这张照片未通过自动检测，尚未保存，也未发送给 AI。这不是宝宝健康判断；若尿布等照护照片被误判，可在菜单的隐私与数据中提交申诉，先用文字记录。");
      if (verdict !== "allow") throw unavailable();
      return { version: REVIEW_VERSION, sha256, at: new Date(this.privacy.identity.now()).toISOString() };
    } finally { this.active--; }
  }
  requireProof(proof: ImageReviewProof | undefined, sha256: string) {
    if (!this.configured) throw unavailable();
    if (!proof || proof.version !== REVIEW_VERSION || proof.sha256 !== sha256 || !Number.isFinite(Date.parse(proof.at))) {
      throw new AppError(409, "IMAGE_REVIEW_REQUIRED", "这张历史照片尚无当前检测结果，可以继续查看。若要交给 AI 整理，请重新选择并上传照片。");
    }
  }
}
