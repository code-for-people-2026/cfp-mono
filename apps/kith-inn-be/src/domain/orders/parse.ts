import { calendarDateSchema } from "@cfp/kith-inn-shared/schemas";
import { z } from "zod";
import { callDeepSeek } from "../../lib/deepseek/client";

const mealSchema = z.enum(["lunch", "dinner"]);
const scopeSchema = z.object({
  date: calendarDateSchema,
  occasion: mealSchema,
  dateEvidence: z.string().trim().min(1),
});
const itemSchema = z.object({
  customerName: z.string().trim().min(1),
  date: calendarDateSchema,
  occasion: mealSchema,
  quantity: z.number().int().positive(),
  evidence: z.string().trim().min(1).optional(),
});

export const rawParsedOrderInputSchema = z.object({
  mode: z.enum(["snapshot", "increment"]),
  operation: z.enum(["add", "set"]).optional(),
  operationEvidence: z.string().trim().min(1).optional(),
  scope: z.array(scopeSchema).min(1),
  items: z.array(itemSchema),
  unknownSegments: z.array(z.string().trim().min(1)),
});

export type RawParsedOrderInput = z.infer<typeof rawParsedOrderInputSchema>;
export type ParseIssue = {
  code:
    | "date-evidence-missing"
    | "date-unresolvable"
    | "date-conflict"
    | "date-mismatch"
    | "weekday-mismatch"
    | "occasion-evidence-missing"
    | "operation-evidence-missing"
    | "operation-evidence-mismatch"
    | "item-evidence-missing"
    | "item-evidence-mismatch"
    | "duplicate-scope"
    | "item-outside-scope"
    | "unknown-segment"
    | "empty-snapshot"
    | "increment-shape";
  message: string;
  evidence?: string;
};
export type ParsedOrderInput = RawParsedOrderInput & { issues: ParseIssue[] };

export type GenerateParsed = (input: { system: string; prompt: string }) => Promise<RawParsedOrderInput>;

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"] as const;

const toDate = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + days));
  return toDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function resolveDateEvidence(evidence: string, referenceDate: string): { date?: string; conflict: boolean } {
  const dates = new Set<string>();
  let invalid = false;
  const add = (date: string) => {
    if (calendarDateSchema.safeParse(date).success) dates.add(date);
    else invalid = true;
  };

  if (evidence.includes("今天")) add(referenceDate);
  if (evidence.includes("明天")) add(addDays(referenceDate, 1));
  if (evidence.includes("后天")) add(addDays(referenceDate, 2));

  const explicitRanges: Array<[number, number]> = [];
  for (const match of evidence.matchAll(/(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*(?:日|号)?/g)) {
    add(toDate(Number(match[1]), Number(match[2]), Number(match[3])));
    explicitRanges.push([match.index, match.index + match[0].length]);
  }
  const referenceYear = Number(referenceDate.slice(0, 4));
  for (const match of evidence.matchAll(/(\d{1,2})\s*(?:月|[/.])\s*(\d{1,2})\s*(?:日|号)?/g)) {
    const end = match.index + match[0].length;
    if (!explicitRanges.some(([start, explicitEnd]) => start <= match.index && end <= explicitEnd)) {
      add(toDate(referenceYear, Number(match[1]), Number(match[2])));
    }
  }

  return { date: !invalid && dates.size === 1 ? dates.values().next().value : undefined, conflict: dates.size > 1 };
}

const MEAL_EVIDENCE = {
  lunch: /午餐|午饭|中午|午\s*[、和及/]?\s*晚餐/,
  dinner: /晚餐|晚饭|晚上/,
} as const;

function operationFromEvidence(evidence: string): "add" | "set" | undefined {
  const add = /追加|再加|多加|加/.test(evidence);
  const set = /改成|改为|总共/.test(evidence);
  return add === set ? undefined : add ? "add" : "set";
}

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function chineseInteger(value: string): number | undefined {
  if (!/[十百]/.test(value)) {
    const digits = [...value].map((char) => CN_DIGITS[char]);
    return digits.every((digit) => digit !== undefined) ? Number(digits.join("")) : undefined;
  }
  let total = 0;
  let digit = 0;
  for (const char of value) {
    if (char in CN_DIGITS) digit = CN_DIGITS[char]!;
    else if (char === "十") { total += (digit || 1) * 10; digit = 0; }
    else if (char === "百") { total += (digit || 1) * 100; digit = 0; }
    else return undefined;
  }
  return total + digit;
}

function statedQuantities(evidence: string): number[] {
  return [...evidence.matchAll(/(\d+|[零〇一二两三四五六七八九十百]+)\s*份/g)]
    .map((match) => /^\d+$/.test(match[1]!) ? Number(match[1]) : chineseInteger(match[1]!))
    .filter((quantity): quantity is number => quantity !== undefined);
}

function statedWeekday(evidence: string): string | undefined {
  return evidence.match(/(?:星期|周)\s*([一二三四五六日天])/)?.[1]?.replace("天", "日");
}

function actualWeekday(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()]!;
}

function validateParsed(rawText: string, parsed: RawParsedOrderInput, referenceDate: string): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const scopeKeys = new Set<string>();
  for (const scope of parsed.scope) {
    const key = `${scope.date}|${scope.occasion}`;
    if (scopeKeys.has(key)) issues.push({ code: "duplicate-scope", message: `日期餐次重复：${scope.date} ${scope.occasion}` });
    scopeKeys.add(key);

    if (!rawText.includes(scope.dateEvidence)) {
      issues.push({ code: "date-evidence-missing", message: `原文中找不到日期依据：${scope.dateEvidence}`, evidence: scope.dateEvidence });
      continue;
    }
    if (!MEAL_EVIDENCE[scope.occasion].test(scope.dateEvidence)) {
      issues.push({ code: "occasion-evidence-missing", message: `日期餐次依据没有明确${scope.occasion === "lunch" ? "午餐" : "晚餐"}：${scope.dateEvidence}`, evidence: scope.dateEvidence });
    }
    const resolution = resolveDateEvidence(scope.dateEvidence, referenceDate);
    if (resolution.conflict) {
      issues.push({ code: "date-conflict", message: `日期依据包含互相冲突的日期：${scope.dateEvidence}`, evidence: scope.dateEvidence });
      continue;
    }
    const resolved = resolution.date;
    if (!resolved) {
      issues.push({ code: "date-unresolvable", message: `日期依据无法解析：${scope.dateEvidence}`, evidence: scope.dateEvidence });
      continue;
    }
    if (resolved !== scope.date) {
      issues.push({ code: "date-mismatch", message: `日期依据 ${scope.dateEvidence} 应为 ${resolved}，不是 ${scope.date}`, evidence: scope.dateEvidence });
    }
    const weekday = statedWeekday(scope.dateEvidence);
    if (weekday && weekday !== actualWeekday(resolved)) {
      issues.push({ code: "weekday-mismatch", message: `${scope.dateEvidence} 的日期与周几不一致`, evidence: scope.dateEvidence });
    }
  }

  for (const item of parsed.items) {
    if (!scopeKeys.has(`${item.date}|${item.occasion}`)) {
      issues.push({ code: "item-outside-scope", message: `${item.customerName} 的 ${item.date} ${item.occasion} 不在接龙标题范围内` });
    }
    const evidenceLine = item.evidence && rawText.split(/\r?\n/).find((line) => line.includes(item.evidence!) && !/^\s*(?:例|示例)(?:\s|[:：])/.test(line));
    if (!item.evidence || !evidenceLine) {
      issues.push({ code: "item-evidence-missing", message: `原文中找不到 ${item.customerName} 的订单依据`, evidence: item.evidence });
    } else if (!item.evidence.includes(item.customerName) || !statedQuantities(item.evidence).includes(item.quantity)) {
      issues.push({ code: "item-evidence-mismatch", message: `${item.customerName} 的顾客或份数与原文依据不一致：${item.evidence}`, evidence: item.evidence });
    }
  }
  for (const segment of parsed.unknownSegments) {
    issues.push({ code: "unknown-segment", message: `这行像订单但没解析完整：${segment}`, evidence: segment });
  }
  if (parsed.mode === "snapshot") {
    if (parsed.operation || parsed.operationEvidence) issues.push({ code: "increment-shape", message: "完整接龙不能带单笔增量动作" });
    if (parsed.items.length === 0) issues.push({ code: "empty-snapshot", message: "接龙里没有明确订单，不能据此清空现有订单" });
  } else {
    if (!parsed.operation || parsed.items.length !== 1 || parsed.scope.length !== 1) {
      issues.push({ code: "increment-shape", message: "单独补单必须只有一个日期、餐次、顾客、份数和明确动作" });
    }
    if (!parsed.operationEvidence || !rawText.includes(parsed.operationEvidence)) {
      issues.push({ code: "operation-evidence-missing", message: "原文中找不到明确的增量动作（如“加”或“改成”）", evidence: parsed.operationEvidence });
    } else if (operationFromEvidence(parsed.operationEvidence) !== parsed.operation) {
      issues.push({ code: "operation-evidence-mismatch", message: `增量动作依据与解析结果不一致：${parsed.operationEvidence}`, evidence: parsed.operationEvidence });
    }
  }
  return issues;
}

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("no JSON object in response");
  return JSON.parse(body.slice(start, end + 1));
}

export function buildParseSystemPrompt(referenceDate: string): string {
  return `你是「桃子的灶台」订单输入解析器。Asia/Shanghai 的参考日期是 ${referenceDate}。用户输入可能是完整微信群接龙，也可能是一句单独补单。

【模式】
- 有接龙标题、菜单、编号订单列表的完整文本：mode=snapshot，表示 scope 范围内最终完整清单。
- 一句话只操作某个顾客某天某餐：mode=increment；“加/再加/多加/追加 N 份” operation=add，“改成/改为/总共 N 份” operation=set。operationEvidence 逐字复制表达动作的最短原文；没有明确动作时不要猜，放入 unknownSegments。

【日期与 scope】
- 每个接龙标题都输出一个 scope；午餐=lunch，晚餐=dinner。标题午晚餐合写时输出两个 scope。
- date 必须是 YYYY-MM-DD。省略年份用参考日期的年份；今天/明天/后天相对参考日期计算。绝不因为缺日期默认今天。
- dateEvidence 必须逐字复制用户原文中同时包含日期、餐次（以及若有周几）的最短连续片段，例如“6.8号星期一晚餐”“明天晚餐”。不要改写证据，也不要因为原文缺餐次而默认午餐或晚餐。
- 订单行按其明确餐次映射对应 scope；单餐模板中没写餐次可继承唯一餐次，多餐时不明确则放 unknownSegments。

【订单】
- items 每条必须含 customerName、date、occasion、正整数 quantity 和 evidence；evidence 逐字复制同时包含顾客名和份数的最短原文片段。同一人午晚餐拆两条。
- 菜单编号菜名、价格、“例 桃子 1份午餐晚餐”、空白编号都忽略，不放 items，也不放 unknownSegments。
- 只有疑似真实顾客订单但缺关键字段/读不懂的原文行才放 unknownSegments。宁缺毋滥，不猜。
- 顾客名原样保留大小写、空格和连字符。

只输出 JSON，不要 markdown 或解释。snapshot 示例：
{"mode":"snapshot","scope":[{"date":"2020-06-08","occasion":"dinner","dateEvidence":"6.8号星期一晚餐"}],"items":[{"customerName":"桃子","date":"2020-06-08","occasion":"dinner","quantity":8,"evidence":"桃子   8份晚餐"}],"unknownSegments":[]}
increment 示例：
{"mode":"increment","operation":"add","operationEvidence":"加","scope":[{"date":"2026-07-13","occasion":"dinner","dateEvidence":"明天晚餐"}],"items":[{"customerName":"王阿姨","date":"2026-07-13","occasion":"dinner","quantity":2,"evidence":"加王阿姨2份"}],"unknownSegments":[]}`;
}

const MAX_PARSE_RETRIES = 1;

const defaultGenerate: GenerateParsed = async ({ system, prompt }) => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const content = await callDeepSeek({
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      maxTokens: 4000,
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    });
    try {
      return rawParsedOrderInputSchema.parse(parseJsonObject(content));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`接龙解析失败（重试后仍无效）: ${String(lastError)}`);
};

export async function parseOrderInput(
  rawText: string,
  options: { referenceDate: string; generate?: GenerateParsed },
): Promise<ParsedOrderInput> {
  const referenceDate = calendarDateSchema.parse(options.referenceDate);
  const parsed = rawParsedOrderInputSchema.parse(await (options.generate ?? defaultGenerate)({
    system: buildParseSystemPrompt(referenceDate),
    prompt: rawText,
  }));
  return { ...parsed, issues: validateParsed(rawText, parsed, referenceDate) };
}
