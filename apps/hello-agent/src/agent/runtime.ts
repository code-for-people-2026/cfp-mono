import { Runner, type BaseLlm } from "@google/adk";
import type { Part } from "@google/genai";
import { Repository } from "../cms/repository";
import { AppError, type Greeting, type Inspiration } from "../domain/contracts";
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
  const timer = setTimeout(() => controller.abort(), 75_000);
  const sessionService = new PayloadSessionService(request.repo);
  const agent = createGreetingAgent({
    model,
    configuration,
    sessionService,
    userId: request.repo.owner.id,
    turnSessionId: String(request.turnId),
    inputParts: parts,
    signal: controller.signal,
    save: async (value) => {
      try { return await request.save(value); }
      catch (error) {
        if (error instanceof AppError && error.status === 403) controller.abort();
        throw error;
      }
    },
  });
  const runner = new Runner({ appName: "hello_agent", agent, sessionService });
  try {
    await sessionService.createSession({
      appName: "hello_agent",
      userId: request.repo.owner.id,
      sessionId: String(request.turnId),
    });
    for await (const event of runner.runAsync({
      userId: request.repo.owner.id,
      sessionId: String(request.turnId),
      newMessage: { role: "user", parts },
      abortSignal: controller.signal,
      runConfig: { maxLlmCalls: COORDINATOR_MAX_CALLS },
    })) {
      if (event.errorCode) throw new AppError(502, "模型未能完成本轮生成");
    }
  } finally {
    clearTimeout(timer);
  }
}
