import { imagePromptConstraints, restCardDeliveryError } from "./rest-card";
import { ImageDecision, imageDecisionSchema } from "./image-decision";
import { imageRequestSchema, type ImageRequest } from "../images/wan";
import type { GeneratedImage } from "../images/service";
import { Runner, FunctionTool, type BaseLlm, type RunAsyncToolRequest } from "@google/adk";
import type { Part } from "@google/genai";
import { Repository } from "../cms/repository";
import { AppError, ContentReviewError, type Greeting, type Inspiration } from "../domain/contracts";
import { loadAgentConfiguration } from "./configuration";
import { createGreetingAgent } from "./coordinator";
import { PayloadSessionService } from "./payload-session-service";
import { DeepSeekModel } from "./deepseek-model";
import { ContextService } from "../domain/context";
import { COORDINATOR_MAX_CALLS } from "./limits";
import {
  AJ_A2A_TENANT,
  createInProcessPsychologyA2AFactory,
} from "./psychology-a2a";
import { createPayloadA2AStorage } from "../cms/a2a-store";

import type { Greeting as GreetingRecord } from "../payload-types";

// Require a completed decision step, not parallel allow/refuse and generation.
class ImageGenerationTool extends FunctionTool<typeof imageRequestSchema> {
  override async runAsync(request: RunAsyncToolRequest) {
    const event = request.toolContext.invocationContext.session.events.findLast(event =>
      event.content?.parts?.some(part => part.functionCall?.id === request.toolContext.functionCallId));
    if (event?.content?.parts?.some(part => ["decide_image_request", "save_greeting"].includes(part.functionCall?.name || ""))) {
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
  save: (greeting: Greeting) => Promise<GreetingRecord>;
  generateImage?: (input: ImageRequest, signal: AbortSignal) => Promise<GeneratedImage>;
  existingImage?: GeneratedImage;
  resumingImage?: boolean;
  imageRequested?: boolean;
  executionId?: string;
  signal?: AbortSignal;
};
export type Generator = (request: GenerationRequest) => Promise<void>;

// 测试可注入脚本模型；运行环境没有“伪模型”开关，不会把假回复当真实生成。
export async function runGreeting(
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
  const model =
    modelOverride ||
    new DeepSeekModel({
      model: request.model,
      apiKey: request.apiKey,
    });
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
    description: "根据当前用户明确的图片需求调用万相文生图，一轮最多一张。输入只包含必要的画面描述；不支持修改上传原图。结果为已审核并保存的媒体编号，随后必须用 save_greeting 将它作为 image 回应作品。",
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
  const { taskStore, requestLedger, recoverCompletedTask } = a2aStorage;
  const agent = createGreetingAgent({
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
    a2a: createInProcessPsychologyA2AFactory({
      principal: { owner: request.repo.owner.id, tenant: AJ_A2A_TENANT },
      taskStore,
      requestLedger,
      recoverCompletedTask,
    }),
    checkDelivery: value => restCardDeliveryError(
      imageAdmitted,
      value,
      generatedMediaId,
      imageDecision.refused,
    ),
    save: async (value) => {
      if (generatedMediaId && !imageDecision.refused)
        value = { ...value, greeting: "心理支持图片已生成，可查看下方图片。", association: "根据本轮明确的心理支持制图需求生成图片；制图素材不代表已核实的本人状态或已执行的设置变更。" };
      if (!imageAdmitted && value.artifacts?.some(a => a.kind === "image")) {
        imageDecision.record({ decision: "refuse", reason: "未明确请求范围内的心理支持图片" });
      }
      if (imageInFlight) await imageInFlight;
      try { return await request.save(imageDecision.refused ? { ...value, greeting: "抱歉，这个图片请求不能执行，本次不会生成图片。", association: "原始图片请求已拒绝，不生成替代作品。", artifacts: [] } : value); }
      catch (error) {
        if (error instanceof ContentReviewError || (error instanceof AppError && error.status === 403)) controller.abort();
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
