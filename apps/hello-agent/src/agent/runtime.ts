import {
  LlmAgent,
  Runner,
  FunctionTool,
  type BaseLlm,
  type RunAsyncToolRequest,
} from "@google/adk";
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

// ADK 默认在参数校验失败时中断运行；把可修复的作品格式错误回给模型，
// 保留严格校验和三次调用上限。存储、权限、供应商错误仍交由原错误路径处理。
class SaveResponseTool extends FunctionTool<typeof greetingSchema> {
  override async runAsync(request: RunAsyncToolRequest) {
    const result = greetingSchema.safeParse(request.args);
    if (!result.success)
      return {
        error:
          "回应尚未保存。请按工具 schema 修正这些字段后重新调用 save_greeting。",
        issues: result.error.issues.slice(0, 8).map((issue) => ({
          path: issue.path.join(".").slice(0, 160),
          message: issue.message.slice(0, 240),
        })),
      };
    return super.runAsync(request);
  }
}

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
  const timer = setTimeout(() => controller.abort(), 60_000);
  const save = new SaveResponseTool({
    name: "save_greeting",
    description:
      "保存阿J的回复、心理学回应视角和可选的卡片、表格、图片、网页或互动表单。图片可由几何插画描述生成。不能写入其他用户或轮次。",
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
      maxOutputTokens: 8192,
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
