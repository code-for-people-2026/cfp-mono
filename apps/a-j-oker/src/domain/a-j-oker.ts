import { CREATION_REFUSAL } from "./creation-scope";
import { z } from "zod";
import { SERVICE_SCOPE_REFUSAL, SERVICE_SCOPE_CLARIFICATION, SERVICE_SCOPE_VERSION } from "./service-scope";
import { INTERACTION_VERSION } from "../interaction/policy";
import { InteractionService } from "../interaction/service";
import {
  AJ_PRESENTATION_REVISION,
  ajPresentationId,
  imageGenerationBlocksRetry,
  type Session,
} from "@cfp/a-j-oker-contracts";
import type { AJoker as AJokerRecord } from "../payload-types";
import { reservePlatformCalls } from "../cms/platform-quota";
import { AJOKER_MAX_CALLS } from "../agent/limits";
import { illustrationPng } from "./artifact-rendering";
import { uploadedAiXmp } from "../labeling/upload-provenance";
import sharp from "sharp";
import { Repository, fingerprint } from "../cms/repository";
import {
  AppError,
  ContentReviewError,
  ServiceProblemError,
  externalSchema,
  type GenerationProgress,
  renderProgress,
  turnSchema,
  aJokerSchema,
  handoffPreambleSchema,
  type AJoker,
  type Mode,
  type Inspiration,
} from "./contracts";
import { PROMPT_VERSION } from "../agent/instruction";
import type { Generator } from "../agent/runtime";
import { DEFAULT_MODEL } from "../models/deepseek";
import { ContextService } from "./context";
import { FORGET_CONTEXT_GUIDANCE } from "./context-policy";
import { MAX_STORED_IMAGE_BYTES } from "./media-policy";
import { MediaService } from "./media";
import {
  legacyArtifactsSchema,
  presentationFromLegacyArtifacts,
  validateForm,
  type Field,
  type FormValue,
} from "@cfp/base-chat-protocol";
import {
  assertImageGenerationReview,
  interactionAssessmentSchema,
  semanticModerationRejection,
  type Moderator,
  type SemanticModerationRejection,
} from "./moderation";
import { operationalModerator } from "../operations/moderation";
import { assertGenerationAllowed, assertMediaAllowed } from "../operations/enforcement";
import { configuredImageReviewer, ImageReviewUnavailableError, reviewImage, type ImageReviewer } from "../operations/image-review";
import { textLeaves } from "./keyword-matcher";
import { randomUUID } from "node:crypto";
import { ImageGenerationService, canResumeImage, readImageState } from "../images/service";
import { configuredImageProvider, type ImageProvider } from "../images/wan";
import { activeSpecialistFromTurns, specialistActionMatches, specialistStateSchema, type SpecialistState } from "../agent/specialist-state";
import { publicAJokerState } from "./public-a-j-oker";
import { retryLineages, retryRequestId } from "./retry-lineage";

export { retryRequestId } from "./retry-lineage";

// 外部 MCP 路径只保存产物，不加载或启动平台的 Agent 运行时。
const platformGenerator: Generator = async (request) => {
  const { runAJoker } = await import("../agent/runtime");
  return runAJoker(request);
};

const requiredInputReviewSchema = z.object({
  serviceScope: z.enum(["support", "outside", "unclear"]),
  interaction: interactionAssessmentSchema,
});
const serviceScopeSchema = requiredInputReviewSchema.shape.serviceScope;
const requiredOutputReviewSchema = z.object({
  serviceScope: z.enum(["support", "outside", "unclear"]),
});
function formatFormValue(field: Field, value: FormValue | undefined) {
  if (value === undefined) return "（未填写）";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if ("unknown" in value) return "（无法说明）";
  if (field.type !== "select" && field.type !== "multiSelect")
    return "（无效答案）";
  const labels = field.options
    .filter((option) => value.optionIds.includes(option.id))
    .map((option) => option.label);
  if (value.otherText !== undefined) labels.push(`补充：${value.otherText}`);
  return labels.join("、") || "（未填写）";
}

export class AJokerService {
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
    const rows = await this.repo.all("a-j-oker", { sessionId: { equals: sessionId } });
    const lineages = retryLineages(this.repo.owner.id, rows);
    return rows.map((row, index) => publicAJokerState({
      ...row,
      ...lineages[index],
    }));
  }
  async submission(sessionId: number, requestId: string) {
    await this.repo.get("sessions", sessionId);
    const rows = await this.repo.list("a-j-oker", {
      and: [{ sessionId: { equals: sessionId } }, { requestKey: { equals: `${this.repo.owner.id}:${requestId}` } }],
    }, 1);
    return { turn: rows[0] ? publicAJokerState(rows[0]) : null };
  }
  async retryFailed(turnId: number, apiKey?: string) {
    const original = await this.repo.get("a-j-oker", turnId);
    const exhaustedHandoff = original.status === "completed" &&
      original.specialist?.handoff?.status === "failed";
    if (original.status !== "failed" && !exhaustedHandoff)
      throw new AppError(409, "只能重试已确认失败的回合或未完成的专家交接");
    if (original.mode !== "platform")
      throw new AppError(409, "当前仅支持重试平台模式的失败回合");
    if ((original.input as Inspiration).action)
      throw new AppError(409, "这类操作不能重复执行，请刷新确认当前状态");
    if (exhaustedHandoff && (original.input as Inspiration).formResponse)
      throw new AppError(409, "已完成提交的表单不会自动重放，请从最新回复继续");
    if (imageGenerationBlocksRetry(original.imageGeneration))
      throw new AppError(
        409,
        "这轮图片已提交、生成中或已保存，整轮重试可能重复扣费；请返回该轮使用继续取图，若不能恢复或提交结果未确认，请联系管理员核对",
      );
    const requestId = retryRequestId(this.repo.owner.id, turnId);
    const result = await this.generateAJoker({
      sessionId: Number(original.sessionId),
      requestId,
      input: structuredClone(original.input),
      mode: "platform",
      apiKey,
    });
    return publicAJokerState({ ...result, retryOfTurnId: turnId });
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
      const source = await this.repo.get("a-j-oker", response.turnId);
      if (source.sessionId !== sessionId || source.status !== "completed")
        throw new AppError(400, "表单不属于当前对话或尚未完成");
      const savedArtifacts = legacyArtifactsSchema.parse(
        source.artifacts ?? [],
        { jitless: true },
      );
      const presentation = response.presentation
        ? presentationFromLegacyArtifacts({
            id: ajPresentationId(source.id),
            revision: AJ_PRESENTATION_REVISION,
            blocks: savedArtifacts,
          })
        : undefined;
      if (
        response.presentation &&
        presentation &&
        (response.presentation.presentationId !== presentation.id ||
          response.presentation.revision !== presentation.revision ||
          response.presentation.formId !== response.artifactId)
      )
        throw new AppError(400, "表单提交版本不匹配");
      const form = (presentation?.blocks ?? savedArtifacts).find(
        (item) => item.id === response.artifactId,
      );
      if (!form || form.kind !== "form") throw new AppError(400, "原表单不存在");
      const problem = validateForm(form, response.values);
      if (problem) throw new AppError(400, problem);
      const text = `填写「${form.title}」\n` + form.fields
        .map((field) => `${field.label}：${formatFormValue(field, response.values[field.id])}`)
        .join("\n");
      if (text.length > 4000) throw new AppError(400, "填写内容过长，请精简后再提交");
      input = { ...input, text };
    }
    const requestKey = `${this.repo.owner.id}:${requestId}`;
    const hash = fingerprint({ sessionId, mode, input, model, extra });
    const existing = (
      await this.repo.list(
        "a-j-oker",
        { requestKey: { equals: requestKey } },
        1,
      )
    )[0];
    if (existing) {
      if (existing.fingerprint !== hash)
        throw new AppError(409, "同一个请求标识不能用于不同内容");
      if (resumeTurnId === existing.id && canResumeImage(existing)) {
        const row = await this.repo.update("a-j-oker", existing.id, { status: "running", error: null });
        return { row, duplicate: false, guidance: undefined, imageRequested: true };
      }
      if (existing.status === "running" && mode !== "external")
        throw new AppError(
          409,
          "本轮仍在执行；若进程曾中断，请使用新的请求标识重试",
        );
      if (existing.status === "failed")
        throw new AppError(409, "该请求此前失败，请使用新的请求标识重试");
      return { row: existing, duplicate: existing.status === "completed", imageRequested: false };
    }
    // One existing moderation call supplies safety, service scope and strict
    // semantic interaction flags. There is intentionally no keyword fallback.
    const moderationContext = JSON.stringify(await new ContextService(this.repo)
      .reviewContext(sessionId));
    let review: void | Awaited<ReturnType<Moderator>>;
    let rejection: SemanticModerationRejection | undefined;
    try {
      review = input.action ? {
        serviceScope: "support" as const,
        interaction: {
          minor: false, crisis: false, dependency: false, overuse: false,
          exit: false, forget_context: false, image_requested: false,
          single_choice_only: false,
          single_open_question_only: false,
        },
      } : await this.moderate({
        stage: "input", serviceScope: true, interaction: true, mode,
        texts: [input.text ?? ""], context: moderationContext, requestId: requestKey,
        sessionId, apiKey: reviewKey ?? process.env.DEEPSEEK_API_KEY,
      });
    } catch (error) {
      rejection = semanticModerationRejection(error);
      if (!rejection) throw error;
      review = rejection.semanticVerdict;
    }
    let serviceScope: z.infer<typeof serviceScopeSchema> | undefined;
    let interaction: z.infer<typeof interactionAssessmentSchema>;
    if (rejection) {
      // Content rejection may omit the optional product-scope field. The seven
      // interaction booleans, when supplied, still describe the same current
      // input and must remain independently actionable.
      const assessed = interactionAssessmentSchema.safeParse(rejection.semanticVerdict.interaction);
      if (!assessed.success) throw rejection;
      interaction = assessed.data;
      const scoped = serviceScopeSchema.safeParse(rejection.semanticVerdict.serviceScope);
      serviceScope = scoped.success ? scoped.data : undefined;
    } else {
      const semanticReview = requiredInputReviewSchema.safeParse(review);
      if (!semanticReview.success) throw new ContentReviewError(503, "互动安全判断暂未完成，请稍后重试");
      ({ serviceScope, interaction } = semanticReview.data);
    }
    // Safety and account-protection actions take precedence over product scope.
    let guidance = await new InteractionService(this.repo.payload, this.repo.owner)
      .inspectInput(input.text ?? "", sessionId, requestKey, interaction);
    // Only a completed interaction action may replace the refusal surface. A
    // rejected request with no actionable flag remains rejected.
    if (rejection && !guidance) throw rejection;
    let serviceGuidance = false;
    if (!guidance) {
      if (serviceScope === "outside" || serviceScope === "unclear") {
        guidance = serviceScope === "outside" ? SERVICE_SCOPE_REFUSAL : SERVICE_SCOPE_CLARIFICATION;
        serviceGuidance = true;
      }
    }
    if (!guidance && interaction.forget_context) {
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

    const row = await this.repo.create("a-j-oker", {
      sessionId,
      requestKey,
      fingerprint: hash,
      mode,
      input,
      status: "running",
      model: guidance ? "product-guidance" : model,
      promptVersion: serviceGuidance ? SERVICE_SCOPE_VERSION : guidance ? INTERACTION_VERSION : mode === "external" ? "external-declared" : PROMPT_VERSION,
    });
    return { row, duplicate: false, guidance, imageRequested: interaction.image_requested, singleChoiceOnly: interaction.single_choice_only, singleOpenQuestionOnly: interaction.single_open_question_only ?? false, forgetContext: interaction.forget_context };
  }
  private async completeProductGuidance(id: number, guidance: string, specialist?: SpecialistState) {
    await assertGenerationAllowed(this.repo.payload, this.repo.owner.id);
    const row = await this.repo.get("a-j-oker", id);
    if (row.visibility === "quarantined") throw new AppError(403, "此轮内容已隔离，不能继续发布");
    const deterministicReturn = Boolean((row.input as Inspiration).action);
    if (row.status !== "running" || (row.model !== "product-guidance" && !deterministicReturn))
      throw new AppError(409, "本轮不再接受产品指引");
    // Only server-owned interaction, scope or forget guidance; never model text.
    // Public complete() has no bypass option and still reviews every supplied output.
    return this.repo.update("a-j-oker", id, {
      aJoker: guidance,
      association: deterministicReturn ? "本人明确选择结束专家协作，系统完成路由切换。" : "产品操作与安全指引",
      artifacts: [], approach: "supportive", status: "completed",
      ...(specialist ? { specialist: {
        ...specialist,
        status: "completed" as const,
        sources: [],
        currentTask: deterministicReturn ? "本人已返回阿 J" : "已按隐私请求结束",
      } } : {}),
    });
  }
  async complete(id: number, value: AJoker, reviewKey?: string, specialist?: SpecialistState) {
    await assertGenerationAllowed(this.repo.payload, this.repo.owner.id);
    const output = aJokerSchema.parse(value);
    const row = await this.repo.get("a-j-oker", id);
    if (row.visibility === "quarantined") throw new AppError(403, "此轮内容已隔离，不能继续发布");
    if (row.status === "completed") {
      if (
        row.aJoker !== output.aJoker ||
        row.association !== output.association ||
        fingerprint(row.artifacts ?? []) !== fingerprint(output.artifacts ?? []) ||
        (row.approach ?? undefined) !== output.approach
      )
        throw new AppError(409, "本轮产物已保存，不能覆盖");
      return row;
    }
    if (row.status !== "running") throw new AppError(409, "本轮不再接受产物");
    const originalText = String((row.input as Inspiration).text || "");
    const imageState = readImageState(row);
    // Covers both generated media and geometry illustrations, including reuse.
    if (output.artifacts?.some((artifact) => artifact.kind === "image")) {
      try {
        assertImageGenerationReview(await this.moderate({ stage: "input", purpose: "image_generation", mode: row.mode,
          texts: [originalText],
          serviceScope: true, interaction: true,
          context: JSON.stringify(await new ContextService(this.repo).reviewContext(Number(row.sessionId))), requestId: `image-save-intent:${row.id}`,
          turnId: row.id, sessionId: Number(row.sessionId), apiKey: reviewKey ?? process.env.DEEPSEEK_API_KEY }));
      } catch (error) {
        if (imageState && error instanceof ContentReviewError && error.status === 422)
          await this.repo.update("a-j-oker", row.id, { imageGeneration: { ...imageState, status: "blocked" } });
        throw error;
      }
    }
    const hasImageArtifact = Boolean(output.artifacts?.some((artifact) => artifact.kind === "image"));
    if (imageState?.status === "blocked" && hasImageArtifact)
      throw new AppError(422, "原图片请求已被拒绝，不能改用替代图片");
    if (imageState && (imageState.status !== "blocked") && (imageState.status !== "stored" || !output.artifacts?.some((artifact) =>
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
    const requiresArtifactScope = Boolean(output.artifacts?.length);
    const outputReview = await this.moderate({
      stage: "output", mode: row.mode, texts: textLeaves(output), context: (row.input as Inspiration).text,
      serviceScope: requiresArtifactScope,
      requestId: String(row.requestKey), turnId: row.id, sessionId: Number(row.sessionId), apiKey: reviewKey ?? process.env.DEEPSEEK_API_KEY,
    });
    if (requiresArtifactScope) {
      const scopeReview = requiredOutputReviewSchema.safeParse(outputReview);
      if (!scopeReview.success) throw new ContentReviewError(503, "作品范围审核暂未完成，请稍后重试");
      if (scopeReview.data.serviceScope !== "support") throw new AppError(422, CREATION_REFUSAL);
    }
    return this.repo.update("a-j-oker", id, {
      ...output,
      ...(specialist ? { specialist: specialistStateSchema.parse(specialist) } : {}),
      status: "completed",
    });
  }
  async resumeImage(turnId: number, apiKey?: string, progress?: (stage: GenerationProgress) => void) {
    const row = await this.repo.get("a-j-oker", turnId);
    if (row.status === "completed") return row;
    if (!canResumeImage(row) || row.mode === "external") throw new AppError(409, "这次图片任务不能继续，请查看本轮状态");
    return this.generateAJoker({ sessionId: row.sessionId, requestId: String(row.requestKey).slice(this.repo.owner.id.length + 1), input: row.input, mode: row.mode, apiKey }, progress, row.id);
  }
  async generateAJoker(value: unknown, progress?: (stage: GenerationProgress) => void, resumeTurnId?: number) {
    const args = turnSchema.parse(value);
    const key =
      args.mode === "byok" ? args.apiKey : process.env.DEEPSEEK_API_KEY;
    if (!key && !args.input.action)
      throw new AppError(
        503,
        args.mode === "byok"
          ? "请填写本次使用的 DeepSeek API Key"
          : "平台尚未配置 DeepSeek API Key，可先使用 BYOK 或外部 Agent",
      );
    const model = process.env.HELLO_MODEL || DEFAULT_MODEL;
    const release = await this.repo.acquire(args.sessionId);
    return release.run(async () => {
    let row: AJokerRecord | undefined;
    let reviewFailure: ContentReviewError | ServiceProblemError | undefined;
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
      // Replay wins over current-state checks: a retried successful return must
      // remain idempotent after that return has closed the task.
      if (result.duplicate) return row;
      const committed = await this.repo.all("a-j-oker", { sessionId: { equals: args.sessionId } });
      const forgottenThroughId = await new ContextService(this.repo).forgottenThroughId(args.sessionId);
      const preActive = activeSpecialistFromTurns(committed, forgottenThroughId);
      if (args.input.action) {
        if (!specialistActionMatches(preActive, args.input.action))
          throw new AppError(409, "专家任务已经结束或发生变化，请刷新后再操作");
      }
      if (args.input.formResponse) {
        const source = committed.find((item) => item.id === args.input.formResponse!.turnId);
        const sourceState = source?.specialist ? specialistStateSchema.safeParse(source.specialist) : undefined;
        if (source?.specialist) {
          if (!sourceState?.success || !preActive || sourceState.data.taskId !== preActive.state.taskId)
            throw new AppError(409, "该表单不属于当前专家任务或已经过期");
          const response = args.input.formResponse;
          const alreadyAnswered = committed.some((item) => {
            if (item.id === row!.id || item.status !== "completed") return false;
            const input = item.input as Inspiration;
            return input.formResponse?.turnId === response.turnId
              && input.formResponse.artifactId === response.artifactId;
          });
          if (alreadyAnswered) throw new AppError(409, "该表单已经提交，请刷新查看结果");
          const hasForm = (item: AJokerRecord) => {
            try {
              return legacyArtifactsSchema.parse(item.artifacts ?? [], { jitless: true })
                .some((artifact) => artifact.kind === "form");
            } catch { return false; }
          };
          const newerForm = committed.some((item) => {
            if (item.id <= source.id || item.id === row!.id || item.status !== "completed" || !item.specialist)
              return false;
            const state = specialistStateSchema.safeParse(item.specialist);
            return state.success && state.data.taskId === preActive.state.taskId && hasForm(item);
          });
          if (newerForm) throw new AppError(409, "专家已发送更新的表单，请填写最新一份");
        }
      }
      if (args.input.action) {
        const active = preActive!.state;
        return await this.completeProductGuidance(
          row.id,
          "这段专家协作已结束，接下来由阿 J 先生继续陪你聊。",
          active,
        );
      }
      if (result.guidance) {
        let specialist: SpecialistState | undefined;
        if (result.forgetContext) {
          const previous = (await this.repo.all("a-j-oker", { sessionId: { equals: args.sessionId } }))
            .filter((item) => item.id !== row!.id && item.status === "completed" && item.specialist)
            .sort((a, b) => a.id - b.id).at(-1);
          const parsed = previous?.specialist ? specialistStateSchema.safeParse(previous.specialist) : undefined;
          if (parsed?.success && parsed.data.status === "active") specialist = parsed.data;
        }
        return await this.completeProductGuidance(row.id, result.guidance, specialist);
      }
      if (args.mode === "platform") await reservePlatformCalls(this.repo.payload, AJOKER_MAX_CALLS);
      const images = new ImageGenerationService(this.repo, this.media, this.moderate, this.imageReviewer, this.imageProvider);
      const imageState = readImageState(row);
      // begin() has both authenticated this response against its source form
      // and replaced keyword text with server-generated labels. A submission
      // is therefore an answer turn, not a new request for that same form.
      const validatedFormSubmission = Boolean(args.input.formResponse);
      const active = activeSpecialistFromTurns(
        (await this.repo.all("a-j-oker", { sessionId: { equals: args.sessionId } })).filter((item) => item.id !== row!.id),
        forgottenThroughId,
      );
      const activeSpecialist = active?.state;
      await this.generate({
        repo: this.repo,
        signal: release.signal,
        turnId: row.id,
        sessionId: args.sessionId,
        input: row.input,
        apiKey: key!,
        model,
        readImage: (id) => this.media.read(id),
        generateImage: (input, signal) => images.generate(row!.id, input, signal, key, progress),
        existingImage: imageState?.status === "stored" && imageState.mediaId ? { mediaId: imageState.mediaId, title: imageState.input.title, alt: imageState.input.alt } : undefined,
        resumingImage: !!resumeTurnId,
        imageRequested: result.imageRequested,
        singleChoiceOnly: validatedFormSubmission ? false : result.singleChoiceOnly,
        singleOpenQuestionOnly: validatedFormSubmission ? false : result.singleOpenQuestionOnly,
        activeSpecialist,
        onStage: progress,
        saveHandoffPreamble: async (preamble) => {
          const value = handoffPreambleSchema.parse(preamble);
          const current = await this.repo.get("a-j-oker", row!.id);
          if (current.status !== "running")
            throw new AppError(409, "本轮不再接受专家交接前导");
          try {
            await assertGenerationAllowed(this.repo.payload, this.repo.owner.id);
            if (current.visibility === "quarantined")
              throw new AppError(403, "此轮内容已隔离，不能继续发布");
            if (current.handoffPreamble) {
              if (current.handoffPreamble === value) return current.handoffPreamble;
              throw new AppError(409, "本轮专家交接前导已保存，不能覆盖");
            }
            await this.moderate({
              stage: "output",
              mode: current.mode,
              texts: [value],
              context: String((current.input as Inspiration).text || ""),
              requestId: `handoff-preamble-output:${row!.id}:${randomUUID()}`,
              turnId: row!.id,
              sessionId: Number(row!.sessionId),
              apiKey: key ?? process.env.DEEPSEEK_API_KEY,
            });
            await this.repo.update("a-j-oker", row!.id, {
              handoffPreamble: value,
            });
            return value;
          } catch (error) {
            if (
              error instanceof ContentReviewError
              || error instanceof ServiceProblemError
            )
              reviewFailure = error;
            throw error;
          }
        },
        executionId: resumeTurnId ? `${row.id}:${randomUUID()}` : undefined,
        save: async (output, specialist) => {
          try {
            // Real render-preparation point: artifacts exist and now go
            // through review/persistence before client presentation.
            const stage = renderProgress(output.artifacts, !!specialist);
            if (stage) progress?.(stage);
            return await this.complete(row!.id, output, key!, specialist);
          } catch (error) {
            // ADK may convert a thrown tool error to an event; preserve its safe verdict.
            if (
              error instanceof ContentReviewError
              || error instanceof ServiceProblemError
            )
              reviewFailure = error;
            throw error;
          }
        },
      });
      const saved = await this.repo.get("a-j-oker", row.id);
      if (saved.status !== "completed")
        throw new AppError(502, "模型没有调用保存工具，本轮未产生吉祥话");
      return await this.repo.update("a-j-oker", row.id, {
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (row) {
        const saved = await this.repo.get("a-j-oker", row.id);
        // 工具已经成功保存时，后续说明或事件失败不能把成功产物标为失败。
        if (saved.status === "completed") return saved;
        const blockImage = (
          error instanceof ContentReviewError
          || reviewFailure instanceof ContentReviewError
        ) && !(error instanceof ImageReviewUnavailableError)
          && !(reviewFailure instanceof ImageReviewUnavailableError);
        const effectiveFailure = reviewFailure ?? (error instanceof AppError ? error : undefined);
        await this.repo.update("a-j-oker", row.id, {
          status: "failed",
          error: effectiveFailure?.message ?? "模型调用或保存失败，请检查配置后重试",
          durationMs: Date.now() - started,
          ...(blockImage && saved.imageGeneration
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
    let pending: AJokerRecord | undefined;
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
        const row = await this.repo.get("a-j-oker", pending.id);
        if (row.status === "running") await this.repo.update("a-j-oker", row.id, { status: "failed", error: "外部回应作品未能通过校验或保存" });
      }
      throw error;
    } finally {
      await release();
    }
    });
  }
}
