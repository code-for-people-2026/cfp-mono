import { imageRequestSchema, type ImageRequest } from "../images/wan";
import type { GeneratedImage } from "../images/service";
import { Runner, FunctionTool, type BaseLlm } from "@google/adk";
import type { Part } from "@google/genai";
import { Repository } from "../cms/repository";
import { AppError, ContentReviewError, type Greeting, type Inspiration } from "../domain/contracts";
import { loadAgentConfiguration } from "./configuration";
import { createGreetingAgent } from "./coordinator";
import { PayloadSessionService } from "./payload-session-service";
import { DeepSeekModel } from "./deepseek-model";
import { ContextService } from "../domain/context";
import { COORDINATOR_MAX_CALLS } from "./limits";

import type { Greeting as GreetingRecord } from "../payload-types";

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
  executionId?: string;
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
  let imageInFlight: Promise<GeneratedImage> | undefined;
  let imageFailure: unknown;
  const imageTool = request.generateImage ? new FunctionTool({
    name: "generate_image",
    description: "根据当前用户明确的图片需求调用万相文生图，一轮最多一张。输入只包含必要的画面描述；不支持修改上传原图。结果为已审核并保存的媒体编号，随后必须用 save_greeting 将它作为 image 回应作品。",
    parameters: imageRequestSchema,
    execute: async (input) => {
      const parsed = imageRequestSchema.safeParse(input);
      if (!parsed.success) return { error: "请提供 prompt、title、alt 和 aspectRatio（square、portrait 或 landscape）" };
      if (!imageInFlight) imageInFlight = request.generateImage!(parsed.data, controller.signal);
      try { return await imageInFlight; }
      catch (error) { imageFailure = error; controller.abort(); throw error; }
    },
  }) : undefined;

  const sessionService = new PayloadSessionService(request.repo);
  const executionId = request.executionId || String(request.turnId);
  const agent = createGreetingAgent({
    imageTool,
    model,
    configuration,
    sessionService,
    userId: request.repo.owner.id,
    turnSessionId: executionId,
    inputParts: parts,
    signal: controller.signal,
    save: async (value) => {
      if (imageInFlight) await imageInFlight;
      try { return await request.save(value); }
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
      abortSignal: controller.signal,
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
