import type { ToolDef } from "../lib/llm/chatWithTools";

/**
 * 「今天」主 agent 的工具（PRD §5.5）。agent 只**编排**这些确定性操作，不持业务逻辑——
 * 与「菜单/订单/送餐」详情 tab 同一套后端操作（两个前门、一套实现）。`AgentServices`
 * 是这些操作的服务端抽象（生产里 cms-backed，测试里 mock）。
 */

/** The deterministic operations the agent's tools drive (DI — mock in tests). */
export type AgentServices = {
  recordOrder(input: { customerName: string; quantity: number; occasion: "lunch" | "dinner"; date?: string }): Promise<{ ok: true; orderId: string | number } | { ok: false; error: string }>;
  confirmOrder(input: { orderId: string | number }): Promise<{ ok: true } | { ok: false; error: string }>;
  cancelOrder(input: { orderId: string | number }): Promise<{ ok: true } | { ok: false; error: string }>;
  markPaid(input: { orderId: string | number }): Promise<{ ok: true } | { ok: false; error: string }>;
  markDelivered(input: { building: string; unit?: string }): Promise<{ ok: true; count: number } | { ok: false; error: string }>;
  getTodaySummary(): Promise<{ unconfirmedOrders: number; pendingDeliveries: number; unpaidOrders: number; recentOrders: string }>;
};

export type AgentTool = {
  def: ToolDef;
  execute: (services: AgentServices, args: Record<string, unknown>) => Promise<string>;
};

const occasionZh = (o: unknown) => (o === "lunch" ? "午餐" : o === "dinner" ? "晚餐" : String(o));

export const AGENT_TOOLS: AgentTool[] = [
  {
    def: {
      type: "function",
      function: {
        name: "record_order",
        description: "记一个订单（顾客名+份数+餐次）。用于私聊单/口述加单。落为草稿，需确认才进台账。",
        parameters: {
          type: "object",
          properties: { customerName: { type: "string" }, quantity: { type: "integer" }, occasion: { type: "string", enum: ["lunch", "dinner"] }, date: { type: "string", description: "用餐日 YYYY-MM-DD，默认今天" } },
          required: ["customerName", "quantity", "occasion"],
        },
      },
    },
    execute: async (s, args) => {
      const r = await s.recordOrder({
        customerName: String(args.customerName ?? ""),
        quantity: Number(args.quantity),
        occasion: (args.occasion === "dinner" ? "dinner" : "lunch"),
        date: typeof args.date === "string" ? args.date : undefined,
      });
      return r.ok
        ? `已记草稿订单 #${r.orderId}：${args.customerName} ${occasionZh(args.occasion)} ${args.quantity}份。需确认才进入台账/采购/送餐。`
        : `记单失败：${r.error}`;
    },
  },
  {
    def: { type: "function", function: { name: "confirm_order", description: "确认一个草稿订单（转正：开餐 slot + 建送餐履约）。", parameters: { type: "object", properties: { orderId: { type: "integer" } }, required: ["orderId"] } } },
    execute: async (s, args) => {
      const r = await s.confirmOrder({ orderId: Number(args.orderId) });
      return r.ok ? `已确认订单 #${args.orderId}（已开餐、进入送餐清单）。` : `确认失败：${r.error}`;
    },
  },
  {
    def: { type: "function", function: { name: "cancel_order", description: "取消一个订单（作废，其送餐履约一并取消）。", parameters: { type: "object", properties: { orderId: { type: "integer" } }, required: ["orderId"] } } },
    execute: async (s, args) => {
      const r = await s.cancelOrder({ orderId: Number(args.orderId) });
      return r.ok ? `已取消订单 #${args.orderId}。` : `取消失败：${r.error}`;
    },
  },
  {
    def: { type: "function", function: { name: "mark_paid", description: "标记一个订单已付款。", parameters: { type: "object", properties: { orderId: { type: "integer" } }, required: ["orderId"] } } },
    execute: async (s, args) => {
      const r = await s.markPaid({ orderId: Number(args.orderId) });
      return r.ok ? `已标记订单 #${args.orderId} 为已付款。` : `标记失败：${r.error}`;
    },
  },
  {
    def: { type: "function", function: { name: "mark_delivered", description: "标记某楼栋（可选房号）已送达——整栋或单门牌都行（手里忙就报楼栋）。", parameters: { type: "object", properties: { building: { type: "string" }, unit: { type: "string" } }, required: ["building"] } } },
    execute: async (s, args) => {
      const r = await s.markDelivered({ building: String(args.building ?? ""), unit: typeof args.unit === "string" ? args.unit : undefined });
      return r.ok ? `已标记 ${args.building}${args.unit ? "-" + args.unit : ""} 送达（${r.count} 份）。` : `标记失败：${r.error}`;
    },
  },
  {
    def: { type: "function", function: { name: "get_today_summary", description: "查今天概况：未确认订单 / 待送 / 未付 + 最近订单。用户问「今天什么情况/还差什么」时调它。", parameters: { type: "object", properties: {} } } },
    execute: async (s) => {
      const t = await s.getTodaySummary();
      return `今天：草稿未确认 ${t.unconfirmedOrders} 单 / 待送 ${t.pendingDeliveries} 份 / 未付 ${t.unpaidOrders} 单。最近订单：${t.recentOrders || "（无）"}`;
    },
  },
];

export const AGENT_TOOL_DEFS: ToolDef[] = AGENT_TOOLS.map((t) => t.def);
