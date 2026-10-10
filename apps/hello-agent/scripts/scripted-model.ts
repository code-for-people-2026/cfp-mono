import { BaseLlm, type LlmRequest, type LlmResponse } from "@google/adk";
import type { Greeting } from "@cfp/hello-agent-contracts";

// 仅供测试使用。生产运行模块不导入这个文件。
export class ScriptedModel extends BaseLlm {
  requests: LlmRequest[] = [];
  constructor(
    private output: Greeting = {
      greeting: "愿你的日子像这份灵感一样，温暖明亮，顺心开花。",
      association:
        "测试模型的固定响应，用于验证工具与持久化，不是模型质量证据。",
    },
  ) {
    super({ model: "scripted-test-only" });
  }
  async *generateContentAsync(
    request: LlmRequest,
  ): AsyncGenerator<LlmResponse, void> {
    this.requests.push(request);
    yield {
      content: {
        role: "model",
        parts: [
          {
            functionCall: {
              id: "test-call",
              name: "save_greeting",
              args: this.output,
            },
          },
        ],
      },
    };
  }
  async connect(): Promise<never> {
    throw new Error("测试模型不支持实时连接");
  }
}
