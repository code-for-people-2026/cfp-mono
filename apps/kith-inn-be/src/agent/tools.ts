import type { CardPayload } from "@cfp/kith-inn-shared";
import type { ToolDef } from "../lib/llm/chatWithTools";

/**
 * 「今天」主 agent 的工具（PRD §5.5）。agent 只**编排**这些确定性操作，不持业务逻辑——
 * 与「菜单/订单/送餐」详情 tab 同一套后端操作（两个前门、一套实现）。`AgentServices`
 * 是这些操作的服务端抽象（生产里 cms-backed，测试里 mock）。
 */

/** The deterministic operations the agent's tools drive (DI — mock in tests). */
export type AgentServices = {
  recordOrders(
    items: Array<{ customerName: string; address?: string; quantity: number; occasion: "lunch" | "dinner"; date?: string }>,
  ): Promise<{
    recorded: Array<{ name: string; orderId: string | number }>;
    needsConfirmation: Array<{ customerName: string; address?: string; quantity: number; occasion: "lunch" | "dinner" }>;
    failed: Array<{ customerName: string; error: string }>;
  }>;
  createCustomersAndOrders(
    items: Array<{ displayName: string; address?: string; quantity: number; occasion: "lunch" | "dinner"; date?: string }>,
  ): Promise<{ created: Array<{ name: string; orderId: string | number }>; failed: Array<{ displayName: string; error: string }> }>;
  confirmOrder(input: { orderId: string | number }): Promise<{ ok: true } | { ok: false; error: string }>;
  cancelOrder(input: { orderId: string | number }): Promise<{ ok: true } | { ok: false; error: string }>;
  markPaid(input: { orderId: string | number }): Promise<{ ok: true } | { ok: false; error: string }>;
  markDelivered(input: { address: string }): Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  getTodaySummary(): Promise<{ unconfirmedOrders: number; pendingDeliveries: number; unpaidOrders: number; recentOrders: string }>;
};

export type AgentTool = {
  def: ToolDef;
  execute: (services: AgentServices, args: Record<string, unknown>) => Promise<{ text: string; card?: CardPayload }>;
};

const occasionZh = (o: unknown) => (o === "lunch" ? "午餐" : o === "dinner" ? "晚餐" : String(o));

const parseOccasion = (o: unknown): "lunch" | "dinner" => (o === "dinner" ? "dinner" : "lunch");

const parseOrderItems = (raw: unknown): Array<{ customerName: string; address?: string; quantity: number; occasion: "lunch" | "dinner"; date?: string }> => {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((it) => ({
    customerName: String((it as { customerName?: unknown })?.customerName ?? ""),
    address: typeof (it as { address?: unknown })?.address === "string" ? String((it as { address?: unknown }).address) : undefined,
    quantity: Number((it as { quantity?: unknown })?.quantity ?? 0),
    occasion: parseOccasion((it as { occasion?: unknown })?.occasion),
    date: typeof (it as { date?: unknown })?.date === "string" ? String((it as { date?: unknown }).date) : undefined,
  }));
};

export const AGENT_TOOLS: AgentTool[] = [
  {
    def: {
      type: "function",
      function: {
        name: "record_orders",
        description: "批量记单（接龙）：每条含 顾客名+地址+份数+餐次。老顾客落草稿；新顾客进 needsConfirmation 等桃子确认，绝不擅自建。",
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  customerName: { type: "string" },
                  address: { type: "string", description: "送餐地址（自由文本，如 3e23a）" },
                  quantity: { type: "integer" },
                  occasion: { type: "string", enum: ["lunch", "dinner"] },
                  date: { type: "string", description: "用餐日 YYYY-MM-DD，默认今天" },
                },
                required: ["customerName", "quantity", "occasion"],
              },
            },
          },
          required: ["items"],
        },
      },
    },
    execute: async (s, args) => {
      const items = parseOrderItems(args.items);
      const r = await s.recordOrders(items);
      const parts: string[] = [];
      if (r.recorded.length > 0) parts.push(`已记草稿：${r.recorded.map((x) => `${x.name} #${x.orderId}`).join("、")}`);
      if (r.needsConfirmation.length > 0) {
        parts.push(
          `新顾客待确认：${r.needsConfirmation
            .map((x) => `${x.customerName}(${x.address ?? "地址？"})${x.quantity}份${occasionZh(x.occasion)}`)
            .join("、")}——点下面「都建」确认`,
        );
      }
      if (r.failed.length > 0) parts.push(`失败：${r.failed.map((x) => `${x.customerName}(${x.error})`).join("、")}`);
      // The card mirrors needsConfirmation verbatim → the 「都建」 button drives
      // POST /chat/confirm-customers (deterministic), removing the LLM-recall flakiness (#97).
      const card: CardPayload | undefined =
        r.needsConfirmation.length > 0 ? { type: "customer-confirm", data: { items: r.needsConfirmation } } : undefined;
      return { text: parts.join("；") || "没有可记的单。", card };
    },
  },
  {
    def: { type: "function", function: { name: "confirm_order", description: "确认一个草稿订单（转正：开餐 slot + 建送餐履约）。", parameters: { type: "object", properties: { orderId: { type: "integer" } }, required: ["orderId"] } } },
    execute: async (s, args) => {
      const r = await s.confirmOrder({ orderId: Number(args.orderId) });
      return { text: r.ok ? `已确认订单 #${args.orderId}（已开餐、进入送餐清单）。` : `确认失败：${r.error}` };
    },
  },
  {
    def: { type: "function", function: { name: "cancel_order", description: "取消一个订单（作废，其送餐履约一并取消）。", parameters: { type: "object", properties: { orderId: { type: "integer" } }, required: ["orderId"] } } },
    execute: async (s, args) => {
      const r = await s.cancelOrder({ orderId: Number(args.orderId) });
      return { text: r.ok ? `已取消订单 #${args.orderId}。` : `取消失败：${r.error}` };
    },
  },
  {
    def: { type: "function", function: { name: "mark_paid", description: "标记一个订单已付款。", parameters: { type: "object", properties: { orderId: { type: "integer" } }, required: ["orderId"] } } },
    execute: async (s, args) => {
      const r = await s.markPaid({ orderId: Number(args.orderId) });
      return { text: r.ok ? `已标记订单 #${args.orderId} 为已付款。` : `标记失败：${r.error}` };
    },
  },
  {
    def: { type: "function", function: { name: "mark_delivered", description: "标记某个地址已送达（按地址片段匹配，如「26B」匹配所有含 26B 的）。", parameters: { type: "object", properties: { address: { type: "string" } }, required: ["address"] } } },
    execute: async (s, args) => {
      const address = String(args.address ?? "");
      const r = await s.markDelivered({ address });
      return { text: r.ok ? `已标记 ${address} 送达（${r.count} 份）。` : `标记失败：${r.error}` };
    },
  },
  {
    def: { type: "function", function: { name: "get_today_summary", description: "查今天概况：未确认订单 / 待送 / 未付 + 最近订单。用户问「今天什么情况/还差什么」时调它。", parameters: { type: "object", properties: {} } } },
    execute: async (s) => {
      const t = await s.getTodaySummary();
      return { text: `今天：草稿未确认 ${t.unconfirmedOrders} 单 / 待送 ${t.pendingDeliveries} 份 / 未付 ${t.unpaidOrders} 单。最近订单：${t.recentOrders || "（无）"}` };
    },
  },
];

export const AGENT_TOOL_DEFS: ToolDef[] = AGENT_TOOLS.map((t) => t.def);
