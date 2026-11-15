import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BaseLlm, type LlmRequest, type LlmResponse } from "@google/adk";
import { syntheticTextReview } from "./synthetic-text-review";
import type { Generator } from "../src/agent/runtime";
import type { Moderator } from "../src/domain/moderation";
import type { SpecialistState } from "../src/agent/specialist-state";

const dir = await mkdtemp(path.join(tmpdir(), "aj-expert-lifecycle-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/test.db`;
process.env.PAYLOAD_SECRET = "expert-lifecycle-test-only";
process.env.DEEPSEEK_API_KEY = "isolated-test-key";
process.env.HELLO_ADMIN_BOOTSTRAP = "false";
process.env.HELLO_MEMORY_RECOVERY = "preview";

class ExpertModel extends BaseLlm {
  coordinatorCalls = 0;
  expertCalls = 0;
  failNextExpert = false;
  requests: LlmRequest[] = [];
  constructor() { super({ model: "expert-lifecycle-test" }); }
  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse> {
    this.requests.push(request);
    let name: string;
    let args: Record<string, unknown>;
    if (request.toolsDict.submit_psychology_plan) {
      this.expertCalls++;
      if (this.failNextExpert) {
        this.failNextExpert = false;
        throw new Error("synthetic expert failure");
      }
      const first = this.expertCalls === 1;
      name = "submit_psychology_plan";
      args = {
        summary: first ? "先记录事实" : `继续处理第 ${this.expertCalls} 步`,
        suggestions: ["按自己的节奏继续"], needsImmediateSupport: false,
        usedSourceIds: [], lifecycle: "continue",
        reply: {
          greeting: first ? "我们先只记录发生的事实。" : "我仍会沿用刚才的认知行为方式陪你继续。",
          association: "认知行为方法的连续练习。", approach: "cbt",
          artifacts: first ? [{ kind: "form", id: "facts", title: "记录事实", description: "只填愿意分享的部分", submitLabel: "继续", fields: [{ id: "fact", type: "longText", label: "发生了什么？", required: false }] }] : [],
        },
      };
    } else {
      this.coordinatorCalls++;
      name = "cbt_agent";
      args = { request: "用认知行为方式继续", urgency: "routine", knowledgeQuery: "认知重构" };
    }
    yield { content: { role: "model", parts: [{ functionCall: { id: randomUUID(), name, args } }] } };
  }
  async connect(): Promise<never> { throw new Error("not supported"); }
}

const { cms } = await import("../src/cms/client");
const { seedAgents } = await import("../src/cms/seed");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { runGreeting } = await import("../src/agent/runtime");
const { ContextService } = await import("../src/domain/context");
const { consentForFixture } = await import("./privacy-test-fixture");
const payload = await cms();
try {
await seedAgents(payload);
const owner = { id: randomUUID(), auth: "cookie" as const };
const repo = new Repository(payload, owner);
await consentForFixture(repo);
const model = new ExpertModel();
const makeService = () => new GreetingService(repo, request => runGreeting(request, model), undefined, undefined, { moderate: syntheticTextReview });
const session = await makeService().createSession("专家生命周期");
const first = await makeService().generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "我总觉得自己做错了", mediaIds: [] } });
assert.equal(first.status, "completed");
assert.equal(first.specialist?.status, "active");
assert.equal(model.coordinatorCalls, 1);
const form = (first.artifacts ?? []).find(item => item.kind === "form");
assert.ok(form && first.specialist);

const foreignRepo = new Repository(payload, { id: randomUUID(), auth: "cookie" as const });
const foreignService = new GreetingService(foreignRepo, request => runGreeting(request, model), undefined, undefined, { moderate: syntheticTextReview });
await assert.rejects(() => foreignService.generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "", mediaIds: [], formResponse: { turnId: first.id, artifactId: form.id, values: { fact: "越权" } } } }), /无权/);
const otherSession = await makeService().createSession("另一个会话");
await assert.rejects(() => makeService().generateGreeting({ sessionId: otherSession.id, requestId: randomUUID(), mode: "platform", input: { text: "", mediaIds: [], formResponse: { turnId: first.id, artifactId: form.id, values: { fact: "跨会话" } } } }), /不属于当前对话/);

const formRequestId = randomUUID();
const formResult = await makeService().generateGreeting({ sessionId: session.id, requestId: formRequestId, mode: "platform", input: { text: "", mediaIds: [], formResponse: { turnId: first.id, artifactId: form.id, values: { fact: "会议上说错了一句话" } } } });
assert.equal((await makeService().generateGreeting({ sessionId: session.id, requestId: formRequestId, mode: "platform", input: { text: "", mediaIds: [], formResponse: { turnId: first.id, artifactId: form.id, values: { fact: "会议上说错了一句话" } } } })).id, formResult.id, "original answered-form request must replay");
await assert.rejects(() => makeService().generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "", mediaIds: [], formResponse: { turnId: first.id, artifactId: form.id, values: { fact: "重复提交" } } } }), /已经提交/);
await makeService().generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "然后我一直在反复想", mediaIds: [] } });
assert.equal(model.coordinatorCalls, 1, "reload/form/text must bypass coordinator");
assert.equal(model.expertCalls, 3);

const activeBeforeFailure = (await makeService().history(session.id)).at(-1)!.specialist!;
model.failNextExpert = true;
await assert.rejects(() => makeService().generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "这轮专家暂时失败", mediaIds: [] } }), /本轮未完成|生成失败/);
const retried = await makeService().generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "请重试刚才这一步", mediaIds: [] } });
assert.equal(retried.specialist?.taskId, activeBeforeFailure.taskId, "failed expert turn retry must retain the same task");

const taskId = first.specialist.taskId;
const beforeReturn = model.expertCalls;
const returnRequestId = randomUUID();
const returnInput = { text: "", mediaIds: [], action: { type: "return_to_coordinator" as const, taskId } };
const returned = await makeService().generateGreeting({ sessionId: session.id, requestId: returnRequestId, mode: "platform", input: returnInput });
assert.equal(returned.specialist?.status, "completed");
assert.deepEqual(returned.specialist?.sources, []);
assert.equal(model.expertCalls, beforeReturn, "return must be model-free");
delete process.env.DEEPSEEK_API_KEY;
assert.equal((await makeService().generateGreeting({ sessionId: session.id, requestId: returnRequestId, mode: "platform", input: returnInput })).id, returned.id, "same-request return must replay without a model key");
process.env.DEEPSEEK_API_KEY = "isolated-test-key";
await assert.rejects(() => makeService().generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "", mediaIds: [], action: { type: "return_to_coordinator", taskId } } }), /已经结束|发生变化/);
const coordinatorBeforeFreshText = model.coordinatorCalls;
await makeService().generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "返回之后的新问题", mediaIds: [] } });
assert.equal(model.coordinatorCalls, coordinatorBeforeFreshText + 1, "text after return must reach coordinator");

const normalContext = new ContextService(repo, async () => "当前专家任务仍在继续。用户正在练习区分事实与想法。");
for (let index = 0; index < 3; index++)
  await makeService().generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: `继续专家练习 ${index} ${"详细记录。".repeat(180)}`, mediaIds: [] } });
const coordinatorBeforeCompaction = model.coordinatorCalls;
const normalRevision = (await normalContext.view(session.id)).revision;
await normalContext.compactPreview(session.id, randomUUID(), normalRevision);
const afterNormalCompaction = await makeService().generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "整理后继续专家练习", mediaIds: [] } });
assert.equal(model.coordinatorCalls, coordinatorBeforeCompaction, "normal compaction must retain the active expert");
assert.equal(afterNormalCompaction.specialist?.status, "active");

const configs = await payload.find({ collection: "agent-configs", where: { key: { equals: "cbt" } }, limit: 1, overrideAccess: true });
const cbtConfig = configs.docs[0];
assert.ok(cbtConfig);
await payload.update({ collection: "agent-configs", id: cbtConfig.id, data: { enabled: false }, overrideAccess: true });
const unavailable = await makeService().generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: "专家停用后继续", mediaIds: [] } });
assert.equal(unavailable.specialist?.status, "unavailable");
assert.deepEqual(unavailable.specialist?.sources, []);
assert.match(unavailable.greeting!, /目前不可用/);
await payload.update({ collection: "agent-configs", id: cbtConfig.id, data: { enabled: true }, overrideAccess: true });

const ordinary = { minor: false, crisis: false, dependency: false, overuse: false, exit: false, forget_context: false, image_requested: false, single_choice_only: false };
const lifecycleModerate: Moderator = async request => {
  if (request.stage === "output") return request.serviceScope ? { serviceScope: "support" as const } : undefined;
  const text = request.texts[0] ?? "";
  return {
    serviceScope: text === "需要澄清" ? "unclear" as const : "support" as const,
    interaction: { ...ordinary, forget_context: text === "忘记旧任务" },
  };
};
const privateTask = "只属于旧专家任务的秘密任务内容";
const seenGenerationState: Array<{ activeTask?: string; context: string }> = [];
const lifecycleGenerator: Generator = async request => {
  const context = JSON.stringify(await new ContextService(request.repo).modelContext(request.sessionId));
  seenGenerationState.push({ activeTask: request.activeSpecialist?.currentTask, context });
  const inputText = request.input.text;
  const previous = request.activeSpecialist;
  const state: SpecialistState = previous ?? {
    taskId: randomUUID(), expertId: "cbt", name: "认知行为", method: "区分事实与想法",
    configurationRevision: "scenario-r1", theme: "sage", layout: "reflection",
    status: "active", sources: [{ library: "旧资料库", title: "旧资料", readStatus: "document" }],
    currentTask: inputText.includes("忘记场景") ? privateTask : `处理：${inputText}`,
    prompt: "测试专家提示", allowedComponents: ["form", "card"], preferredComponents: ["form"],
  };
  const formId = inputText.includes("替换表单") ? "new_form" : inputText.includes("开始") ? "old_form" : undefined;
  await request.save({
    greeting: inputText === "完成专家任务" ? "本次专家任务已完成。" : "专家继续处理当前任务。",
    association: "生命周期真实存储检查", approach: "cbt",
    artifacts: formId ? [{ kind: "form", id: formId, title: formId === "old_form" ? "原表单" : "新表单", description: "生命周期测试", submitLabel: "提交", fields: [{ id: "answer", type: "longText", label: "回答", required: false }] }] : [],
  }, { ...state, status: inputText === "完成专家任务" ? "completed" : "active", sources: inputText === "完成专家任务" ? [] : state.sources });
};
const lifecycleService = new GreetingService(repo, lifecycleGenerator, undefined, undefined, { moderate: lifecycleModerate });
const sendScenario = (sessionId: number, text: string) => lifecycleService.generateGreeting({ sessionId, requestId: randomUUID(), mode: "platform", input: { text, mediaIds: [] } });
const submitScenario = (sessionId: number, turnId: number, artifactId: string, requestId = randomUUID()) => lifecycleService.generateGreeting({ sessionId, requestId, mode: "platform", input: { text: "", mediaIds: [], formResponse: { turnId, artifactId, values: { answer: "测试回答" } } } });

const pendingSession = await lifecycleService.createSession("待填表单澄清");
const pendingFirst = await sendScenario(pendingSession.id, "开始待填场景");
await sendScenario(pendingSession.id, "需要澄清");
const pendingSubmit = await submitScenario(pendingSession.id, pendingFirst.id, "old_form");
assert.equal(pendingSubmit.specialist?.taskId, pendingFirst.specialist?.taskId, "clarification must not discard a pending expert form");

const replacementSession = await lifecycleService.createSession("替换表单");
const replacementFirst = await sendScenario(replacementSession.id, "开始替换场景");
const replacement = await sendScenario(replacementSession.id, "替换表单");
await assert.rejects(() => submitScenario(replacementSession.id, replacementFirst.id, "old_form"), /最新一份/);
await submitScenario(replacementSession.id, replacement.id, "new_form");

for (const ending of ["complete", "return", "forget"] as const) {
  const endingSession = await lifecycleService.createSession(`旧表单-${ending}`);
  const opening = await sendScenario(endingSession.id, ending === "forget" ? "开始忘记场景" : "开始结束场景");
  if (ending === "complete") await sendScenario(endingSession.id, "完成专家任务");
  if (ending === "return") await lifecycleService.generateGreeting({ sessionId: endingSession.id, requestId: randomUUID(), mode: "platform", input: { text: "", mediaIds: [], action: { type: "return_to_coordinator", taskId: opening.specialist!.taskId } } });
  if (ending === "forget") await sendScenario(endingSession.id, "忘记旧任务");
  await assert.rejects(() => submitScenario(endingSession.id, opening.id, "old_form"), /当前专家任务|已经过期/);

  if (ending === "forget") {
    for (let index = 0; index < 3; index++) await sendScenario(endingSession.id, `忘记后新内容 ${index} ${"新记录。".repeat(180)}`);
    const forgetContext = new ContextService(repo, async () => "仅包含忘记请求之后的新内容。");
    const before = await forgetContext.view(endingSession.id);
    await forgetContext.compactPreview(endingSession.id, randomUUID(), before.revision);
    const stored = (await repo.get("sessions", endingSession.id)).memory;
    assert.ok((stored?.forgottenThroughId ?? 0) >= opening.id, "compaction must preserve the forget watermark");
    await sendScenario(endingSession.id, "压缩后继续");
    const observed = seenGenerationState.at(-1)!;
    assert.ok(!observed.context.includes(privateTask));
    assert.notEqual(observed.activeTask, privateTask, "pre-forget expert task must not resurrect after compaction");
  }
}

console.log("✓ real runGreeting and temp-DB domain checks cover routing, replay, forms, endings, compaction and disabled experts");
} finally {
  await payload.destroy();
  await rm(dir, { recursive: true, force: true });
}
