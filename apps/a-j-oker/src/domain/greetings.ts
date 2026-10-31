import { CREATION_REFUSAL, isSupportImageRequest, isUnsupportedCreation } from "./creation-scope";
import { SERVICE_SCOPE_REFUSAL, SERVICE_SCOPE_CLARIFICATION, SERVICE_SCOPE_VERSION } from "./service-scope";
import { INTERACTION_VERSION } from "../interaction/policy";
import { InteractionService } from "../interaction/service";
import type { Session } from "@cfp/a-j-oker-contracts";
import type { Greeting as GreetingRecord } from "../payload-types";
import { reservePlatformCalls } from "../cms/platform-quota";
import { GREETING_MAX_CALLS } from "../agent/limits";
import { illustrationPng } from "./artifact-rendering";
import { uploadedAiXmp } from "../labeling/upload-provenance";
import sharp from "sharp";
import { Repository, fingerprint } from "../cms/repository";
import {
  AppError,
  ContentReviewError,
  externalSchema,
  turnSchema,
  greetingSchema,
  type Greeting,
  type Mode,
  type Inspiration,
} from "./contracts";
import { PROMPT_VERSION } from "../agent/instruction";
import type { Generator } from "../agent/runtime";
import { DEFAULT_MODEL } from "../models/deepseek";
import { ContextService } from "./context";
import { forgetContextRequested, FORGET_CONTEXT_GUIDANCE } from "./context-policy";
import { MAX_STORED_IMAGE_BYTES } from "./media-policy";
import { MediaService } from "./media";
import { artifactsSchema, validateForm } from "@cfp/a-j-oker-protocol";
import { type Moderator } from "./moderation";
import { operationalModerator } from "../operations/moderation";
import { assertGenerationAllowed, assertMediaAllowed } from "../operations/enforcement";
import { configuredImageReviewer, ImageReviewUnavailableError, reviewImage, type ImageReviewer } from "../operations/image-review";
import { textLeaves } from "./keyword-matcher";
import { randomUUID } from "node:crypto";
import { ImageGenerationService, canResumeImage, publicImageState, readImageState } from "../images/service";
import { configuredImageProvider, type ImageProvider } from "../images/wan";

// 外部 MCP 路径只保存产物，不加载或启动平台的 Agent 运行时。
const platformGenerator: Generator = async (request) => {
  const { runGreeting } = await import("../agent/runtime");
  return runGreeting(request);
};

export class GreetingService {
  constructor(
    readonly repo: Repository,
    private generate: Generator = platformGenerator,
    readonly media = new MediaService(repo),
    reviewUpload?: (bytes: Buffer) => Promise<"allow" | "reject">,
    safety: { moderate?: Moderator; imageReviewer?: ImageReviewer; imageProvider?: () => ImageProvider } = {},
  ) {
    this.moderate = safety.moderate ?? operationalModerator(repo);
    this.imageReviewer = safety.imageReviewer ?? (reviewUpload ? async (bytes) => ({ decision: await reviewUpload(bytes) === "allow" ? "allow" : "block", category: "upload", version: "injected-upload-review" }) : configuredImageReviewer);
    this.imageProvider = safety.imageProvider ?? configuredImageProvider;
  }
  private moderate: Moderator;
  private imageReviewer: ImageReviewer;
  private imageProvider: () => ImageProvider;

  async sessions(): Promise<Session[]> {
    return (await this.repo.all("sessions"))
      .map(({ id, title, createdAt, updatedAt }) => ({
        id,
        title,
        createdAt,
        updatedAt,
      }))
      .sort(
        (a, b) =>
          (a.updatedAt || a.createdAt).localeCompare(
            b.updatedAt || b.createdAt,
          ) || a.id - b.id,
      );
  }
  async createSession(title = "新对话"): Promise<Session> {
    return this.repo.create("sessions", { title: title.slice(0, 80) });
  }
  async history(sessionId: number) {
    await this.repo.get("sessions", sessionId);
    return (await this.repo.all("greetings", { sessionId: { equals: sessionId } })).map(publicImageState);
  }
  async submission(sessionId: number, requestId: string) {
    await this.repo.get("sessions", sessionId);
    const rows = await this.repo.list("greetings", {
      and: [{ sessionId: { equals: sessionId } }, { requestKey: { equals: `${this.repo.owner.id}:${requestId}` } }],
    }, 1);
    return { turn: rows[0] ? publicImageState(rows[0]) : null };
  }
  async upload(data: Uint8Array) {
    if (data.length > 5 * 1024 * 1024)
      throw new AppError(413, "单张图片不能超过 5 MB");
    let buffer: Buffer;
    try {
      const provenance = await uploadedAiXmp(data);
      const metadata = await sharp(data, {
        limitInputPixels: 20_000_000,
      }).metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format || ""))
        throw new Error("unsupported");
      let normalized = sharp(data, { limitInputPixels: 20_000_000 })
        .rotate()
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 });
      if (provenance) normalized = normalized.withXmp(provenance);
      buffer = await normalized.toBuffer();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, "请上传有效的 JPEG、PNG 或 WebP 图片");
    }
    if (buffer.length > MAX_STORED_IMAGE_BYTES)
      throw new AppError(413, "处理后的图片仍过大");
    await assertGenerationAllowed(this.repo.payload, this.repo.owner.id);
    const review = await reviewImage(this.repo, buffer, this.imageReviewer);
    const row = await this.media.save(buffer);
    await this.repo.update("media", row.id, { safetyReview: review });
    return {
      id: row.id,
      mimeType: "image/jpeg",
      url: `/api/hello/media/${row.id}`,
    };
  }
  private async begin(
    sessionId: number,
    requestId: string,
    mode: Mode,
    input: Inspiration,
    model: string,
    extra?: unknown,
    reviewKey?: string,
    resumeTurnId?: number,
  ) {
    await assertGenerationAllowed(this.repo.payload, this.repo.owner.id);
    const session = await this.repo.get("sessions", sessionId);
    await Promise.all(input.mediaIds.map(async (id) => {
      await assertMediaAllowed(this.repo.payload, this.repo.owner.id, id);
      const media = await this.repo.get("media", id);
      if ((media.safetyReview as { decision?: string } | undefined)?.decision !== "allow") {
        const content = await this.media.read(id);
        const review = await reviewImage(this.repo, content.bytes, this.imageReviewer, { sessionId, mediaId: id });
        await this.repo.update("media", id, { safetyReview: review });
      }
    }));
    if (input.formResponse) {
      const response = input.formResponse;
      const source = await this.repo.get("greetings", response.turnId);
      if (source.sessionId !== sessionId || source.status !== "completed")
        throw new AppError(400, "表单不属于当前对话或尚未完成");
      const form = artifactsSchema.parse(source.artifacts ?? []).find((item) => item.id === response.artifactId);
      if (!form || form.kind !== "form") throw new AppError(400, "原表单不存在");
      const problem = validateForm(form, response.values);
      if (problem) throw new AppError(400, problem);
      const text = `填写「${form.title}」\n` + form.fields.map((field) => `${field.label}：${response.values[field.id] ?? "（未填写）"}`).join("\n");
      if (text.length > 4000) throw new AppError(400, "填写内容过长，请精简后再提交");
      input = { ...input, text };
    }
    const requestKey = `${this.repo.owner.id}:${requestId}`;
    const hash = fingerprint({ sessionId, mode, input, model, extra });
    const existing = (
      await this.repo.list(
        "greetings",
        { requestKey: { equals: requestKey } },
        1,
      )
    )[0];
    if (existing) {
      if (existing.fingerprint !== hash)
        throw new AppError(409, "同一个请求标识不能用于不同内容");
      if (resumeTurnId === existing.id && canResumeImage(existing)) {
        const row = await this.repo.update("greetings", existing.id, { status: "running", error: null });
        return { row, duplicate: false, guidance: undefined };
      }
      if (existing.status === "running" && mode !== "external")
        throw new AppError(
          409,
          "本轮仍在执行；若进程曾中断，请使用新的请求标识重试",
        );
      if (existing.status === "failed")
        throw new AppError(409, "该请求此前失败，请使用新的请求标识重试");
      return { row: existing, duplicate: existing.status === "completed" };
    }
    let guidance = await new InteractionService(this.repo.payload, this.repo.owner).inspectInput(input.text ?? "", sessionId, requestKey);
    // Fixed safety guidance contains no user/model text and never starts a model.
    // In particular, a crisis must not lose its help text to a classifier outage.
    let serviceGuidance = false;
    if (!guidance) {
      const review = await this.moderate({ stage: "input", serviceScope: true, mode, texts: [input.text ?? ""], requestId: requestKey, sessionId, apiKey: reviewKey ?? process.env.DEEPSEEK_API_KEY });
      if (review?.serviceScope === "outside" || review?.serviceScope === "unclear") {
        guidance = review.serviceScope === "outside" ? SERVICE_SCOPE_REFUSAL : SERVICE_SCOPE_CLARIFICATION;
        serviceGuidance = true;
      }
    }
    if (!guidance && forgetContextRequested(input.text ?? "")) {
      await new ContextService(this.repo).forgetForFuture(sessionId);
      guidance = FORGET_CONTEXT_GUIDANCE;
    }
    await new ContextService(this.repo).ensureRoom(sessionId);
    // 首条消息为默认标题命名；每次发言更新最近活动时间，已有自定义标题保持不变。
    await this.repo.update("sessions", sessionId,
      [
        "新对话",
        "与阿 J 先生的日常",
        "与阿 Q 先生的日常",
        "与好阿 J 的日常",
      ].includes(session.title)
        ? { title: input.text.trim().replace(/\s+/g, " ").slice(0, 32) || "图片对话" }
        : {}, // 只触碰活动时间，避免将读取时的隔离占位标题写回原记录。
    );

    const row = await this.repo.create("greetings", {
      sessionId,
      requestKey,
      fingerprint: hash,
      mode,
      input,
      status: "running",
      model: guidance ? "product-guidance" : model,
      promptVersion: serviceGuidance ? SERVICE_SCOPE_VERSION : guidance ? INTERACTION_VERSION : mode === "external" ? "external-declared" : PROMPT_VERSION,
    });
    return { row, duplicate: false, guidance };
  }
  private async completeProductGuidance(id: number, guidance: string) {
    await assertGenerationAllowed(this.repo.payload, this.repo.owner.id);
    const row = await this.repo.get("greetings", id);
    if (row.visibility === "quarantined") throw new AppError(403, "此轮内容已隔离，不能继续发布");
    if (row.status !== "running" || row.model !== "product-guidance") throw new AppError(409, "本轮不再接受产品指引");
    // Only server-owned interaction, scope or forget guidance; never model text.
    // Public complete() has no bypass option and still reviews every supplied output.
    return this.repo.update("greetings", id, {
      greeting: guidance, association: "产品操作与安全指引", artifacts: [], approach: "supportive", status: "completed",
    });
  }
  async complete(id: number, value: Greeting, reviewKey?: string) {
    await assertGenerationAllowed(this.repo.payload, this.repo.owner.id);
    const output = greetingSchema.parse(value);
    const row = await this.repo.get("greetings", id);
    if (row.visibility === "quarantined") throw new AppError(403, "此轮内容已隔离，不能继续发布");
    if (row.status === "completed") {
      if (
        row.greeting !== output.greeting ||
        row.association !== output.association ||
        fingerprint(row.artifacts ?? []) !== fingerprint(output.artifacts ?? []) ||
        (row.approach ?? undefined) !== output.approach
      )
        throw new AppError(409, "本轮产物已保存，不能覆盖");
      return row;
    }
    if (row.status !== "running") throw new AppError(409, "本轮不再接受产物");
    const originalText = String((row.input as Inspiration).text || "");
    if (output.artifacts?.length && (isUnsupportedCreation(originalText) ||
      (!isSupportImageRequest(originalText) && output.artifacts.some(a => a.kind === "image"))))
      throw new AppError(422, CREATION_REFUSAL);
    // Covers both generated media and geometry illustrations, including reuse.
    if (output.artifacts?.some((artifact) => artifact.kind === "image"))
      await this.moderate({ stage: "input", purpose: "image_generation", mode: row.mode,
        texts: [String((row.input as Inspiration).text || "")],
        context: JSON.stringify(await new ContextService(this.repo).modelContext(Number(row.sessionId))), requestId: `image-save-intent:${row.id}`,
        turnId: row.id, sessionId: Number(row.sessionId), apiKey: reviewKey ?? process.env.DEEPSEEK_API_KEY });
    const imageState = readImageState(row);
    const scopeRefusal = !isSupportImageRequest(originalText) && output.greeting === CREATION_REFUSAL && !output.artifacts?.length;
    if (imageState && !scopeRefusal && (imageState.status !== "stored" || !output.artifacts?.some((artifact) =>
      artifact.kind === "image" && artifact.source.type === "media" && artifact.source.mediaId === imageState.mediaId)))
      throw new AppError(409, "生图尚未完成或回应未引用本轮生成图片，不能宣称完成");
    for (const artifact of output.artifacts ?? [])
      if (artifact.kind === "image" && artifact.source.type === "media") {
        const image = await this.repo.get("media", artifact.source.mediaId);
        const content = await this.media.read(image.id);
        if ((image.safetyReview as { decision?: string } | undefined)?.decision !== "allow") {
          const review = await reviewImage(this.repo, content.bytes, this.imageReviewer, { stage: "output_image", turnId: row.id, sessionId: Number(row.sessionId), mediaId: image.id });
          await this.repo.update("media", image.id, { safetyReview: review });
        }
      }
    for (const artifact of output.artifacts ?? []) {
      if (artifact.kind === "image" && artifact.source.type === "illustration") {
        const pixels = await sharp(await illustrationPng(artifact)).flatten({ background: "white" }).jpeg({ quality: 85 }).toBuffer();
        await reviewImage(this.repo, pixels, this.imageReviewer, { stage: "output_image", turnId: row.id, sessionId: Number(row.sessionId) });
      }
    }
    await this.moderate({
      stage: "output", mode: row.mode, texts: textLeaves(output), context: (row.input as Inspiration).text,
      requestId: String(row.requestKey), turnId: row.id, sessionId: Number(row.sessionId), apiKey: reviewKey ?? process.env.DEEPSEEK_API_KEY,
    });
    return this.repo.update("greetings", id, {
      ...output,
      status: "completed",
    });
  }
  async resumeImage(turnId: number, apiKey?: string, progress?: (message: string) => void) {
    const row = await this.repo.get("greetings", turnId);
    if (row.status === "completed") return row;
    if (!canResumeImage(row) || row.mode === "external") throw new AppError(409, "这次图片任务不能继续，请查看本轮状态");
    return this.generateGreeting({ sessionId: row.sessionId, requestId: String(row.requestKey).slice(this.repo.owner.id.length + 1), input: row.input, mode: row.mode, apiKey }, progress, row.id);
  }
  async generateGreeting(value: unknown, progress?: (message: string) => void, resumeTurnId?: number) {
    const args = turnSchema.parse(value);
    const key =
      args.mode === "byok" ? args.apiKey : process.env.DEEPSEEK_API_KEY;
    if (!key)
      throw new AppError(
        503,
        args.mode === "byok"
          ? "请填写本次使用的 DeepSeek API Key"
          : "平台尚未配置 DeepSeek API Key，可先使用 BYOK 或外部 Agent",
      );
    const model = process.env.HELLO_MODEL || DEFAULT_MODEL;
    const release = await this.repo.acquire(args.sessionId);
    return release.run(async () => {
    let row: GreetingRecord | undefined;
    let reviewFailure: ContentReviewError | undefined;
    const started = Date.now();
    try {
      const result = await this.begin(
        args.sessionId,
        args.requestId,
        args.mode,
        args.input,
        model,
        undefined,
        key,
        resumeTurnId,
      );
      row = result.row;
      if (result.duplicate) return row;
      if (result.guidance) return await this.completeProductGuidance(row.id, result.guidance);
      if (args.mode === "platform") await reservePlatformCalls(this.repo.payload, GREETING_MAX_CALLS);
      const images = new ImageGenerationService(this.repo, this.media, this.moderate, this.imageReviewer, this.imageProvider);
      const imageState = readImageState(row);
      await this.generate({
        repo: this.repo,
        signal: release.signal,
        turnId: row.id,
        sessionId: args.sessionId,
        input: row.input,
        apiKey: key,
        model,
        readImage: (id) => this.media.read(id),
        generateImage: (input, signal) => images.generate(row!.id, input, signal, key, progress),
        existingImage: imageState?.status === "stored" && imageState.mediaId ? { mediaId: imageState.mediaId, title: imageState.input.title, alt: imageState.input.alt } : undefined,
        resumingImage: !!resumeTurnId,
        executionId: resumeTurnId ? `${row.id}:${randomUUID()}` : undefined,
        save: async (output) => {
          try {
            return await this.complete(row!.id, output, key);
          } catch (error) {
            // ADK may convert a thrown tool error to an event; preserve its safe verdict.
            if (error instanceof ContentReviewError) reviewFailure = error;
            throw error;
          }
        },
      });
      const saved = await this.repo.get("greetings", row.id);
      if (saved.status !== "completed")
        throw new AppError(502, "模型没有调用保存工具，本轮未产生吉祥话");
      return await this.repo.update("greetings", row.id, {
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (row) {
        const saved = await this.repo.get("greetings", row.id);
        // 工具已经成功保存时，后续说明或事件失败不能把成功产物标为失败。
        if (saved.status === "completed") return saved;
        await this.repo.update("greetings", row.id, {
          status: "failed",
          error: error instanceof AppError ? error.message : "模型调用或保存失败，请检查配置后重试",
          durationMs: Date.now() - started,
          ...((reviewFailure || error instanceof ContentReviewError) && !(reviewFailure instanceof ImageReviewUnavailableError) && !(error instanceof ImageReviewUnavailableError) && saved.imageGeneration
            ? { imageGeneration: { ...saved.imageGeneration, status: "blocked" } } : {}),
        });
      }
      if (reviewFailure) throw reviewFailure;
      if (error instanceof AppError) throw error;
      // 供应商原始异常可能含请求、密钥或图片；不写日志、数据库或响应。
      throw new AppError(
        502,
        "生成失败：请检查模型密钥、配额和网络；没有使用假回复替代",
      );
    } finally {
      await release();
    }
    });
  }
  async acceptExternal(value: unknown) {
    const args = externalSchema.parse(value);
    const release = await this.repo.acquire(args.sessionId);
    return release.run(async () => {
    let pending: GreetingRecord | undefined;
    try {
      const { row, duplicate, guidance } = await this.begin(
        args.sessionId,
        args.requestId,
        "external",
        args.input,
        args.model,
        args.output,
      );
      if (duplicate) return row;
      pending = row;
      return guidance ? await this.completeProductGuidance(row.id, guidance) : await this.complete(row.id, args.output);
    } catch (error) {
      // Validation failures are terminal; transient storage failures keep the request retryable.
      if (pending && error instanceof AppError) {
        const row = await this.repo.get("greetings", pending.id);
        if (row.status === "running") await this.repo.update("greetings", row.id, { status: "failed", error: "外部回应作品未能通过校验或保存" });
      }
      throw error;
    } finally {
      await release();
    }
    });
  }
}
