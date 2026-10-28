import { z } from "zod";
import type { Repository } from "../cms/repository";
import { AppError, ContentReviewError } from "../domain/contracts";
import { MediaService } from "../domain/media";
import { ContextService } from "../domain/context";
import type { Moderator } from "../domain/moderation";
import { assertGenerationAllowed } from "../operations/enforcement";
import { configuredImageReviewer, imageReviewConfigured, ImageReviewUnavailableError, reviewImage, type ImageReviewer } from "../operations/image-review";
import { configuredImageProvider, ImageTaskFailed, ImageSubmissionRejected, imageRequestSchema, WAN_MODEL, type ImageProvider, type ImageRequest } from "./wan";
import { generatedJpeg } from "./render";
import { reserveImageTask } from "./quota";

type ImageStateRow = { imageGeneration?: unknown; status?: string; visibility?: string };
const stateSchema = z.object({
  input: imageRequestSchema,
  model: z.literal(WAN_MODEL),
  status: z.enum(["submitting", "pending", "stored", "failed", "blocked"]),
  startedAt: z.string().datetime(),
  taskId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/).optional(),
  mediaId: z.number().int().positive().optional(),
});
/** @public Referenced by Payload generated types through typescriptSchema. */
export type ImageState = z.infer<typeof stateSchema>;
export const readImageState = (row: ImageStateRow) => row.imageGeneration ? stateSchema.parse(row.imageGeneration) : undefined;
export function canResumeImage(row: ImageStateRow) {
  const state = stateSchema.safeParse(row.imageGeneration);
  return row.visibility !== "quarantined" && row.status !== "completed" && state.success &&
    ((state.data.status === "stored" && !!state.data.mediaId) || (state.data.status === "pending" && !!state.data.taskId && Date.parse(state.data.startedAt) + 24 * 3600_000 > Date.now()));
}
export function publicImageState<T extends ImageStateRow>(row: T) {
  const { imageGeneration, ...rest } = row;
  if (!imageGeneration) return rest;
  const parsed = stateSchema.safeParse(imageGeneration);
  return { ...rest, imageGeneration: { status: parsed.success ? parsed.data.status : "failed" as const, canResume: canResumeImage(row) } };
}
export type GeneratedImage = { mediaId: number; title: string; alt: string };

// Caller holds the product-session lease. Persist the task before polling; never
// resubmit a request whose acknowledgement or database commit is uncertain.
export class ImageGenerationService {
  constructor(
    readonly repo: Repository,
    readonly media: MediaService,
    private moderate: Moderator,
    private reviewer: ImageReviewer,
    private provider: () => ImageProvider = configuredImageProvider,
  ) {}
  async generate(turnId: number, value: ImageRequest, signal: AbortSignal, apiKey?: string, progress?: (message: string) => void): Promise<GeneratedImage> {
    signal.throwIfAborted();
    let row = await this.repo.get("greetings", turnId);
    if (row.status !== "running" || row.visibility === "quarantined") throw new AppError(409, "本轮已结束或停止展示，不能继续生图");
    await assertGenerationAllowed(this.repo.payload, this.repo.owner.id);
    let state = readImageState(row);
    // Review the user's request before rewritten prompts, charges or task reuse.
    try {
      await this.moderate({ stage: "input", purpose: "image_generation", mode: row.mode,
        texts: [String((row.input as { text?: string }).text || "")],
        context: JSON.stringify(await new ContextService(this.repo).modelContext(Number(row.sessionId))), requestId: `image-intent:${turnId}`,
        turnId, sessionId: Number(row.sessionId), apiKey });
    } catch (error) {
      if (state && error instanceof ContentReviewError && error.status === 422)
        await this.repo.update("greetings", turnId, { imageGeneration: { ...state, status: "blocked" } });
      throw error;
    }
    signal.throwIfAborted();
    if (state?.status === "stored" && state.mediaId) {
      await this.media.read(state.mediaId);
      return { mediaId: state.mediaId, title: state.input.title, alt: state.input.alt };
    }
    if (state && state.status !== "pending") throw new AppError(409, state.status === "submitting"
      ? "生图提交结果尚未确认，为避免重复扣费不会自动再次提交，请联系管理员核对"
      : "这次生图未能完成，请重新提出图片需求");
    const provider = this.provider();
    if (!state) {
      const input = imageRequestSchema.parse(value);
      // Fail before charging if output review has not been configured.
      if (this.reviewer === configuredImageReviewer && !imageReviewConfigured())
        throw new AppError(503, "图片审核服务尚未配置，暂不能生成图片");
      await this.moderate({ stage: "output", mode: row.mode, texts: [input.prompt, input.title, input.alt], context: String((row.input as { text?: string }).text || ""), requestId: `image:${turnId}`, turnId, sessionId: Number(row.sessionId), apiKey });
      signal.throwIfAborted();
      await reserveImageTask(this.repo.payload, this.repo.owner.id);
      signal.throwIfAborted();
      state = { input, model: WAN_MODEL, status: "submitting", startedAt: new Date().toISOString() };
      await this.repo.update("greetings", turnId, { imageGeneration: state });
      progress?.("阿J正在绘制图片");
      let taskId: string;
      try { taskId = await provider.submit(input, signal); }
      catch (error) {
        // Only definitive rejection ends submitting. Lost acknowledgements stay
        // uncertain, so recovery never silently submits a second paid task.
        if (error instanceof ContentReviewError || error instanceof ImageSubmissionRejected)
          await this.repo.update("greetings", turnId, { imageGeneration: { ...state, status: error instanceof ContentReviewError ? "blocked" : "failed" } });
        throw error;
      }
      state = { ...state, taskId, status: "pending" };
      await this.repo.update("greetings", turnId, { imageGeneration: state });
    }
    if (!state.taskId) throw new AppError(409, "生图任务编号缺失，未重新提交");
    try {
      progress?.("图片正在生成，请稍候");
      const bytes = await provider.result(state.taskId, signal);
      signal.throwIfAborted();
      const normalized = await generatedJpeg(bytes, `${this.repo.owner.id}:${turnId}:${state.taskId}`);
      progress?.("图片已生成，正在审核和保存");
      const review = await reviewImage(this.repo, normalized, this.reviewer, { stage: "output_image", turnId, sessionId: Number(row.sessionId) });
      signal.throwIfAborted();
      await assertGenerationAllowed(this.repo.payload, this.repo.owner.id);
      row = await this.repo.get("greetings", turnId);
      if (row.visibility === "quarantined" || row.status !== "running") throw new AppError(403, "本轮已停止，图片不再发布");
      const media = await this.media.save(normalized, { turnId, provider: "bailian", model: state.model, taskId: state.taskId });
      await this.repo.update("media", media.id, { safetyReview: review });
      await this.repo.update("greetings", turnId, { imageGeneration: { ...state, status: "stored", mediaId: media.id } });
      return { mediaId: media.id, title: state.input.title, alt: state.input.alt };
    } catch (error) {
      if ((error instanceof ContentReviewError && !(error instanceof ImageReviewUnavailableError)) || error instanceof ImageTaskFailed)
        await this.repo.update("greetings", turnId, { imageGeneration: { ...state, status: error instanceof ContentReviewError ? "blocked" : "failed" } });
      // Network, decoding and storage failures retain the task ID for explicit recovery.
      throw error;
    }
  }
}
