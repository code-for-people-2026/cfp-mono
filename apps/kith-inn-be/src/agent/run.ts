import { chatWithTools, type ChatMessage } from "../lib/llm/chatWithTools";
import { AGENT_TOOL_DEFS, AGENT_TOOLS, type AgentServices } from "./tools";

/**
 * 「今天」主 agent 的编排循环（PRD §5.5 / Tech Spec §4.1）。手搓 DeepSeek 原生
 * function-calling（非 SDK）：发 messages+tools → 若返回 tool_calls 就执行确定性工具、
 * 把结果作为 tool 消息回灌 → 再循环，直到模型给出文本答复或 maxSteps 用尽。
 *
 * 纪律：agent 只编排工具（确定性、可测）；范围外话题由 system prompt 礼貌挡回；maxSteps
 * 用尽或出错有确定性兜底（不编造）。`// ponytail:` maxSteps=5 浅环——DeepSeek tool-calling
 * 稳定性见 Tech Spec §7，不稳时降级（兜底返回 todaySummary 摘要）。
 */
export const AGENT_SYSTEM_PROMPT = `你是「桃子的灶台」（社区私房菜）的经营助手「味」，跟老板桃子对话。她用语音/文字记单、查状态、标送餐/收款。

能力（通过工具）：record_order（记单：名字+份数+餐次）、confirm_order、cancel_order、mark_paid、mark_delivered（楼栋/房号）、get_today_summary。

纪律：
- 只帮桃子经营私房菜。与经营无关的问题（天气、闲聊、别的App）礼貌挡回并引导回经营，例如「这个我帮不上，经营上的事尽管吩咐」。
- 事实以工具返回为准，绝不编造订单号/顾客/状态。
- 回答简短、口语化、像街坊邻居。她话短你也短。
- 有歧义时简短确认（「是午餐 2 份对吗？」），别瞎记——错记是漏送根因。`;

const MAX_STEPS = 5;
const CONTEXT_TURNS = 5; // LLM 工作上下文：最近 ~5 轮（省 token、防陈旧上下文带偏）

/** Trim the displayed history to the recent N turns for the LLM context (≠ 展示历史). */
export function trimContext(history: ChatMessage[], turns = CONTEXT_TURNS): ChatMessage[] {
  return history.slice(-turns * 2);
}

export type RunAgentDeps = { chat?: typeof chatWithTools };

/**
 * Run one turn of the agent. Returns the assistant's final text answer.
 * @param deps.chat injectable LLM (tests script tool-call sequences).
 */
export async function runAgent(input: {
  userText: string;
  history: ChatMessage[];
  services: AgentServices;
  deps?: RunAgentDeps;
}): Promise<string> {
  const chat = input.deps?.chat ?? chatWithTools;
  const messages: ChatMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...trimContext(input.history),
    { role: "user", content: input.userText },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await chat({ messages, tools: AGENT_TOOL_DEFS });
    if (res.toolCalls.length === 0) {
      return res.content ?? "没听清，能再说一遍吗？比如「王燕萍 午餐 2 份」。";
    }
    messages.push({
      role: "assistant",
      content: res.content ?? "",
      tool_calls: res.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } })),
    });
    for (const tc of res.toolCalls) {
      const tool = AGENT_TOOLS.find((t) => t.def.function.name === tc.name);
      const result = tool ? await tool.execute(input.services, tc.args) : `工具 ${tc.name} 不存在`;
      messages.push({ role: "tool", content: result, tool_call_id: tc.id });
    }
  }
  // maxSteps exhausted — deterministic fallback (don't claim actions not verified).
  try {
    const t = await input.services.getTodaySummary();
    return `这块我没完全处理过来。今天：草稿 ${t.unconfirmedOrders} / 待送 ${t.pendingDeliveries} / 未付 ${t.unpaidOrders}。能换种说法再说一遍吗？`;
  } catch {
    return "这块我没完全处理过来，能换种说法再说一遍吗？";
  }
}
