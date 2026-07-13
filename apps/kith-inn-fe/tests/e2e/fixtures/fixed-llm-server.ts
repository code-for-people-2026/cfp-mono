import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

export const MAINLINE_DATE = "2026-07-13";
export const MAINLINE_ORDER_TEXT = `2026年7月13日午餐晚餐
王燕萍 2份午餐
王燕萍 1份晚餐
李阿姨 1份午餐`;
export const MAINLINE_MISSING_DATE_TEXT = `午餐
缺日阿姨 1份午餐`;
export const MAINLINE_CONFLICT_DATE_TEXT = `2026年7月13日星期二午餐
冲突阿姨 1份午餐`;
export const MAINLINE_ADDRESS_DATE = "2026-07-14";
export const MAINLINE_ADDRESS_TEXT = `2026年7月14日午餐
无址阿姨 1份午餐`;
export const MAINLINE_IDEMP_DATE = "2026-07-15";
export const MAINLINE_IDEMP_TEXT = `2026年7月15日午餐
王燕萍 2份午餐`;

type Message = { role?: string; content?: string };
type ChatRequest = { messages?: Message[]; tools?: unknown[] };

const parsedOrders = {
  mode: "snapshot",
  scope: [
    { date: MAINLINE_DATE, occasion: "lunch", dateEvidence: "2026年7月13日午餐晚餐" },
    { date: MAINLINE_DATE, occasion: "dinner", dateEvidence: "2026年7月13日午餐晚餐" },
  ],
  items: [
    { customerName: "王燕萍", date: MAINLINE_DATE, occasion: "lunch", quantity: 2, evidence: "王燕萍 2份午餐" },
    { customerName: "王燕萍", date: MAINLINE_DATE, occasion: "dinner", quantity: 1, evidence: "王燕萍 1份晚餐" },
    { customerName: "李阿姨", date: MAINLINE_DATE, occasion: "lunch", quantity: 1, evidence: "李阿姨 1份午餐" },
  ],
  unknownSegments: [],
};

const oneOrder = (date: string, dateEvidence: string, customerName: string, evidence: string, quantity = 1) => ({
  mode: "snapshot",
  scope: [{ date, occasion: "lunch", dateEvidence }],
  items: [{ customerName, date, occasion: "lunch", quantity, evidence }],
  unknownSegments: [],
});
const scenarios = new Map([
  [MAINLINE_ORDER_TEXT, parsedOrders],
  [MAINLINE_MISSING_DATE_TEXT, oneOrder(MAINLINE_DATE, "午餐", "缺日阿姨", "缺日阿姨 1份午餐")],
  [MAINLINE_CONFLICT_DATE_TEXT, oneOrder(MAINLINE_DATE, "2026年7月13日星期二午餐", "冲突阿姨", "冲突阿姨 1份午餐")],
  [MAINLINE_ADDRESS_TEXT, oneOrder(MAINLINE_ADDRESS_DATE, "2026年7月14日午餐", "无址阿姨", "无址阿姨 1份午餐")],
  [MAINLINE_IDEMP_TEXT, oneOrder(MAINLINE_IDEMP_DATE, "2026年7月15日午餐", "王燕萍", "王燕萍 2份午餐", 2)],
]);

function fixedResponse(body: ChatRequest): { status: number; body: unknown } {
  const messages = body.messages ?? [];
  const userText = [...messages].reverse().find((message) => message.role === "user")?.content;
  const parsed = userText ? scenarios.get(userText) : undefined;
  if (!parsed) return { status: 422, body: { error: "unknown fixed-llm input" } };
  const parserCall = messages.some((message) => message.role === "system" && message.content?.includes("订单输入解析器"));
  if (parserCall) return { status: 200, body: { choices: [{ message: { content: JSON.stringify(parsed) } }] } };
  if (!Array.isArray(body.tools) || body.tools.length === 0) return { status: 422, body: { error: "unsupported fixed-llm contract" } };
  const toolResult = [...messages].reverse().find((entry) => entry.role === "tool")?.content;
  const message = toolResult
    ? { content: toolResult }
    : {
        content: null,
        tool_calls: [{
          id: "mainline-record-orders",
          type: "function",
          function: { name: "record_orders", arguments: JSON.stringify({ rawText: userText }) },
        }],
      };
  return { status: 200, body: { choices: [{ message }] } };
}

const log = (event: string) => {
  if (process.env.FIXED_LLM_LOG_PATH) appendFileSync(process.env.FIXED_LLM_LOG_PATH, `${new Date().toISOString()} ${event}\n`);
};

function start() {
  const port = Number(process.env.FIXED_LLM_PORT ?? 3321);
  if (process.env.FIXED_LLM_LOG_PATH) writeFileSync(process.env.FIXED_LLM_LOG_PATH, "");
  createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200).end("ok");
      return;
    }
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404).end("not found");
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let result: ReturnType<typeof fixedResponse>;
    try {
      result = fixedResponse(JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChatRequest);
    } catch {
      result = { status: 400, body: { error: "invalid json" } };
    }
    log(`${result.status} ${request.url}`);
    response.writeHead(result.status, { "content-type": "application/json" }).end(JSON.stringify(result.body));
  }).listen(port, "127.0.0.1", () => console.log(`fixed-llm listening on http://127.0.0.1:${port}`));
}

if (process.env.FIXED_LLM_PORT) start();
