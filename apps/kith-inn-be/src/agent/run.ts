import type { CardPayload } from "@cfp/kith-inn-shared";
import { chatWithTools, type ChatMessage } from "../lib/llm/chatWithTools";
import { AGENT_TOOL_DEFS, AGENT_TOOLS, type AgentServices } from "./tools";

/**
 * 「今天」主 agent 的编排循环（PRD §5.5 / Tech Spec §4.1）。手搓 DeepSeek 原生
 * function-calling（非 SDK）：发 messages+tools → 若返回 tool_calls 就执行确定性工具、
 * 把结果作为 tool 消息回灌 → 再循环，直到模型给出文本答复或 maxSteps 用尽。
 *
 * 纪律：agent 只编排工具（确定性、可测）；范围外话题由 system prompt 礼貌挡回；maxSteps
 * 用尽或出错有确定性兜底（不编造）。`// ponytail:` maxSteps=7 浅环（record_orders + 查询
 * + 状态操作 = 多步）——DeepSeek tool-calling 稳定性见 Tech Spec §7，不稳时降级。
 *
 * 工具可附带一张结构化卡片（如新顾客确认卡）；本循环把最后一个非空 card 透传到响应，
 * 让前端用确定性卡片/按钮取代 LLM 口述（#97/#98）。
 */
export const AGENT_SYSTEM_PROMPT = `你是「桃子的灶台」（社区私房菜）的经营助手「味」，跟老板桃子对话。她用语音/文字记单、查状态、标送餐/收款。

能力（通过工具）：record_orders（批量记单：每条含 名字+地址+份数+餐次）、confirm_order、cancel_order、mark_paid、mark_delivered（地址）、get_today_summary（概况）、get_orders（订单列表卡）、get_delivery（送餐分拣卡）。

纪律：
- 只帮桃子经营私房菜。与经营无关的问题（天气、闲聊、别的App）礼貌挡回并引导回经营，例如「这个我帮不上，经营上的事尽管吩咐」。
- 事实以工具返回为准，绝不编造订单号/顾客/状态。没拿到 orderId 绝不能说"已记"。
- 新顾客：record_orders 会把他们收进「待确认」并回一张确认卡片。引导桃子点卡片里的「全部建档并记单」按钮确认——不要自己建顾客，也不要等桃子在对话里说"全部建档并记单"。
- 接龙日期默认按今天记；桃子明确说「明天 / X 号」才用那个日期。
- 接龙里每人一条（含地址）。回答简短、口语化、像街坊邻居。她话短你也短。
- 有歧义时简短确认（「是午餐 2 份对吗？」），别瞎记——错记是漏送根因。`;

const MAX_STEPS = 7;
const CONTEXT_TURNS = 5; // LLM 工作上下文：最近 ~5 轮（省 token、防陈旧上下文带偏）

/** Trim the displayed history to the recent N turns for the LLM context (≠ 展示历史). */
export function trimContext(history: ChatMessage[], turns = CONTEXT_TURNS): ChatMessage[] {
  return history.slice(-turns * 2);
}

/** Deterministic fallback when the loop can't produce an answer (maxSteps OR LLM failure).
 *  Never claims actions that weren't verified — returns a today-summary + ask to rephrase. */
async function fallbackToday(services: AgentServices): Promise<string> {
  try {
    const t = await services.getTodaySummary();
    return `这块我没完全处理过来。今天：草稿 ${t.unconfirmedOrders} / 待送 ${t.pendingDeliveries} / 未付 ${t.unpaidOrders}。能换种说法再说一遍吗？`;
  } catch {
    return "这块我没完全处理过来，能换种说法再说一遍吗？";
  }
}

export type RunAgentDeps = { chat?: typeof chatWithTools };

/**
 * Run one turn of the agent. Returns the assistant's final text answer + the last
 * non-empty card a tool emitted (if any) for the front-end to render.
 * @param deps.chat injectable LLM (tests script tool-call sequences).
 */
export async function runAgent(input: {
  userText: string;
  history: ChatMessage[];
  services: AgentServices;
  deps?: RunAgentDeps;
}): Promise<{ reply: string; card?: CardPayload }> {
  const chat = input.deps?.chat ?? chatWithTools;
  const messages: ChatMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...trimContext(input.history),
    { role: "user", content: input.userText },
  ];
  // Last non-empty card from any tool this turn — passed through to the response.
  let card: CardPayload | undefined;

  for (let step = 0; step < MAX_STEPS; step++) {
    let res;
    try {
      res = await chat({ messages, tools: AGENT_TOOL_DEFS });
    } catch {
      // LLM call failed (non-2xx / network / DeepSeek outage) — deterministic fallback, don't reject.
      return { reply: await fallbackToday(input.services), card };
    }
    if (res.toolCalls.length === 0) {
      return { reply: res.content ?? "没听清，能再说一遍吗？比如「王燕萍 午餐 2 份」。", card };
    }
    messages.push({
      role: "assistant",
      content: res.content ?? "",
      tool_calls: res.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } })),
    });
    for (const tc of res.toolCalls) {
      const tool = AGENT_TOOLS.find((t) => t.def.function.name === tc.name);
      // Known tool → { text, card? }; unknown tool → a plain text result.
      const result: { text: string; card?: CardPayload } = tool
        ? await tool.execute(input.services, tc.args)
        : { text: `工具 ${tc.name} 不存在` };
      if (result.card) card = result.card; // last non-empty card wins
      messages.push({ role: "tool", content: result.text, tool_call_id: tc.id });
    }
  }
  // maxSteps exhausted — deterministic fallback.
  return { reply: await fallbackToday(input.services), card };
}
