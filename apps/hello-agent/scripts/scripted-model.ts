import { BaseLlm, type LlmRequest, type LlmResponse } from "@google/adk";

// 仅供测试使用。生产运行模块不导入这个文件。
export class ScriptedModel extends BaseLlm {
  requests: LlmRequest[] = [];
  private outputIndex = 0;
  constructor(
    private output: Record<string, unknown> | Record<string, unknown>[] = {
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
    const output = Array.isArray(this.output)
      ? this.output[Math.min(this.outputIndex, this.output.length - 1)]
      : this.output;
    const approach = output.approach;
    const consulted = request.contents.some((content) =>
      content.parts?.some(
        (part) => part.functionResponse?.name === `${approach}_agent`,
      ),
    );
    let name: string;
    let args: Record<string, unknown>;
    if (request.toolsDict.submit_psychology_plan) {
      name = "submit_psychology_plan";
      args = {
        summary: "用于链路验证的固定方案",
        suggestions: ["测试建议"],
        needsImmediateSupport: false,
      };
    } else if (
      typeof approach === "string" &&
      approach !== "supportive" &&
      !consulted
    ) {
      name = `${approach}_agent`;
      args = {
        request: "测试本流派的方案交接",
        urgency: "routine",
        knowledgeQuery: "认知重构",
      };
    } else {
      name = "save_greeting";
      args = output;
      this.outputIndex++;
    }
    yield {
      content: {
        role: "model",
        parts: [
          {
            functionCall: {
              id: `test-call-${this.requests.length}`,
              name,
              args,
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
