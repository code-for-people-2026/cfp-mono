import { LlmAgent, Runner, FunctionTool, type BaseLlm } from "@google/adk";
import { FunctionCallingConfigMode, type Part } from "@google/genai";
import { Repository } from "../cms/repository";
import {
  AppError,
  greetingSchema,
  type Greeting,
  type Inspiration,
} from "../domain/contracts";
import { GREETING_INSTRUCTION } from "./instruction";
import { PayloadSessionService } from "./payload-session-service";
import { DeepSeekModel } from "./deepseek-model";
import { ContextService } from "../domain/context";
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
        currentInput: request.input.text,
        attachedImageCount: media.length,
      }),
    },
    ...media.map((row) => ({
      inlineData: { data: row.bytes.toString("base64"), mimeType: row.mimeType },
    })),
  ];
  const model =
    modelOverride ||
    new DeepSeekModel({
      model: request.model,
      apiKey: request.apiKey,
    });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  const save = new FunctionTool({
    name: "save_greeting",
    description:
      "保存本轮生成的中文吉祥话及其与输入的关联。不能写入其他用户或轮次。",
    parameters: greetingSchema,
    execute: async (output, context) => {
      if (controller.signal.aborted) throw new AppError(408, "生成已超时");
      const result = await request.save(greetingSchema.parse(output));
      if (context) context.actions.skipSummarization = true;
      return result;
    },
  });
  const agent = new LlmAgent({
    name: "greeting_agent",
    model,
    instruction: GREETING_INSTRUCTION,
    tools: [save],
    generateContentConfig: {
      maxOutputTokens: 2048,
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ["save_greeting"],
        },
      },
    },
  });
  const sessionService = new PayloadSessionService(request.repo);
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
      runConfig: { maxLlmCalls: 3 },
    })) {
      if (event.errorCode) throw new AppError(502, "模型未能完成本轮生成");
    }
  } finally {
    clearTimeout(timer);
  }
}
