import type { CardPayload } from "@cfp/kith-inn-shared";
import { chatWithTools, type ChatMessage } from "../lib/llm/chatWithTools";
import { todayShanghai } from "../lib/domainUtil";
import { AGENT_TOOL_DEFS, AGENT_TOOLS, type AgentServices } from "./tools";

/**
 * 「今天」主 agent 的编排循环（PRD §5.5 / Tech Spec §4.1）。手搓 DeepSeek 原生
 * function-calling（非 SDK）：发 messages+tools → 若返回 tool_calls 就执行受控工具、
 * 把结果作为 tool 消息回灌 → 再循环，直到模型给出文本答复或 maxSteps 用尽。
 *
 * 纪律：agent 只编排工具（可测）；范围外话题由 system prompt 礼貌挡回；maxSteps
 * 用尽或出错有兜底（不编造）。`// ponytail:` maxSteps=7 浅环（record_orders + 查询
 * + 状态操作 = 多步）——DeepSeek tool-calling 稳定性见 Tech Spec §7，不稳时降级。
 *
 * 工具可附带一张结构化卡片（如新顾客确认卡）；本循环把最后一个非空 card 透传到响应，
 * 让前端用结构化卡片/按钮取代 LLM 口述（#97/#98）。
 */
export const AGENT_SYSTEM_PROMPT = `你是「桃子的灶台」（社区私房菜）的经营助手「味」，跟老板桃子对话。她用语音/文字记单、查状态、标送餐/收款、管理菜单。

能力（通过工具）：record_orders（批量记单：每条含 名字+地址+份数+餐次）、confirm_order、cancel_order、mark_paid、mark_unpaid（回退付款）、get_today_summary（概况）、get_orders（订单列表卡）、get_delivery（送餐分拣卡）、get_menu（查菜单）、generate_menu（生成/重排菜单）、swap_dish（换一道菜）、publish_menu（发布菜单+接龙文案）、get_dish_pool（查菜品池所有菜）。

纪律：
- 只帮桃子经营私房菜。与经营无关的问题（天气、闲聊、别的App）礼貌挡回并引导回经营，例如「这个我帮不上，经营上的事尽管吩咐」。
- **所有写操作（记单/确认/取消/标已付/回退付款/排菜/换菜/发布/加菜）都会返回确认卡——引导桃子点卡片里的「确认」按钮，不要在对话里打字确认。** 工具不直接落库，先出预览卡，桃子点了确认才执行。
- 事实以工具返回为准，绝不编造订单号/顾客/状态/菜名。没拿到 orderId/planId 绝不能说"已记/已排/已发"。
- 新顾客：record_orders 的确认卡会标出哪些是新顾客、留地址输入框。引导桃子填好地址点卡片里的「确认」——不要自己建顾客，也不要等桃子在对话里说"确认"。
- 接龙日期默认按今天记；桃子明确说「明天 / X 号」才用那个日期。
- 接龙里每人一条（含地址）。回答简短、口语化、像街坊邻居。她话短你也短。
- 有歧义时简短确认（「是午餐 2 份对吗？」），别瞎记——错记是漏送根因。
- 菜单操作需要 planId 时，先调 get_menu 拿到 planId 再操作。
- 已发出的菜单（published）改菜/重排时，工具会提示需确认——引导桃子确认后再带 force 重调。`;

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
  // Dynamic date injection (Codex #121 P2): LLM needs today's date to resolve "明天"/"后天".
  const today = todayShanghai();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = todayShanghai(tomorrow);
  const systemPrompt = `${AGENT_SYSTEM_PROMPT}\n\n今天是 ${today}。明天是 ${tomorrowStr}。用户说"明天"时用 ${tomorrowStr}。`;
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
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
      if (result.card) {
        // A write-op confirm card (operation-confirm) must NOT be overwritten by a
        // read card (orders/delivery) emitted later in the same turn — the pending
        // op is stored server-side, and losing its confirm button strands the write
        // until 桃子 retries. Write cards win; only a newer write card replaces one.
        const isWrite = (c?: CardPayload) => c?.type === "operation-confirm";
        if (!isWrite(card) || isWrite(result.card)) card = result.card;
      }
      messages.push({ role: "tool", content: result.text, tool_call_id: tc.id });
    }
  }
  // maxSteps exhausted — deterministic fallback.
  return { reply: await fallbackToday(input.services), card };
}
