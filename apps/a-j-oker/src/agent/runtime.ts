import { imagePromptConstraints, restCardDeliveryError } from "./rest-card";
import { ImageDecision, imageDecisionSchema } from "./image-decision";
import { imageRequestSchema, type ImageRequest } from "../images/wan";
import type { GeneratedImage } from "../images/service";
import { Runner, FunctionTool, type BaseLlm, type RunAsyncToolRequest } from "@google/adk";
import type { Part } from "@google/genai";
import { Repository } from "../cms/repository";
import { AppError, ContentReviewError, ServiceProblemError, type GenerationProgress, type AJoker, type Inspiration } from "../domain/contracts";
import { loadAgentConfiguration } from "./configuration";
import { createAJokerAgent } from "./coordinator";
import { createPsychologyTeam } from "./psychology-agents";
import type { SpecialistState } from "./specialist-state";
import { PayloadSessionService } from "./payload-session-service";
import { DeepSeekModel } from "./deepseek-model";
import { DeepSeekError } from "../models/deepseek";
import { ContextService } from "../domain/context";
import { COORDINATOR_MAX_CALLS, MODEL_TRANSIENT_MAX_ATTEMPTS } from "./limits";
import {
  AJ_A2A_TENANT,
  createInProcessPsychologyA2AFactory,
} from "./psychology-a2a";
import { createPayloadA2AStorage } from "../cms/a2a-store";
import { constrainedFormDeliveryError } from "./single-choice-delivery";
import { KNOWLEDGE_METHODS } from "./knowledge-query";
import { formResponseGuidance } from "./form-response-guidance";
import {
  isConfirmedCompletedA2AResponse,
  loadA2AFaultPolicy,
} from "./devtools-faults";

import type { AJoker as AJokerRecord } from "../payload-types";

// Require a completed decision step, not parallel allow/refuse and generation.
class ImageGenerationTool extends FunctionTool<typeof imageRequestSchema> {
  override async runAsync(request: RunAsyncToolRequest) {
    const event = request.toolContext.invocationContext.session.events.findLast(event =>
      event.content?.parts?.some(part => part.functionCall?.id === request.toolContext.functionCallId));
    if (event?.content?.parts?.some(part => ["decide_image_request", "save_a_j_oker"].includes(part.functionCall?.name || ""))) {
      return { error: "生图必须在原始请求判断完成之后单独调用，不能与判断或保存回复并行。" };
    }
    return super.runAsync(request);
  }
}
export type GenerationRequest = {
  repo: Repository;
  turnId: number;
  sessionId: number;
  input: Inspiration;
  apiKey: string;
  model: string;
  readImage: (id: number) => Promise<{ bytes: Buffer; mimeType: string }>;
  save: (aJoker: AJoker, specialist?: SpecialistState) => Promise<AJokerRecord>;
  generateImage?: (input: ImageRequest, signal: AbortSignal) => Promise<GeneratedImage>;
  existingImage?: GeneratedImage;
  resumingImage?: boolean;
  imageRequested?: boolean;
  singleChoiceOnly?: boolean;
  singleOpenQuestionOnly?: boolean;
  executionId?: string;
  signal?: AbortSignal;
  activeSpecialist?: SpecialistState;
  onStage?: (stage: GenerationProgress) => void;
  saveHandoffPreamble: (preamble: string) => Promise<string>;
};
export type Generator = (request: GenerationRequest) => Promise<void>;

// 测试可注入脚本模型；运行环境没有“伪模型”开关，不会把假回复当真实生成。
export async function runAJoker(
  request: GenerationRequest,
  modelOverride?: BaseLlm,
) {
  const configuration = await loadAgentConfiguration(request.repo.payload);
  const media = await Promise.all(
    request.input.mediaIds.map((id) => request.readImage(id)),
  );
  const context = await new ContextService(request.repo).modelContext(
    request.sessionId,
  );
  const parts: Part[] = [
    {
      text: JSON.stringify({
        ...context,
        configurationRevision: configuration.revision,
        currentInput: request.input.text,
        attachedImageCount: media.length,
        attachedMediaIds: request.input.mediaIds,
        formResponse: request.input.formResponse,
        generatedImage: request.existingImage,
        resumingImage: request.resumingImage,
      }),
    },
    ...media.map((row) => ({
      inlineData: {
        data: row.bytes.toString("base64"),
        mimeType: row.mimeType,
      },
    })),
  ];
  const responseGuidance = formResponseGuidance(request.input);
  const faultPolicy = await loadA2AFaultPolicy({ owner: request.repo.owner.id });
  const logFault = (category: string, attempt: number) => {
    console.info(
      `aj a2a-recovery owner_id=${request.repo.owner.id} execution_id=${request.executionId ?? request.turnId} category=${category} attempt=${attempt}`,
    );
  };
  let modelFaultConsumed = false;
  const model =
    modelOverride ||
    new DeepSeekModel({
      model: request.model,
      apiKey: request.apiKey,
      retry: {
        maxAttempts: MODEL_TRANSIENT_MAX_ATTEMPTS,
        retryDelayMs: 100,
        maxRetryDelayMs: 500,
      },
    });
  let activeModel = model;
  if (
    !modelOverride
    && request.activeSpecialist
    && faultPolicy.enabled
    && faultPolicy.failFirstModelAttempt
  ) {
    activeModel = new DeepSeekModel({
      model: request.model,
      apiKey: request.apiKey,
      retry: {
        maxAttempts: MODEL_TRANSIENT_MAX_ATTEMPTS,
        retryDelayMs: 100,
        maxRetryDelayMs: 500,
      },
      beforeAttempt: ({ attempt }) => {
        if (modelFaultConsumed) {
          if (attempt === 2) logFault("model_retry", attempt);
          return;
        }
        modelFaultConsumed = true;
        logFault("model_fault_consumed", attempt);
        throw new DeepSeekError(
          "DeepSeek 请求失败（HTTP 503）",
          "http",
          503,
        );
      },
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.generateImage ? 180_000 : 75_000);
  const signal = request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal;
  let imageInFlight: Promise<GeneratedImage> | undefined;
  let imageFailure: unknown;
  let generatedMediaId = request.existingImage?.mediaId;
  const imageDecision = new ImageDecision();
  const imageAdmitted = request.imageRequested === true || request.resumingImage === true;
  const imageToolsEnabled = request.generateImage !== undefined && imageAdmitted;
  const imageDecisionTool = imageToolsEnabled ? new FunctionTool({
    name: "decide_image_request",
    description: "调用生图前先判断本轮原始请求。需要拒绝时选择 refuse；不能确定原始意图是否安全时选择 uncertain，同样停止生图，不猜测意图；不得因为可以改成公益或反向作品而允许。refuse 后本轮仅可保存简短文字拒绝，不能生成或附带替代作品。",
    parameters: imageDecisionSchema,
    execute: async (input) => imageDecision.record(imageDecisionSchema.parse(input)),
  }) : undefined;
  const imageTool = imageToolsEnabled ? new ImageGenerationTool({
    name: "generate_image",
    description: "根据当前用户明确的图片需求调用万相文生图，一轮最多一张。输入只包含必要的画面描述；不支持修改上传原图。结果为已审核并保存的媒体编号，随后必须用 save_a_j_oker 将它作为 image 回应作品。",
    parameters: imageRequestSchema,
    execute: async (input) => {
      if (!imageAdmitted) {
        imageDecision.record({ decision: "refuse", reason: "不属于明确的心理支持图片请求" });
        return { error: "本轮没有明确的语义图片请求，禁止生图或生成替代图。" };
      }
      if (!imageDecision.allowed) return { error: imageDecision.refused
        ? "本轮原始请求已拒绝，禁止生图或生成替代图。请仅保存简短文字拒绝。"
        : "尚未判断原始请求，请先单独调用 decide_image_request，再根据结果决定是否生图。" };
      const parsed = imageRequestSchema.safeParse(input);
      if (!parsed.success) return { error: "请提供 prompt、title、alt 和 aspectRatio（square、portrait 或 landscape）" };
      signal.throwIfAborted();
      if (!imageInFlight) {
        const prompt = `${parsed.data.prompt.slice(0, 1400)}
画面硬性约束：
${imagePromptConstraints()}`;
        imageInFlight = request.generateImage!({ ...parsed.data, prompt }, signal);
      }
      try { const image = await imageInFlight; generatedMediaId = image.mediaId; return image; }
      catch (error) { imageFailure = error; controller.abort(); throw error; }
    },
  }) : undefined;

  const sessionService = new PayloadSessionService(request.repo);
  const executionId = request.executionId || String(request.turnId);
  const a2aStorage = createPayloadA2AStorage(request.repo, AJ_A2A_TENANT);
  const { taskStore, requestLedger, recoverTask } = a2aStorage;
  let transportAttempts = 0;
  const transportIntercept = faultPolicy.enabled
    && (faultPolicy.failFirstSendBeforeExecution || faultPolicy.loseFirstResponseAfterCommit)
    ? async (input: RequestInfo | URL, init: RequestInit | undefined, next: typeof fetch) => {
      const probe = new Request(input, init);
      if (probe.method !== "POST") return next(input, init);
      transportAttempts++;
      logFault("transport_attempt", transportAttempts);
      if (faultPolicy.failFirstSendBeforeExecution && transportAttempts === 1) {
        logFault("pre_execution_transport_failure", transportAttempts);
        throw new TypeError("local A2A recovery fixture");
      }
      const response = await next(input, init);
      if (
        faultPolicy.loseFirstResponseAfterCommit
        && transportAttempts === 1
        && await isConfirmedCompletedA2AResponse(response)
      ) {
        logFault("response_loss_after_commit", transportAttempts);
        throw new TypeError("local A2A recovery fixture");
      }
      return response;
    }
    : undefined;
  const a2aFactory = createInProcessPsychologyA2AFactory({
    principal: { owner: request.repo.owner.id, tenant: AJ_A2A_TENANT },
    taskStore,
    requestLedger,
    recoverTask,
    transportIntercept,
    expertTelemetry: faultPolicy.enabled
      ? event => logFault(event.category, event.attempt)
      : undefined,
  });
  if (request.activeSpecialist) {
    const active = request.activeSpecialist;
    const current = configuration.specialists.find((item) => item.approach === active.expertId);
    if (!current) {
      await request.save({
        aJoker: "该专家配置当前已停用；本轮任务已明确结束，未生成专家方案。可继续由阿 J 回应，之后可在专家重新启用后再试。",
        association: "专家配置停用；系统明确结束交接，未伪装成专家完成。",
        approach: "supportive",
        artifacts: [],
      }, { ...active, status: "unavailable", sources: [] });
      clearTimeout(timer);
      return;
    }
    const pinned = {
      ...current,
      prompt: active.prompt,
      revision: active.configurationRevision,
      theme: active.theme,
      preferredLayout: active.layout,
      subtitle: active.subtitle ?? current.subtitle,
      avatarReference: active.avatarReference ?? current.avatarReference,
      allowedComponents: active.allowedComponents,
      preferredComponents: active.preferredComponents,
    };
    const directConfiguration = { ...configuration, specialists: [pinned] };
    const team = createPsychologyTeam({
      model: activeModel,
      configuration: directConfiguration,
      sessionService,
      userId: request.repo.owner.id,
      turnSessionId: executionId,
      consultationExecutionId: String(request.turnId),
      inputParts: parts,
      signal,
      onStage: request.onStage,
      responseGuidance,
      a2a: a2aFactory,
      localFaults: faultPolicy.enabled
        ? {
          rejectFirstTwoExpertSubmissions: faultPolicy.rejectFirstTwoExpertSubmissions,
          onEvent: event => logFault(event.category, event.attempt),
        }
        : undefined,
      checkDelivery: value => constrainedFormDeliveryError(request, value)
        || restCardDeliveryError(imageAdmitted, value, generatedMediaId, imageDecision.refused),
      deliverExpert: async ({ plan }) => request.save(plan.reply!, {
        ...active,
        ...(active.subtitle || !current.subtitle ? {} : { subtitle: current.subtitle }),
        status: plan.lifecycle === "complete" ? "completed" : "active",
        sources: plan.references.flatMap((source) =>
          source.excerpt && (source.readStatus === "snippet" || source.readStatus === "document")
            ? [{ library: source.library, title: source.title, readStatus: source.readStatus }]
            : [],
        ),
        currentTask: `${active.currentTask.split("\n最新进展：")[0]}\n最新进展：${plan.summary}`.slice(0, 1200),
      }),
    });
    try {
      const outcome = await team.consultDirect(active.expertId, {
        request: active.currentTask,
        urgency: "routine",
        ...(current.knowledge ? { knowledgeQuery: KNOWLEDGE_METHODS[active.expertId][0] } : {}),
      });
      if (outcome.status === "completed" && modelFaultConsumed) {
        logFault("model_success", 1);
      }
      if (outcome.status !== "completed")
        throw new AppError(503, "专家本轮未完成，任务仍保留，可稍后重试或返回阿 J");
      return;
    } finally {
      clearTimeout(timer);
    }
  }
  const agent = createAJokerAgent({
    imageTool,
    imageDecisionTool,
    model,
    configuration,
    sessionService,
    userId: request.repo.owner.id,
    turnSessionId: executionId,
    // Stable across process/image-resume executions: a persisted pending task
    // is reported unavailable, while a validated completed result is recovered.
    consultationExecutionId: String(request.turnId),
    inputParts: parts,
    signal,
    onStage: request.onStage,
    saveHandoffPreamble: async (preamble) => {
      try {
        return await request.saveHandoffPreamble(preamble);
      } catch (error) {
        if (
          error instanceof ContentReviewError
          || error instanceof ServiceProblemError
          || (error instanceof AppError && error.status === 403)
        )
          controller.abort();
        throw error;
      }
    },
    responseGuidance,
    a2a: a2aFactory,
    localFaults: faultPolicy.enabled
      ? {
        rejectFirstTwoExpertSubmissions: faultPolicy.rejectFirstTwoExpertSubmissions,
        onEvent: event => logFault(event.category, event.attempt),
      }
      : undefined,
    checkDelivery: value => constrainedFormDeliveryError(request, value)
      || restCardDeliveryError(imageAdmitted, value, generatedMediaId, imageDecision.refused),
    save: async (value, specialist) => {
      if (generatedMediaId && !imageDecision.refused)
        value = { ...value, aJoker: "心理支持图片已生成，可查看下方图片。", association: "根据本轮明确的心理支持制图需求生成图片；制图素材不代表已核实的本人状态或已执行的设置变更。" };
      if (!imageAdmitted && value.artifacts?.some(a => a.kind === "image")) {
        imageDecision.record({ decision: "refuse", reason: "未明确请求范围内的心理支持图片" });
      }
      if (imageInFlight) await imageInFlight;
      try { return await request.save(imageDecision.refused ? { ...value, aJoker: "抱歉，这个图片请求不能执行，本次不会生成图片。", association: "原始图片请求已拒绝，不生成替代作品。", artifacts: [] } : value, specialist); }
      catch (error) {
        if (
          error instanceof ContentReviewError
          || error instanceof ServiceProblemError
          || (error instanceof AppError && error.status === 403)
        )
          controller.abort();
        throw error;
      }
    },
  });
  const runner = new Runner({ appName: "hello_agent", agent, sessionService });
  try {
    await sessionService.createSession({
      appName: "hello_agent",
      userId: request.repo.owner.id,
      sessionId: executionId,
    });
    for await (const event of runner.runAsync({
      userId: request.repo.owner.id,
      sessionId: executionId,
      newMessage: { role: "user", parts },
      abortSignal: signal,
      runConfig: { maxLlmCalls: COORDINATOR_MAX_CALLS },
    })) {
      if (event.errorCode) throw new AppError(502, "模型未能完成本轮生成");
    }
    if (imageFailure) throw imageFailure;
  } catch (error) {
    throw imageFailure || error;
  } finally {
    clearTimeout(timer);
  }
}
