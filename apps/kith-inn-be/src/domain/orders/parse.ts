import { z } from "zod";
import { callDeepSeek } from "../../lib/deepseek/client";

/**
 * 接龙 → 结构化订单解析（PRD §6.1 — "这是该上 LLM 的地方"）。格式是软的：整天/半天/
 * 单餐都可能、份数中英混、餐次位置不定、一段含午+晚两菜单——靠 LLM 智能分午晚，不写死格式。
 *
 * `// ponytail:` hand-rolled on the plain `callDeepSeek` client (chat completion,
 * NO `response_format`) + zod validation + retry. The Vercel AI SDK's
 * `generateObject` was tried first (PR2 plan A) but DeepSeek rejects every
 * `response_format` type ("This response_format type is unavailable now") and the
 * SDK v7 API gives no clean way to disable it for object generation. The SDK is
 * deferred to PR5's agent (`generateText` tool-loop). §7 risk, de-risked here:
 * DeepSeek (deepseek-chat, non-thinking) follows a JSON instruction reliably.
 */
const occasionSchema = z.enum(["breakfast", "brunch", "lunch", "dinner", "all-day"]);

const itemSchema = z.object({
  customerName: z.string(),
  quantity: z.number().int().positive(),
  occasion: occasionSchema,
  note: z.string().optional(),
});

export const parsedOrderSchema = z.object({
  items: z.array(itemSchema),
  unknownSegments: z.array(z.string()),
});

export type ParsedOrder = z.infer<typeof parsedOrderSchema>;

export const PARSE_SYSTEM_PROMPT = `你是社区私房菜（桃子的灶台）的订单解析助手。用户会粘贴微信群「接龙」。提取订单，规则：

【什么是订单行】形如「序号. 名字 份数 餐次」。例如「1. 桃子 8份晚餐」「2. lily 1份晚餐」「3. 苏月兰 晚餐一份」。

【要忽略的行】
- 菜单行：编号的菜品（如「1.凉拌牛肉」「2.客家酿豆腐」）——那是今天做什么菜，不是谁订了餐。
- 「例」行：形如「例 桃子 1份午餐晚餐」——那是格式示例，不是真实订单，必须忽略。
- 标题行：「#接龙」「X号星期Y午餐/晚餐预定接龙（30元）」——用标题判断餐次，但标题本身不是订单。

【份数】中文数字转阿拉伯：一份=1、两份=2、三份=3、八份=8；「8份」「1份」直接取数字。

【餐次】从订单行内文字判断（午餐/晚餐），行内没有则看接龙标题（标题含「午餐」→lunch、含「晚餐」→dinner）。午餐=lunch，晚餐=dinner。若一行同时含午+晚（如「1份午餐晚餐」），拆成两条 item（各 occasion 不同）。

【顾客名】原样保留，不要改大小写、不要去空格、不要去连字符（lily / Catherine chen / Sissi-CC 都原样）。

【宁缺毋滥】读不懂、不像订单、或无法确定餐次的行，放进 unknownSegments（原文整行），绝不瞎猜。错落是漏送的根因。

【输出】只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码块。形如：
{"items":[{"customerName":"桃子","quantity":8,"occasion":"dinner"}],"unknownSegments":[]}
其中 occasion 取值：breakfast | brunch | lunch | dinner | all-day`;

/** Injectable LLM-call boundary so unit tests script the parse without a network call. */
export type GenerateParsed = (input: { system: string; prompt: string }) => Promise<ParsedOrder>;

/** Pull the first {...} JSON object out of a possibly-fenced/prose-wrapped response. */
function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object in response");
  return JSON.parse(body.slice(start, end + 1));
}

const MAX_PARSE_RETRIES = 1;

const defaultGenerate: GenerateParsed = async (input) => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const content = await callDeepSeek({
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt },
      ],
      maxTokens: 4000,
      // Pin to the NON-thinking model: deepseek-v4-flash (callDeepSeek's default)
      // is a thinking model — rejects response_format + returns empty content at
      // low token budgets. An explicit DEEPSEEK_MODEL still wins (Codex).
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    });
    try {
      return parsedOrderSchema.parse(extractJsonObject(content));
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`接龙解析失败（重试后仍无效）: ${String(lastErr)}`);
};

/**
 * Parse a 接龙 paste into structured order items + unknown segments.
 * @param generate injectable (tests mock it); defaults to the real DeepSeek call.
 */
export async function parseJielong(rawText: string, generate: GenerateParsed = defaultGenerate): Promise<ParsedOrder> {
  return generate({ system: PARSE_SYSTEM_PROMPT, prompt: rawText });
}
