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
import type { GenerationProgress } from "../domain/contracts";
import type { KnowledgeContext } from "./knowledge";
import { DEFAULT_AGENT_CONFIGS } from "./default-prompts";
import { createAJokerAgent } from "./coordinator";
import { formResponseGuidance } from "./form-response-guidance";
import { createPsychologyTeam } from "./psychology-agents";
import { constrainedFormDeliveryError, singleChoiceDeliveryError } from "./single-choice-delivery";
import { PSYCHOLOGY_APPROACHES, type PsychologyApproach } from "./psychology";
import {
  A2A_TASK_STORE_SCOPE,
  type A2ARequestLedger,
  type A2ARequestLedgerEntry,
  type A2ARequestLedgerReservation,
  type A2ARequestLedgerScope,
  type ListTasksRequest,
  type ListTasksResponse,
  type ScopedA2ATaskStore,
  type ServerCallContext,
  type Task,
  type TaskState,
} from "@cfp/agent-a2a";
import {
  AJ_A2A_TENANT,
  createInProcessPsychologyA2AFactory,
} from "./psychology-a2a";

const TASK_STATE_UNSPECIFIED = 0 as TaskState;

class CoordinatorTestTaskStore implements ScopedA2ATaskStore {
  readonly a2aScope = A2A_TASK_STORE_SCOPE;
  private readonly scopes = new Map<string, Map<string, Task>>();

  private tasks(context: ServerCallContext) {
    const key = JSON.stringify([context.tenant, context.user?.userName]);
    let tasks = this.scopes.get(key);
    if (!tasks) {
      tasks = new Map();
      this.scopes.set(key, tasks);
    }
    return tasks;
  }
  async save(task: Task, context: ServerCallContext) {
    this.tasks(context).set(task.id, structuredClone(task));
  }
  async load(taskId: string, context: ServerCallContext) {
    const task = this.tasks(context).get(taskId);
    return task ? structuredClone(task) : undefined;
  }
  async hasContext(contextId: string, context: ServerCallContext) {
    return [...this.tasks(context).values()].some((task) => task.contextId === contextId);
  }
  async list(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse> {
    const tasks = [...this.tasks(context).values()].filter((task) =>
      (!params.contextId || task.contextId === params.contextId)
      && (params.status === TASK_STATE_UNSPECIFIED || task.status?.state === params.status),
    );
    const pageSize = params.pageSize ?? 50;
    return {
      tasks: structuredClone(tasks.slice(0, pageSize)),
      nextPageToken: "",
      pageSize,
      totalSize: tasks.length,
    };
  }
}

class CoordinatorTestLedger implements A2ARequestLedger {
  private readonly entries = new Map<string, A2ARequestLedgerEntry>();
  private readonly tokens = new Map<string, string>();
  private key(scope: A2ARequestLedgerScope, identity: string) {
    return JSON.stringify([scope.tenant, scope.owner, scope.agentId, identity]);
  }
  async reserve(scope: A2ARequestLedgerScope, identity: string, fingerprint: string): Promise<A2ARequestLedgerReservation> {
    const key = this.key(scope, identity);
    const existing = this.entries.get(key);
    if (existing) return { outcome: "existing", entry: structuredClone(existing) };
    const token = crypto.randomUUID();
    const entry: A2ARequestLedgerEntry = { requestIdentity: identity, fingerprint, status: "pending" };
    this.entries.set(key, entry);
    this.tokens.set(token, key);
    return { outcome: "new", token, entry: structuredClone(entry) };
  }
  async recordTask(token: string, task: Pick<Task, "id" | "contextId">) {
    const key = this.tokens.get(token);
    const entry = key ? this.entries.get(key) : undefined;
    if (!entry) throw new Error("unknown reservation");
    Object.assign(entry, { status: "recorded", taskId: task.id, contextId: task.contextId });
  }
  async fail(token: string) {
    const key = this.tokens.get(token);
    const entry = key ? this.entries.get(key) : undefined;
    if (entry?.status === "pending") entry.status = "failed";
  }
}

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
  aJoker: "且慢，更正已经发出去了；余下的可以慢一点。",
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
  specialist = (request: LlmRequest) => {
    const instruction = request.config?.systemInstruction;
    const approach = ((typeof instruction === "string" ? instruction.match(/只负责 (\w+) 视角/)?.[1] : undefined) || "cbt") as PsychologyApproach;
    return [call("submit_psychology_plan", {
      ...plan,
      reply: { ...reply, approach },
      lifecycle: "continue",
      usedSourceIds: [],
    })];
  },
  knowledge?: KnowledgeContext,
  specialistKeys = DEFAULT_AGENT_CONFIGS.slice(1),
  coordinator = DEFAULT_AGENT_CONFIGS[0].prompt,
  checkDelivery?: Parameters<typeof createAJokerAgent>[0]["checkDelivery"],
  responseGuidance?: string,
  inputPartsOverride?: Part[],
  onStage?: Parameters<typeof createAJokerAgent>[0]["onStage"],
) {
  let step = 0;
  const model = new WorkflowModel((request) =>
    request.toolsDict.submit_psychology_plan
      ? specialist(request)
      : steps[Math.min(step++, steps.length - 1)],
  );
  const sessionService = new InMemorySessionService();
  const controller = new AbortController();
  const save = vi.fn(async (value: unknown, specialist?: unknown) => ({ id: 11, output: value, specialist }));
  const saveHandoffPreamble = vi.fn(async (preamble: string) => preamble);
  const stages: GenerationProgress[] = [];
  const knowledgeRead = vi.fn(async () => knowledge!);
  const a2a = createInProcessPsychologyA2AFactory({
    principal: { owner: "owner", tenant: AJ_A2A_TENANT },
    taskStore: new CoordinatorTestTaskStore(),
    requestLedger: new CoordinatorTestLedger(),
  });
  const agent = createAJokerAgent({
    configuration: {
      coordinator,
      revision: "fixture",
      specialists: specialistKeys.map((spec) => ({
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
    consultationExecutionId: "11",
    inputParts: inputPartsOverride ?? input,
    signal: controller.signal,
    a2a,
    save,
    saveHandoffPreamble,
    checkDelivery,
    responseGuidance,
    onStage: (stage) => {
      stages.push(stage);
      onStage?.(stage);
    },
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
      newMessage: { role: "user", parts: inputPartsOverride ?? input },
      abortSignal: controller.signal,
      runConfig: { maxLlmCalls: 5 },
    })) {
      if (event.errorCode) throw new Error(event.errorCode);
    }
  };
  return {
    model,
    sessionService,
    controller,
    save,
    saveHandoffPreamble,
    agent,
    run,
    knowledgeRead,
    stages,
  };
}
const consult = (approach: string) =>
  call(`${approach}_agent`, {
    request: "请针对这次自责给一个可选练习，保留用户填写的 0 分。",
    urgency: "routine",
    userFacingIntro: "我先把这件事交给对应的 AI 专家，请稍等。",
  });
const saveReply = (approach = "supportive") =>
  call("save_a_j_oker", { ...reply, approach });

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

  it("交接后专家自己的回复直接保存，协调者不改写也不再询问", async () => {
    const expertReply = {
      aJoker: "我会从认知行为的角度和你一起看这件事。先只写下已经发生的事实。",
      association: "认知行为方法：先区分事实、想法和感受。",
      approach: "cbt" as const,
      artifacts: [{
        kind: "form" as const,
        id: "reflection",
        title: "先写事实",
        description: "只填你愿意分享的部分",
        submitLabel: "继续",
        fields: [{ id: "fact", label: "已经发生了什么？", type: "longText" as const, required: false }],
      }],
    };
    const f = fixture([[consult("cbt")]], () => [
      call("submit_psychology_plan", {
        ...plan,
        reply: expertReply,
        lifecycle: "continue",
        usedSourceIds: [],
      }),
    ]);
    await f.run();
    expect(f.model.requests).toHaveLength(2);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save.mock.calls[0]?.[0]).toEqual(expertReply);
    expect(f.save.mock.calls[0]?.[1]).toMatchObject({
      expertId: "cbt",
      status: "active",
      sources: [],
    });
    expect(f.stages).toEqual([
      {
        stageId: "expert_handoff",
        stepName: "阿 J 先生正在邀请 AI 专家",
        interimMessage: {
          id: "handoff_preamble_11",
          text: "我先把这件事交给对应的 AI 专家，请稍等。",
        },
      },
      {
        stageId: "expert_working",
        stepName: "AI 专家正在接着你刚才的话往下想",
      },
    ]);
  });

  it("专家交接前导先持久化和发进度，专家工作最后才开始", async () => {
    const order: string[] = [];
    const f = fixture(
      [[consult("cbt")]],
      () => {
        order.push("expert");
        return [call("submit_psychology_plan", {
          ...plan,
          reply: { ...reply, approach: "cbt" },
          lifecycle: "continue",
          usedSourceIds: [],
        })];
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (stage) => order.push(stage.stageId),
    );
    f.saveHandoffPreamble.mockImplementation(async (preamble) => {
      order.push("persist");
      return preamble;
    });
    await f.run();
    expect(order).toEqual(["persist", "expert_handoff", "expert_working", "expert"]);
    expect(f.saveHandoffPreamble).toHaveBeenCalledOnce();
  });

  it("同一轮重复咨询复用预约，不重复保存或播报交接前导", async () => {
    const f = fixture(
      [[consult("cbt"), consult("cbt")]],
      () => [call("submit_psychology_plan", {
        ...plan,
        reply: { ...reply, approach: "cbt" },
        lifecycle: "continue",
        usedSourceIds: [],
      })],
    );
    await f.run();
    expect(f.saveHandoffPreamble).toHaveBeenCalledOnce();
    expect(f.stages.filter((stage) => stage.stageId === "expert_handoff")).toHaveLength(1);
    expect(f.save).toHaveBeenCalledOnce();
  });

  it("眼前危险立即绕过专家和交接前导", async () => {
    const f = fixture(
      [
        [call("cbt_agent", {
          request: "用户表达眼前危险",
          urgency: "immediate",
        })],
        [saveReply()],
      ],
    );
    await f.run();
    expect(f.model.requests).toHaveLength(2);
    expect(f.saveHandoffPreamble).not.toHaveBeenCalled();
    expect(f.stages).toEqual([]);
    expect(f.save).toHaveBeenCalledOnce();
  });

  it("常规初次交接缺少前导说明时被工具拒绝且不启动专家", async () => {
    const f = fixture(
      [
        [call("cbt_agent", {
          request: "请帮助这位用户",
          urgency: "routine",
        })],
        [saveReply()],
      ],
    );
    await f.run();
    expect(f.model.requests).toHaveLength(2);
    expect(f.saveHandoffPreamble).not.toHaveBeenCalled();
    expect(f.stages).toEqual([]);
    expect(f.save).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.model.requests[1]?.contents)).toContain("12～320 字 userFacingIntro");
  });

  it("结构化空表单事实同时进入协调者和专家的实际模型请求", async () => {
    const emptyFormResponse = {
      turnId: 17,
      artifactId: "choice",
      values: { choice: { optionIds: [] } },
      presentation: {
        presentationId: "urn:cfp:a-j-oker:turn:17",
        revision: 1,
        formId: "choice",
      },
    };
    const emptyInput: Part[] = [{
      text: JSON.stringify({
        currentInput: "填写「今晚选择」\n今晚想选：未填写",
        formResponse: emptyFormResponse,
      }),
    }];
    const responseGuidance = formResponseGuidance({
      formResponse: emptyFormResponse,
    })!;
    const f = fixture(
      [[consult("cbt")]],
      undefined,
      undefined,
      DEFAULT_AGENT_CONFIGS.slice(1),
      DEFAULT_AGENT_CONFIGS[0].prompt,
      undefined,
      responseGuidance,
      emptyInput,
    );
    await f.run();
    const instructions = f.model.requests.map(
      request => request.config?.systemInstruction,
    );
    expect(instructions).toHaveLength(2);
    for (const instruction of instructions) {
      expect(instruction).toContain("没有任何字段收到有效答案");
      expect(instruction).toContain("不表示动机、拒绝、疲惫、能量或偏好");
      expect(instruction).toContain("空着也是一句话");
    }
    const originalText = f.model.requests[0].contents?.[0]?.parts?.[0];
    const originalContext = typeof originalText?.text === "string"
      ? JSON.parse(originalText.text) as { formResponse?: unknown }
      : undefined;
    expect(originalContext?.formResponse).toEqual(emptyFormResponse);
  });

  it("首次交接把多字段开放表单退给专家并接受修正后的一题表单", async () => {
    let attempts = 0;
    const fields = [
      { id: "fact", label: "你确认发生了什么？", type: "longText" as const, required: false },
      { id: "emotion", label: "你有什么感受？", type: "text" as const, required: false },
    ];
    const f = fixture([[consult("cbt")]], () => [call("submit_psychology_plan", {
      ...plan,
      reply: {
        ...reply,
        approach: "cbt",
        artifacts: [{ kind: "form", id: "reflection", title: "先看一步", description: "按需填写", submitLabel: "继续", fields: attempts++ ? fields.slice(0, 1) : fields }],
      },
      lifecycle: "continue",
      usedSourceIds: [],
    })], undefined, DEFAULT_AGENT_CONFIGS.slice(1), DEFAULT_AGENT_CONFIGS[0].prompt,
    value => constrainedFormDeliveryError({ singleOpenQuestionOnly: true }, value));
    await f.run();
    expect(attempts).toBe(2);
    expect(JSON.stringify(f.model.requests[2]?.contents)).toContain("只含一个 text 或 longText 字段");
    expect(f.save.mock.calls[0]?.[0]).toMatchObject({ artifacts: [{ fields: [fields[0]] }] });
  });

  it("活动专家直达路由同样退回多字段并只交付修正后的一题表单", async () => {
    let attempts = 0;
    const fields = [
      { id: "fact", label: "你确认发生了什么？", type: "longText" as const, required: false },
      { id: "thought", label: "你当时怎么想？", type: "text" as const, required: false },
    ];
    const model = new WorkflowModel(() => [call("submit_psychology_plan", {
      ...plan,
      reply: {
        ...reply,
        approach: "cbt",
        artifacts: [{ kind: "form", id: "reflection", title: "先看一步", description: "按需填写", submitLabel: "继续", fields: attempts++ ? fields.slice(0, 1) : fields }],
      },
      lifecycle: "continue",
      usedSourceIds: [],
    })]);
    const controller = new AbortController();
    const deliverExpert = vi.fn(async (value: { plan: unknown }) => {
      void value;
      return undefined;
    });
    const stages: GenerationProgress[] = [];
    const responseGuidance = formResponseGuidance({
      formResponse: { values: { emotion: 0 } },
    })!;
    const team = createPsychologyTeam({
      model,
      configuration: {
        coordinator: DEFAULT_AGENT_CONFIGS[0].prompt,
        revision: "direct-fixture",
        specialists: [{
          approach: "cbt", label: "认知行为", prompt: DEFAULT_AGENT_CONFIGS.find(item => item.key === "cbt")!.prompt,
          revision: "direct-fixture", allowedComponents: ["form"], preferredComponents: ["form"],
        }],
      },
      sessionService: new InMemorySessionService(),
      userId: "owner",
      turnSessionId: "direct-turn",
      consultationExecutionId: "direct-execution",
      inputParts: input,
      signal: controller.signal,
      a2a: createInProcessPsychologyA2AFactory({
        principal: { owner: "owner", tenant: AJ_A2A_TENANT },
        taskStore: new CoordinatorTestTaskStore(),
        requestLedger: new CoordinatorTestLedger(),
      }),
      checkDelivery: value => constrainedFormDeliveryError({ singleOpenQuestionOnly: true }, value),
      responseGuidance,
      deliverExpert,
      onStage: (stage) => stages.push(stage),
    });
    await expect(team.consultDirect("cbt", { request: "继续当前任务", urgency: "routine" }))
      .resolves.toMatchObject({ status: "completed" });
    expect(attempts).toBe(2);
    expect(model.requests[0]?.config?.systemInstruction).toContain(
      "1 个字段收到有效答案",
    );
    expect(model.requests[0]?.config?.systemInstruction).toContain(
      "不得把整份表单说成缺失或未提交",
    );
    expect(JSON.stringify(model.requests[1]?.contents)).toContain("只含一个 text 或 longText 字段");
    expect(deliverExpert.mock.calls[0]?.[0]).toMatchObject({ plan: { reply: { artifacts: [{ fields: [fields[0]] }] } } });
    expect(stages).toEqual([
      {
        stageId: "expert_working",
        stepName: "AI 专家正在接着你刚才的话往下想",
      },
    ]);
  });

  it("直接交接退回旧版根级作品，修正到 reply 后只持久化一件", async () => {
    let attempts = 0;
    const artifact = {
      kind: "card" as const,
      id: "walking_plan",
      title: "今晚五分钟",
      body: "穿上鞋，下楼走五分钟；回来后可以继续告诉我感受。",
    };
    const correctedReply = {
      ...reply,
      approach: "cbt" as const,
      artifacts: [artifact],
    };
    const f = fixture([[consult("cbt")]], () => [
      call("submit_psychology_plan", attempts++ ? {
        ...plan,
        reply: correctedReply,
        lifecycle: "continue",
        usedSourceIds: [],
      } : {
        ...plan,
        artifacts: [artifact],
        reply: { ...reply, approach: "cbt" },
        lifecycle: "continue",
        usedSourceIds: [],
      }),
    ]);
    await f.run();
    expect(attempts).toBe(2);
    expect(JSON.stringify(f.model.requests[2]?.contents)).toContain(
      "直接交接不接受 submit_psychology_plan 根级 artifacts",
    );
    expect(JSON.stringify(f.model.requests[2]?.contents)).toContain(
      "系统不会代为搬移、合并或静默丢弃作品",
    );
    expect(f.save).toHaveBeenCalledExactlyOnceWith(correctedReply, expect.objectContaining({ status: "active" }));
    expect(f.save.mock.calls[0]?.[0]).toMatchObject({ artifacts: [artifact] });
  });

  it("两次无效专家提交后第三次有效提交仍只交付一次，并原样保留 0 和选项表单值", async () => {
    let expertAttempts = 0;
    const exactFormInput: Part[] = [{
      text: JSON.stringify({
        memory: "用户喜欢散步",
        previous: [],
        currentInput: "继续刚才的表单",
        formResponse: {
          turnId: 10,
          artifactId: "reflection",
          values: {
            intensity: 0,
            choice: { optionIds: ["slow-down"] },
            skipped: { optionIds: [] },
          },
        },
      }),
    }];
    const validReply = {
      ...reply,
      approach: "cbt" as const,
    };
    const f = fixture(
      [[consult("cbt")]],
      () => [
        call("submit_psychology_plan", {
          ...plan,
          ...(expertAttempts++ < 2 ? {} : { reply: validReply, lifecycle: "continue" as const }),
          usedSourceIds: [],
        }),
      ],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      exactFormInput,
    );

    await f.run();

    expect(expertAttempts).toBe(3);
    expect(f.model.requests.filter(request => request.toolsDict.submit_psychology_plan)).toHaveLength(3);
    expect(f.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ approach: "cbt", aJoker: validReply.aJoker }),
      expect.objectContaining({ expertId: "cbt", status: "active" }),
    );
    const specialistContext = JSON.parse(
      f.model.requests[1]?.contents?.[0]?.parts?.[0]?.text ?? "{}",
    ) as { formResponse?: { values?: Record<string, unknown> } };
    expect(specialistContext.formResponse?.values).toEqual({
      intensity: 0,
      choice: { optionIds: ["slow-down"] },
      skipped: { optionIds: [] },
    });
  });

  it("本地故障注入只拒绝前两次有效专家提交并保留第三次交付", async () => {
    let submissions = 0;
    const events: string[] = [];
    const model = new WorkflowModel(() => {
      submissions++;
      return [call("submit_psychology_plan", {
        ...plan,
        reply: { ...reply, approach: "cbt" },
        lifecycle: "continue",
        usedSourceIds: [],
      })];
    });
    const deliverExpert = vi.fn(async () => undefined);
    const team = createPsychologyTeam({
      model,
      configuration: {
        coordinator: DEFAULT_AGENT_CONFIGS[0].prompt,
        revision: "fault-fixture",
        specialists: [{
          approach: "cbt",
          label: "认知行为",
          prompt: DEFAULT_AGENT_CONFIGS.find(item => item.key === "cbt")!.prompt,
          revision: "fault-fixture",
        }],
      },
      sessionService: new InMemorySessionService(),
      userId: "owner",
      turnSessionId: "fault-turn",
      consultationExecutionId: "fault-execution",
      inputParts: input,
      signal: new AbortController().signal,
      a2a: createInProcessPsychologyA2AFactory({
        principal: { owner: "owner", tenant: AJ_A2A_TENANT },
        taskStore: new CoordinatorTestTaskStore(),
        requestLedger: new CoordinatorTestLedger(),
      }),
      deliverExpert,
      localFaults: {
        rejectFirstTwoExpertSubmissions: true,
        onEvent: event => events.push(`${event.category}:${event.attempt}`),
      },
    });

    await expect(team.consultDirect("cbt", { request: "继续当前任务", urgency: "routine" }))
      .resolves.toMatchObject({ status: "completed" });
    expect(submissions).toBe(3);
    expect(events).toEqual([
      "expert_submission_rejected:1",
      "expert_submission_rejected:2",
    ]);
    expect(deliverExpert).toHaveBeenCalledOnce();
  });

  it("专家执行故障耗尽后持久结构化不可用状态且不交付专家方案", async () => {
    const events: string[] = [];
    const recorded: unknown[] = [];
    const deliverExpert = vi.fn(async () => undefined);
    const team = createPsychologyTeam({
      model: new WorkflowModel(() => [call("submit_psychology_plan", {
        ...plan,
        reply: { ...reply, approach: "cbt" },
        lifecycle: "continue",
        usedSourceIds: [],
      })]),
      configuration: {
        coordinator: DEFAULT_AGENT_CONFIGS[0].prompt,
        revision: "fault-fixture",
        specialists: [{
          approach: "cbt",
          label: "认知行为",
          prompt: DEFAULT_AGENT_CONFIGS.find(item => item.key === "cbt")!.prompt,
          revision: "fault-fixture",
        }],
      },
      sessionService: new InMemorySessionService(),
      userId: "owner",
      turnSessionId: "fault-turn",
      consultationExecutionId: "fault-execution",
      inputParts: input,
      signal: new AbortController().signal,
      a2a: createInProcessPsychologyA2AFactory({
        principal: { owner: "owner", tenant: AJ_A2A_TENANT },
        taskStore: new CoordinatorTestTaskStore(),
        requestLedger: new CoordinatorTestLedger(),
      }),
      deliverExpert,
      recordSpecialist: async state => recorded.push(structuredClone(state)),
      localFaults: {
        exhaustExpertExecutionRetries: true,
        onEvent: event => events.push(`${event.category}:${event.attempt}`),
      },
    });

    await expect(team.consultDirect("cbt", { request: "继续当前任务", urgency: "routine" }))
      .resolves.toMatchObject({ status: "unavailable" });
    expect(events).toEqual([
      "expert_execution_fault:1",
      "expert_execution_fault:2",
      "expert_execution_fault:3",
    ]);
    expect(deliverExpert).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      status: "unavailable",
      handoff: {
        status: "failed",
        attempts: 3,
        finalDisposition: "retry_exhausted",
      },
    });
    const serialized = JSON.stringify((recorded[0] as { handoff?: unknown }).handoff);
    expect(serialized).not.toContain("prompt");
  });

  it("直接专家 reply 中的两件作品先被现有 schema 拒绝，修正后仍只保存一件", async () => {
    let attempts = 0;
    const first = {
      kind: "card" as const,
      id: "fact_card",
      title: "先写下事实",
      body: "今晚只补一条已经确认的事实。",
    };
    const second = {
      kind: "card" as const,
      id: "feeling_card",
      title: "再看感受",
      body: "写完事实后，可以补一句感受。",
    };
    const f = fixture([[consult("cbt")]], () => [
      call("submit_psychology_plan", {
        ...plan,
        reply: {
          ...reply,
          approach: "cbt",
          artifacts: attempts++ ? [first] : [first, second],
        },
        lifecycle: "continue",
        usedSourceIds: [],
      }),
    ]);
    await f.run();
    expect(attempts).toBe(2);
    expect(JSON.stringify(f.model.requests[2]?.contents)).toContain(
      "阿 J 一轮最多输出一件回应作品",
    );
    expect(f.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ artifacts: [first] }),
      expect.objectContaining({ expertId: "cbt" }),
    );
    expect(JSON.stringify(f.save.mock.calls[0]?.[0])).not.toContain("feeling_card");
  });

  it("眼前危险优先清空作品，不被直接交接根级作品格式纠正阻断", async () => {
    const urgentReply = {
      aJoker: "现在先停下来，我会直接陪你把眼前安全放在第一位。",
      association: "用户有眼前危险，先提供直接安全关照。",
    };
    const f = fixture([[consult("cbt")]], () => [
      call("submit_psychology_plan", {
        ...plan,
        needsImmediateSupport: true,
        artifacts: [{
          kind: "card",
          id: "unsafe_practice",
          title: "不该出现的练习",
          body: "危险场景不应交付作品。",
        }],
        reply: urgentReply,
        lifecycle: "continue",
        usedSourceIds: [],
      }),
    ]);
    await f.run();
    expect(f.model.requests).toHaveLength(2);
    expect(f.save).toHaveBeenCalledExactlyOnceWith(
      { ...urgentReply, approach: "cbt", artifacts: [] },
      expect.objectContaining({ expertId: "cbt", status: "active" }),
    );
    expect(JSON.stringify(f.save.mock.calls[0]?.[0])).not.toContain("unsafe_practice");
  });

  it("旧版自定义专家提示仍由固定直接交接协议接管并保存专家回复", async () => {
    const legacy = {
      ...DEFAULT_AGENT_CONFIGS.find((item) => item.key === "cbt")!,
      prompt:
        "保持温和的苏格拉底式提问；旧配置允许本轮交付两件作品；不直接对用户发言，只提供方案交给主 Agent。",
    };
    const f = fixture([[consult("cbt")]], undefined, undefined, [legacy]);
    await f.run();
    const instruction = f.model.requests[1]?.config?.systemInstruction as string;
    expect(instruction).toContain(legacy.prompt);
    const configured = instruction.indexOf("旧配置允许本轮交付两件作品");
    const fixed = instruction.indexOf("服务端固定作品规则");
    expect(configured).toBeGreaterThanOrEqual(0);
    expect(fixed).toBeGreaterThan(configured);
    expect(instruction).toContain("一轮最多保存一件回应作品");
    expect(instruction).toContain("直接交接执行协议（优先级高于上方配置中的旧工作流描述）");
    expect(instruction).toContain("任何“不直接对用户发言”“只提供方案”“交回主 Agent”等旧流程片段均被本协议替代");
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.save.mock.calls[0]?.[0]).toMatchObject({
      aJoker: reply.aJoker,
      approach: "cbt",
    });
  });

  it("全部专家停用时仍可由协调者提供支持性回应", async () => {
    const f = fixture([[saveReply()]], undefined, undefined, []);
    await f.run();
    expect(f.agent.tools.filter(isAgentTool)).toHaveLength(0);
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(PSYCHOLOGY_APPROACHES) as PsychologyApproach[])(
    "%s 独立执行后直接交付自己的回复",
    async (approach) => {
      const f = fixture([[consult(approach)]]);
      await f.run();
      expect(f.model.requests).toHaveLength(2);
      const expert = f.model.requests[1];
      expect(Object.keys(expert.toolsDict)).toEqual(["submit_psychology_plan"]);
      expect(expert.config?.systemInstruction).toContain(
        `只负责 ${approach} 视角`,
      );
      expect(expert.config?.systemInstruction).not.toContain(
        "这嘴今日倒跑得快",
      );
      expect(expert.contents[0].parts?.slice(0, 2)).toEqual(input);
      expect(f.save.mock.calls[0]?.[0]).toEqual({ ...reply, approach });
      expect(f.save.mock.calls[0]?.[1]).toMatchObject({ expertId: approach });
      const session = await f.sessionService.getSession({
        appName: "hello_agent",
        userId: "owner",
        sessionId: `11:${approach}:attempt-1`,
      });
      expect(
        session?.events.some((event) => event.author === `${approach}_agent`),
      ).toBe(true);
      expect(
        session?.events.some((event) => event.author === "a_j_oker_agent"),
      ).toBe(false);
    },
  );

  it("专家系统指令包含持续陪伴与空表单事实规则", async () => {
    const f = fixture([[consult("act")]]);
    await f.run();
    const instruction = f.model.requests[1]?.config?.systemInstruction;
    expect(instruction).toContain(
      "lifecycle 表示用户与你的后续关系，不表示你是否已写完本条回复、卡片或表单",
    );
    expect(instruction).toContain("默认用 continue");
    expect(instruction).toContain(
      "缺失、跳过或空提交的可选表单只表示本轮没有收到该字段内容",
    );
    expect(instruction).toContain("实际作品只能放在 reply.artifacts");
    expect(instruction).toContain("服务端固定作品规则");
    expect(instruction).toContain("一轮最多保存一件回应作品");
  });

  it("专家首个有效回复直接交付且不再回到协调模型改写", async () => {
    const f = fixture([
      [consult("cbt")],
    ]);
    await f.run();
    expect(
      f.model.requests.filter(
        (request) => request.toolsDict.submit_psychology_plan,
      ),
    ).toHaveLength(1);
    expect(f.model.requests).toHaveLength(2);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save.mock.calls[0]?.[1]).toMatchObject({ expertId: "cbt", status: "active" });
  });

  it("同一批重复咨询仍只有一次专家执行", async () => {
    const f = fixture([[consult("cbt"), consult("cbt")], [saveReply("cbt")]]);
    await f.run();
    expect(f.model.requests).toHaveLength(2);
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

  it("AJ 多作品输出由保存工具校验退回，修正后才持久化", async () => {
    const invalid = call("save_a_j_oker", {
      ...reply,
      artifacts: [
        {
          kind: "card",
          id: "reason",
          title: "辨认烦躁",
          body: "先选一个原因。",
        },
        {
          kind: "card",
          id: "comfort",
          title: "安慰卡",
          body: "先照顾自己。",
        },
      ],
    });
    const f = fixture([[invalid], [saveReply()]]);
    await f.run();
    expect(JSON.stringify(f.model.requests[1].contents)).toContain(
      "阿 J 一轮最多输出一件回应作品",
    );
    expect(f.save).toHaveBeenCalledExactlyOnceWith({ ...reply, approach: "supportive" });
  });

  it("单题单选约束在保存前退回附加长文本，修正后只保存一次", async () => {
    const select = {
      id: "reason", label: "今天更像哪一种？", type: "select" as const,
      required: false, allowOther: false,
      options: [{ id: "tired", label: "累积疲惫" }, { id: "pressure", label: "事情太多" }],
    };
    const invalid = call("save_a_j_oker", {
      ...reply,
      artifacts: [{
        kind: "form", id: "reason_form", title: "辨认烦躁", description: "选最接近的一项",
        submitLabel: "选好了", fields: [select, { id: "more", label: "还想补充吗", type: "longText", required: false }],
      }],
    });
    const corrected = call("save_a_j_oker", {
      ...reply,
      artifacts: [{
        kind: "form", id: "reason_form", title: "辨认烦躁", description: "选最接近的一项",
        submitLabel: "选好了", fields: [select],
      }],
    });
    const checkDelivery = (value: Parameters<NonNullable<Parameters<typeof createAJokerAgent>[0]["checkDelivery"]>>[0]) =>
      singleChoiceDeliveryError(true, value);
    const f = fixture([[invalid], [corrected]], undefined, undefined, [], DEFAULT_AGENT_CONFIGS[0].prompt, checkDelivery);
    await f.run();
    expect(JSON.stringify(f.model.requests[1].contents)).toContain("只含一个 select 字段");
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.save.mock.calls[0][0]).toMatchObject({ artifacts: [{ fields: [select] }] });
  });

  it("旧 coordinator 配置之后仍有服务端固定的单作品与内联追问规则", () => {
    const f = fixture(
      [[saveReply()]],
      undefined,
      undefined,
      [],
      "旧配置：作品通常最多一至两件，并放在底部弹层。",
    );
    const instruction = f.agent.instruction as string;
    const configured = instruction.indexOf("通常最多一至两件");
    const fixed = instruction.indexOf(
      "服务端固定作品规则（优先于可配置 coordinator 提示",
    );
    expect(configured).toBeGreaterThanOrEqual(0);
    expect(fixed).toBeGreaterThan(configured);
    expect(instruction).toContain("在聊天消息内直接选择并继续");
    expect(instruction).toContain("不得追加第二件作品");
    expect(instruction).toContain("专家工具返回 expertUnavailable");
    expect(instruction).toContain("直接保存阿 J 自己的支持性回应");
    expect(instruction).toContain("结构化交接状态由宿主呈现");
    expect(instruction).not.toContain("向用户明确说明与该专家的本轮交接未完成");
  });

  it("专家失败回到主 Agent 并收到明确不可用结果，不泄漏原始错误", async () => {
    const f = fixture([[consult("cbt")], [saveReply()]], () => {
      throw new Error("private-provider-secret");
    });
    await f.run();
    const returned = JSON.stringify(f.model.requests.at(-1)?.contents);
    expect(returned).toContain("expertUnavailable");
    expect(returned).not.toContain("private-provider-secret");
    expect(f.save).toHaveBeenCalledTimes(1);
    const savedReply = f.save.mock.calls[0]?.[0] as typeof reply & {
      aJoker: string;
    };
    expect(savedReply.aJoker).toBe(reply.aJoker);
    expect(savedReply.aJoker).not.toContain("private-provider-secret");
    expect(f.save.mock.calls[0]?.[1]).toBeUndefined();
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
    expect(JSON.stringify(f.model.requests.at(-1)?.contents)).toContain("expertUnavailable");
    expect(f.save).toHaveBeenCalledExactlyOnceWith({
      ...reply,
      approach: "supportive",
    });
  });

  it("专家方案格式错误可以在本轮修正，再由主 Agent 保存", async () => {
    let attempts = 0;
    const f = fixture([[consult("cbt")], [saveReply("cbt")]], () => {
      attempts++;
      return [
        call(
          "submit_psychology_plan",
          attempts === 1 ? { ...plan, suggestions: "不是列表" } : {
            ...plan, reply: { ...reply, approach: "cbt" }, lifecycle: "continue", usedSourceIds: [],
          },
        ),
      ];
    });
    await f.run();
    expect(attempts).toBe(2);
    expect(f.model.requests).toHaveLength(3);
    expect(JSON.stringify(f.model.requests[2].contents)).toContain(
      "方案尚未提交",
    );
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it("complete 不能同时发送新表单，专家可在同一轮纠正为 continue", async () => {
    let attempts = 0;
    const formReply = {
      ...reply,
      approach: "cbt" as const,
      artifacts: [{
        kind: "form" as const,
        id: "next_step",
        title: "下一步",
        description: "继续互动",
        submitLabel: "继续",
        fields: [{ id: "answer", label: "你的回答", type: "longText" as const, required: false }],
      }],
    };
    const f = fixture([[consult("cbt")]], () => [call("submit_psychology_plan", {
      ...plan,
      reply: formReply,
      lifecycle: attempts++ === 0 ? "complete" : "continue",
      usedSourceIds: [],
    })]);
    await f.run();
    expect(attempts).toBe(2);
    expect(JSON.stringify(f.model.requests[2]?.contents)).toContain("生命周期为 complete 时不能交付新的互动表单");
    expect(f.save).toHaveBeenCalledExactlyOnceWith(formReply, expect.objectContaining({ status: "active" }));
  });

  it("交接后不再运行协调者的并行保存调用", async () => {
    const f = fixture([[consult("cbt")]]);
    await f.run();
    expect(f.model.requests).toHaveLength(2);
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

  it("直接交付在调用上限内结束", async () => {
    const f = fixture([[consult("cbt")]]);
    await f.run();
    expect(f.save).toHaveBeenCalledOnce();
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
      userFacingIntro: "我先把这件事交给对应的 AI 专家，请稍等。",
          knowledgeQuery: "自动思维",
        }),
      ],
      [saveReply("cbt")],
    ],
    () => [
      call("submit_psychology_plan", {
        ...plan,
        reply: { ...reply, approach: "cbt" },
        lifecycle: "continue",
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
  expect(f.save.mock.calls[0]?.[1]).toMatchObject({ sources: [{ library: "测试库", title: "可读资料" }] });
});

it("模型的自由文本检索被拒绝，纠正为固定方法词后才读取知识库", async () => {
  const consultWith = (query: string) =>
    call("cbt_agent", {
      request: "请帮助这位用户",
      urgency: "routine",
      userFacingIntro: "我先把这件事交给对应的 AI 专家，请稍等。",
      knowledgeQuery: query,
    });
  const f = fixture(
    [
      [consultWith("张三 13800138000 自动思维")],
      [consultWith("自动思维")],
      [saveReply("cbt")],
    ],
    () => [call("submit_psychology_plan", {
      ...plan, reply: { ...reply, approach: "cbt" }, lifecycle: "continue", usedSourceIds: [],
    })],
    { sources: [], notices: [] },
  );
  await f.run();
  expect(f.knowledgeRead).toHaveBeenCalledExactlyOnceWith(
    "自动思维", expect.any(AbortSignal),
  );
  expect(JSON.stringify(f.model.requests[1].contents)).toContain(
    "不允许自由文本",
  );
  expect(f.save).toHaveBeenCalledOnce();
});
