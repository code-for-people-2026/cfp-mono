import { describe, expect, it, vi } from "vitest";
import {
  BaseLlm,
  InMemorySessionService,
  Runner,
  isAgentTool,
  type LlmRequest,
  type LlmResponse,
} from "@google/adk";
import type { Part } from "@google/genai";
import type { KnowledgeContext } from "./knowledge";
import { DEFAULT_AGENT_CONFIGS } from "./default-prompts";
import { createGreetingAgent } from "./coordinator";
import { PSYCHOLOGY_APPROACHES, type PsychologyApproach } from "./psychology";

const input: Part[] = [
  {
    text: JSON.stringify({
      memory: "用户喜欢散步",
      previous: [],
      currentInput: "已更正会议上的数字，但还在自责",
      formResponse: { values: { emotion: 0 } },
    }),
  },
  { inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } },
];
const plan = {
  summary: "区分事实与猜测",
  suggestions: ["先记一条事实"],
  needsImmediateSupport: false,
};
const reply = {
  greeting: "且慢，更正已经发出去了；余下的可以慢一点。",
  association: "用户已更正，仍在自责。",
};
type Call = { name: string; args: Record<string, unknown> };
function call(name: string, args: Record<string, unknown>): Call {
  return { name, args };
}
class WorkflowModel extends BaseLlm {
  requests: LlmRequest[] = [];
  constructor(
    private respond: (request: LlmRequest) => Call[] | Promise<Call[]>,
  ) {
    super({ model: "workflow-test-only" });
  }
  async *generateContentAsync(
    request: LlmRequest,
  ): AsyncGenerator<LlmResponse> {
    this.requests.push(request);
    const calls = await this.respond(request);
    yield {
      content: {
        role: "model",
        parts: calls.map((item) => ({
          functionCall: { ...item, id: crypto.randomUUID() },
        })),
      },
    };
  }
  async connect(): Promise<never> {
    throw new Error("No network in workflow tests");
  }
}
function fixture(
  steps: Call[][],
  specialist = () => [call("submit_psychology_plan", plan)],
  knowledge?: KnowledgeContext,
) {
  let step = 0;
  const model = new WorkflowModel((request) =>
    request.toolsDict.submit_psychology_plan
      ? specialist()
      : steps[Math.min(step++, steps.length - 1)],
  );
  const sessionService = new InMemorySessionService();
  const controller = new AbortController();
  const save = vi.fn(async (value: unknown) => ({ id: 11, output: value }));
  const knowledgeRead = vi.fn(async () => knowledge!);
  const agent = createGreetingAgent({
    configuration: {
      coordinator: DEFAULT_AGENT_CONFIGS[0].prompt,
      revision: "fixture",
      specialists: DEFAULT_AGENT_CONFIGS.slice(1).map((spec) => ({
        approach: spec.key as PsychologyApproach,
        label: spec.name,
        prompt: spec.prompt,
        revision: "fixture",
        knowledge:
          knowledge && spec.key === "cbt" ? knowledgeRead : undefined,
      })),
    },
    model,
    sessionService,
    userId: "owner",
    turnSessionId: "11",
    inputParts: input,
    signal: controller.signal,
    save,
  });
  const run = async () => {
    await sessionService.createSession({
      appName: "hello_agent",
      userId: "owner",
      sessionId: "11",
    });
    const runner = new Runner({
      appName: "hello_agent",
      agent,
      sessionService,
    });
    for await (const event of runner.runAsync({
      userId: "owner",
      sessionId: "11",
      newMessage: { role: "user", parts: input },
      abortSignal: controller.signal,
      runConfig: { maxLlmCalls: 5 },
    })) {
      if (event.errorCode) throw new Error(event.errorCode);
    }
  };
  return { model, sessionService, controller, save, agent, run, knowledgeRead };
}
const consult = (approach: string) =>
  call(`${approach}_agent`, {
    request: "请针对这次自责给一个可选练习，保留用户填写的 0 分。",
    urgency: "routine",
  });
const saveReply = (approach = "supportive") =>
  call("save_greeting", { ...reply, approach });

describe("主 Agent 与心理 subagent 的实际执行", () => {
  it("日常支持直接保存，专家注册为真正的 AgentTool，不额外调用模型", async () => {
    const f = fixture([[saveReply()]]);
    await f.run();
    expect(f.agent.tools.filter(isAgentTool).map((tool) => tool.name)).toEqual(
      Object.keys(PSYCHOLOGY_APPROACHES).map((name) => `${name}_agent`),
    );
    expect(f.model.requests).toHaveLength(1);
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(PSYCHOLOGY_APPROACHES) as PsychologyApproach[])(
    "%s 独立执行后把方案交还主 Agent，由主 Agent 唯一保存",
    async (approach) => {
      const f = fixture([[consult(approach)], [saveReply(approach)]]);
      await f.run();
      expect(f.model.requests).toHaveLength(3);
      const expert = f.model.requests[1];
      expect(Object.keys(expert.toolsDict)).toEqual(["submit_psychology_plan"]);
      expect(expert.config?.systemInstruction).toContain(
        `只负责 ${approach} 视角`,
      );
      expect(expert.config?.systemInstruction).not.toContain(
        "这嘴今日倒跑得快",
      );
      expect(expert.contents[0].parts?.slice(0, 2)).toEqual(input);
      expect(JSON.stringify(f.model.requests[2].contents)).toContain(
        plan.summary,
      );
      expect(f.save).toHaveBeenCalledExactlyOnceWith({ ...reply, approach });
      const session = await f.sessionService.getSession({
        appName: "hello_agent",
        userId: "owner",
        sessionId: `11:${approach}`,
      });
      expect(
        session?.events.some((event) => event.author === `${approach}_agent`),
      ).toBe(true);
      expect(
        session?.events.some((event) => event.author === "greeting_agent"),
      ).toBe(false);
    },
  );

  it("同一专家结果复用、每轮最多两个专家，不把第三个请求扩散成模型调用", async () => {
    const f = fixture([
      [consult("cbt")],
      [consult("cbt")],
      [consult("act")],
      [consult("dbt")],
      [saveReply("act")],
    ]);
    await f.run();
    expect(
      f.model.requests.filter(
        (request) => request.toolsDict.submit_psychology_plan,
      ),
    ).toHaveLength(2);
    expect(f.model.requests).toHaveLength(7);
    expect(JSON.stringify(f.model.requests.at(-1)?.contents)).toContain(
      "最多咨询两种流派",
    );
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it("同一批重复咨询仍只有一次专家执行", async () => {
    const f = fixture([[consult("cbt"), consult("cbt")], [saveReply("cbt")]]);
    await f.run();
    expect(f.model.requests).toHaveLength(3);
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it("未咨询专家不能把回复标为 CBT，主 Agent 可改为直接支持", async () => {
    const f = fixture([[saveReply("cbt")], [saveReply()]]);
    await f.run();
    expect(JSON.stringify(f.model.requests[1].contents)).toContain(
      "请先咨询对应的心理 subagent",
    );
    expect(f.save).toHaveBeenCalledExactlyOnceWith({
      ...reply,
      approach: "supportive",
    });
  });

  it("专家失败回到主 Agent，由它决定支持性回应，不泄漏原始错误", async () => {
    const f = fixture([[consult("cbt")], [saveReply()]], () => {
      throw new Error("private-provider-secret");
    });
    await f.run();
    const returned = JSON.stringify(f.model.requests.at(-1)?.contents);
    expect(returned).toContain("专家未完成");
    expect(returned).not.toContain("private-provider-secret");
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it("危险信号阻止练习作品和流派标签，主 Agent 转为直接安全关照", async () => {
    const f = fixture(
      [[consult("cbt")], [saveReply("cbt")], [saveReply()]],
      () => [
        call("submit_psychology_plan", {
          ...plan,
          needsImmediateSupport: true,
          artifacts: [
            {
              kind: "card",
              id: "practice",
              title: "练习",
              body: "不应出现在危险场景",
            },
          ],
        }),
      ],
    );
    await f.run();
    expect(JSON.stringify(f.model.requests.at(-1)?.contents)).toContain(
      "需要立即安全关照",
    );
    expect(f.save).toHaveBeenCalledExactlyOnceWith({
      ...reply,
      approach: "supportive",
    });
    const returned = f.model.requests[2].contents
      .flatMap((content) => content.parts ?? [])
      .find((part) => part.functionResponse)?.functionResponse?.response;
    expect(returned).toMatchObject({
      needsImmediateSupport: true,
      artifacts: [],
    });
  });

  it("专家方案格式错误可以在本轮修正，再由主 Agent 保存", async () => {
    let attempts = 0;
    const f = fixture([[consult("cbt")], [saveReply("cbt")]], () => {
      attempts++;
      return [
        call(
          "submit_psychology_plan",
          attempts === 1 ? { ...plan, suggestions: "不是列表" } : plan,
        ),
      ];
    });
    await f.run();
    expect(attempts).toBe(2);
    expect(f.model.requests).toHaveLength(4);
    expect(JSON.stringify(f.model.requests[2].contents)).toContain(
      "方案尚未提交",
    );
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it("同一批咨询与保存必须分开，主 Agent 读到专家结果后才能整合", async () => {
    const f = fixture([[consult("cbt"), saveReply("cbt")], [saveReply("cbt")]]);
    await f.run();
    expect(JSON.stringify(f.model.requests.at(-1)?.contents)).toContain(
      "咨询和保存不能放在同一批调用",
    );
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it("协调者标识眼前危险时跳过专家模型，直接回到主 Agent", async () => {
    const f = fixture([
      [
        call("supportive_agent", {
          request: "已经服药，需要立即安全关照",
          urgency: "immediate",
        }),
      ],
      [saveReply()],
    ]);
    await f.run();
    expect(f.model.requests).toHaveLength(2);
    expect(
      f.model.requests.every(
        (request) => !request.toolsDict.submit_psychology_plan,
      ),
    ).toBe(true);
    expect(JSON.stringify(f.model.requests[1].contents)).toContain(
      "眼前危险不等待专家",
    );
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it("取消会传到专家，取消之后不能保存", async () => {
    const f = fixture([[consult("cbt")], [saveReply()]], () => {
      f.controller.abort();
      return [call("submit_psychology_plan", plan)];
    });
    await f.run().catch(() => undefined);
    expect(f.controller.signal.aborted).toBe(true);
    expect(f.save).not.toHaveBeenCalled();
  });

  it("协调过程有调用上限，不因反复咨询缓存而无限运行", async () => {
    const f = fixture([[consult("cbt")]]);
    await expect(f.run()).rejects.toThrow();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.model.requests.length).toBeLessThanOrEqual(6);
  });
});

it("专家不能引用仅有标题或不存在的资料，纠正后才返回正文依据", async () => {
  let attempt = 0;
  const f = fixture(
    [
      [
        call("cbt_agent", {
          request: "测试依据",
          urgency: "routine",
          knowledgeQuery: "自动思维",
        }),
      ],
      [saveReply("cbt")],
    ],
    () => [
      call("submit_psychology_plan", {
        ...plan,
        usedSourceIds: attempt++ ? ["ref_1"] : ["ref_2", "invented"],
      }),
    ],
    {
      query: "自动思维",
      notices: [],
      sources: [
        {
          library: "测试库",
          title: "可读资料",
          excerpt: "可读正文",
          referenceId: "ref_1",
          readStatus: "document",
        },
        {
          library: "测试库",
          title: "仅标题资料",
          excerpt: "",
          referenceId: "ref_2",
          readStatus: "restricted",
        },
      ],
    },
  );
  await f.run();
  expect(attempt).toBe(2);
  expect(f.save).toHaveBeenCalledOnce();
  const expertRetry = JSON.stringify(f.model.requests[2].contents);
  expect(expertRetry).toContain("只能选择本轮提供且有正文");
  const main = JSON.stringify(f.model.requests.at(-1)!.contents);
  expect(main).toContain(
    '"references":[{"library":"测试库","title":"可读资料"',
  );
});

it("模型的自由文本检索被拒绝，纠正为固定方法词后才读取知识库", async () => {
  const consultWith = (query: string) =>
    call("cbt_agent", {
      request: "请帮助这位用户",
      urgency: "routine",
      knowledgeQuery: query,
    });
  const f = fixture(
    [
      [consultWith("张三 13800138000 自动思维")],
      [consultWith("自动思维")],
      [saveReply("cbt")],
    ],
    () => [call("submit_psychology_plan", plan)],
    { sources: [], notices: [] },
  );
  await f.run();
  expect(f.knowledgeRead).toHaveBeenCalledExactlyOnceWith(
    "自动思维", f.controller.signal,
  );
  expect(JSON.stringify(f.model.requests[1].contents)).toContain(
    "不允许自由文本",
  );
  expect(f.save).toHaveBeenCalledOnce();
});
