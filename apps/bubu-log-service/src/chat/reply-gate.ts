import { z } from "zod";
import type { ReplyQuestion, ReplyQuestionOrigin } from "./contracts";

const modelChoiceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(80),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("reply"), text: z.string().trim().min(1).max(500) }).strict(),
    z.object({ type: z.literal("custom") }).strict(),
  ]),
}).strict();
export const replyCandidateSchema = z.object({
  text: z.string().trim().max(8000),
  questions: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(500),
    choices: z.array(modelChoiceSchema).min(2).max(12),
  }).strict()).max(8),
}).strict();
export type ReplyCandidate = z.output<typeof replyCandidateSchema>;

export const replyCandidateJsonSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["text", "questions"],
  properties: {
    text: { type: "string", maxLength: 8000 },
    questions: { type: "array", maxItems: 8, items: {
      type: "object", additionalProperties: false, required: ["id", "prompt", "choices"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 120 },
        prompt: { type: "string", minLength: 1, maxLength: 500 },
        choices: { type: "array", minItems: 2, maxItems: 12, items: {
          type: "object", additionalProperties: false, required: ["id", "label", "action"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: 120 },
            label: { type: "string", minLength: 1, maxLength: 80 },
            action: { anyOf: [
              { type: "object", additionalProperties: false, required: ["type", "text"], properties: { type: { const: "reply" }, text: { type: "string", minLength: 1, maxLength: 500 } } },
              { type: "object", additionalProperties: false, required: ["type"], properties: { type: { const: "custom" } } },
            ] },
          },
        } },
      },
    } },
  },
};

const verdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  issues: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict().superRefine((value, ctx) => {
  if (value.verdict === "pass" && value.issues.length) ctx.addIssue({ code: "custom", path: ["issues"], message: "pass must have no issues" });
  if (value.verdict === "fail" && !value.issues.length) ctx.addIssue({ code: "custom", path: ["issues"], message: "fail must explain issues" });
});
export const replyVerdictJsonSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["verdict", "issues"],
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    issues: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 500 } },
  },
};

export const REPLY_OUTPUT_INSTRUCTIONS = `最终用户可见回复必须是严格 JSON，完全符合提供的 JSON Schema：text 是纯陈述说明；questions 是所有需要用户回答的结构化选择题。
只要要求用户回答、确认、核对、选择、补充、上传或执行操作，就必须放进 questions，不能藏在 text 中；没有问号的“告诉我奶量”“请补充时间”也算追问。文字里的 A/B 列表不算可点击选项。
每题必须至少有两个具体、有意义、互不重复的 reply 选项；“自定义”不计入这两个具体选项。不要生成单独的“不知道/不确定”选项；需要表达不确定或开放回答时加入 custom，由用户自行说明，并且 custom 必须是最后一个选项，不能给默认输入。
choice.action.type=reply 时 text 是按钮点击后由用户明确发送的自然语言答案；type=custom 不带 text。不要输出版本、宝宝、事件、工具、保存回执或权限字段，服务器会绑定来源上下文。
记录字段的数值待补由服务器表单呈现，不要在 questions 重复。保存成功只能依据工具回执；没有工具回执不能声称已保存。`;

export const REPLY_VALIDATOR_INSTRUCTIONS = `你是发送前语义校验器，不回答用户问题，也绝不调用工具。只返回严格 JSON verdict。
检查完整候选：text 必须完全是陈述，不得包含任何显式或隐式追问、命令式索取、让用户确认/核对/选择/补充/上传的要求；无问号的“告诉我奶量”也必须判失败。纯文字 A/B 列表不算按钮。
所有用户需要回答的内容必须在 questions；每题至少两个具体、有意义且互斥的可点答案，不能只靠自定义、不知道或打开填空。自定义若存在必须最后。问题与按钮必须语义对应，不伪造事实、操作回执或默认输入。
普通陈述性回执、只读查询答案和规律总结可以通过。verdict=pass 时 issues 必须为空；fail 时逐项给出具体问题。`;

export function parseReplyCandidate(value: string): ReplyCandidate {
  return replyCandidateSchema.parse(JSON.parse(value));
}

export function parseReplyVerdict(value: string): { verdict: "pass" | "fail"; issues: string[] } {
  return verdictSchema.parse(JSON.parse(value));
}

const requestPattern = /(?:^|[，。；！？!?\s])(?:(?:请|请你|麻烦你?|需要你|希望你|你可以|能否|可以请你|可以)\s*)?(?:(?:再|继续|直接|先)\s*)?(?:告诉我|说说|说一声|说明一下|描述一下|补充(?:一下)?|提供(?:一下)?|确认一下|核对一下|选择(?:一下)?|回答(?:一下)?|回复(?:一下)?|填写(?:一下)?|输入(?:一下)?|上传(?:一下)?|发送(?:一下)?|发来|发一张|拍一张|选一下|看一下)/;
const questionEnding = /(?:多少|多久|几点|哪(?:个|些|一)|什么|是否|还是|吗|么|呢)(?:[。！!…]*)$/;
export function hiddenRequestIssues(text: string): string[] {
  const issues: string[] = [];
  for (const raw of text.split(/\n+|(?<=[。！？!?])/).map(value => value.trim()).filter(Boolean)) {
    if (/[？?]/.test(raw) || requestPattern.test(raw) || questionEnding.test(raw)) issues.push(`text 中存在未结构化追问或请求：“${raw.slice(0, 120)}”`);
  }
  return issues;
}

const nonConcrete = /不知道|不确定|无法判断|不清楚|自定义|其他/;
export function deterministicCandidateIssues(candidate: ReplyCandidate): string[] {
  const issues = hiddenRequestIssues(candidate.text);
  const questionIds = new Set<string>();
  for (const question of candidate.questions) {
    if (questionIds.has(question.id)) issues.push(`问题 ID 重复：${question.id}`);
    questionIds.add(question.id);
    const choiceIds = new Set<string>();
    const labels = new Set<string>();
    let concrete = 0;
    question.choices.forEach((choice, index) => {
      if (choiceIds.has(choice.id)) issues.push(`问题 ${question.id} 的选项 ID 重复：${choice.id}`);
      if (labels.has(choice.label)) issues.push(`问题 ${question.id} 的选项文字重复：${choice.label}`);
      choiceIds.add(choice.id); labels.add(choice.label);
      if (choice.action.type === "custom" && index !== question.choices.length - 1) issues.push(`问题 ${question.id} 的自定义选项必须排在最后`);
      if (choice.action.type === "reply" && !nonConcrete.test(choice.label)) concrete++;
    });
    if (concrete < 2) issues.push(`问题 ${question.id} 至少需要两个具体可选答案，不能只提供自定义或不知道`);
  }
  return issues;
}

export function bindCandidateQuestions(candidate: ReplyCandidate, origin: ReplyQuestionOrigin): ReplyQuestion[] {
  return candidate.questions.map(question => ({ ...question, origin: { ...origin } }));
}

export function validateRenderableQuestions(questions: ReplyQuestion[]): string[] {
  const issues: string[] = [];
  for (const question of questions) {
    if (!question.id.trim() || !question.prompt.trim()) issues.push("选择题缺少可显示的 ID 或题目");
    if (question.choices.length < 2) issues.push(`问题 ${question.id} 缺少足够选项`);
    if (new Set(question.choices.map(choice => choice.id)).size !== question.choices.length) issues.push(`问题 ${question.id} 的选项 ID 重复`);
    const concrete = question.choices.filter(choice => choice.action.type !== "custom" && !nonConcrete.test(choice.label)).length;
    if (concrete < 2) issues.push(`问题 ${question.id} 缺少两个具体可显示选项`);
    question.choices.forEach((choice, index) => {
      if (!choice.label.trim()) issues.push(`问题 ${question.id} 有空选项`);
      if (choice.action.type === "custom" && index !== question.choices.length - 1) issues.push(`问题 ${question.id} 的自定义选项不在最后`);
      if ((choice.action.type === "reply" || choice.action.type === "input" || choice.action.type === "attach" || choice.action.type === "reference") && !choice.action.text.trim()) issues.push(`问题 ${question.id} 的动作缺少文字载荷`);
      if (choice.action.type === "reference" && !choice.action.attachmentIds.length) issues.push(`问题 ${question.id} 的照片选项没有引用`);
    });
  }
  return issues;
}

export function safeHistoricalReply(text: string, _questions: ReplyQuestion[] | undefined, gate?: { checked: true; version?: 1 }, serverSummary = ""): string {
  if (gate?.version === 1) return text;
  if (serverSummary.trim()) return serverSummary;
  if (!text.trim()) return "";
  // Pre-gate assistant prose was never checked as a whole. Do not use a regex
  // allowlist to promote an arbitrary old answer into trusted history.
  return "这条旧版回复未经过当前发送检查，已停止显示。当前记录与待补状态以下方内容为准。";
}
