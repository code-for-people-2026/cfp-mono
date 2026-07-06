import type { CardPayload, DeliveryCardData, MenuPlanView, Order } from "@cfp/kith-inn-shared";
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
    needsConfirmation: Array<{ customerName: string; address?: string; quantity: number; occasion: "lunch" | "dinner"; date?: string }>;
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
  getTodayOrders(): Promise<Order[]>;
  getTodayDelivery(): Promise<DeliveryCardData>;
  // Menu tools (feature 005)
  generateMenu(targets: Array<{ date: string; occasion: "lunch" | "dinner" }>, force?: boolean): Promise<{ ok: true; plans: MenuPlanView[] } | { ok: false; reason: string }>;
  swapDish(planId: string | number, dishId: string | number, replacementId?: string | number, force?: boolean): Promise<{ ok: true; plan: MenuPlanView; warning?: string } | { ok: false; error: string }>;
  publishMenu(planId: string | number): Promise<{ ok: true; publishText: string } | { ok: false; error: string }>;
  getMenu(date?: string): Promise<MenuPlanView[]>;
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
            .join("、")}——点下面「全部建档并记单」确认`,
        );
      }
      if (r.failed.length > 0) parts.push(`失败：${r.failed.map((x) => `${x.customerName}(${x.error})`).join("、")}`);
      // The card mirrors needsConfirmation verbatim → POST /chat/confirm-customers
      // handles the deterministic confirmation action, removing LLM-recall flakiness (#97).
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
  {
    def: { type: "function", function: { name: "get_orders", description: "查今天的订单列表（含状态、可操作）。用户问「订单怎么样/都有谁订了/今天谁订了」时调它。", parameters: { type: "object", properties: {} } } },
    execute: async (s) => {
      const orders = await s.getTodayOrders();
      if (orders.length === 0) return { text: "今天还没有订单。" };
      const drafts = orders.filter((o) => o.status === "draft").length;
      const unpaid = orders.filter((o) => o.status === "confirmed" && o.paymentStatus === "unpaid").length;
      const tail = [drafts > 0 && `草稿 ${drafts}`, unpaid > 0 && `未付 ${unpaid}`].filter(Boolean).join(" / ");
      return {
        text: `今天 ${orders.length} 单${tail ? `（${tail}）` : ""}，看下面卡片。`,
        card: { type: "orders", data: { orders, date: orders[0]?.date ?? "" } },
      };
    },
  },
  {
    def: { type: "function", function: { name: "get_delivery", description: "查今天的送餐分拣（按地址、还差几份）。用户问「送餐怎样/还差什么/怎么送」时调它。", parameters: { type: "object", properties: {} } } },
    execute: async (s) => {
      const d = await s.getTodayDelivery();
      if (d.groups.length === 0) return { text: "今天没有要送的。" };
      return { text: `今天送餐：还差 ${d.totalPending} 份，看下面分拣卡片。`, card: { type: "delivery", data: d } };
    },
  },
  // ── Menu tools (feature 005) ──────────────────────────────────────
  {
    def: { type: "function", function: { name: "get_menu", description: "查某天的菜单（已排好的 plan）。用户问「明天/今天菜单是什么」「安排了什么菜」时调它。date 格式 YYYY-MM-DD，省略=今天。", parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD，省略=今天" } } } } },
    execute: async (s, args) => {
      const date = typeof args.date === "string" ? args.date : undefined;
      const plans = await s.getMenu(date);
      if (plans.length === 0) return { text: `${date ?? "今天"}还没有排菜单。` };
      const lines = plans.map((p) => `${p.occasion === "lunch" ? "午餐" : "晚餐"}：${p.dishes.map((d) => d.name).join("、")}`);
      return { text: `${date ?? "今天"}菜单：\n${lines.join("\n")}` };
    },
  },
  {
    def: { type: "function", function: { name: "generate_menu", description: "生成或重新排菜。用户说「排一下明天午餐」「生成下周菜单」「重新排」时调它。targets 是要排的日期+餐次列表。force=true 覆盖已发出的菜单（需桃子确认）。", parameters: { type: "object", properties: { targets: { type: "array", items: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, occasion: { type: "string", enum: ["lunch", "dinner"] } }, required: ["date", "occasion"] } }, force: { type: "boolean" } }, required: ["targets"] } } },
    execute: async (s, args) => {
      const targets = Array.isArray(args.targets) ? args.targets.map((t) => ({ date: String((t as { date?: unknown }).date), occasion: (t as { occasion?: unknown }).occasion === "dinner" ? "dinner" as const : "lunch" as const })) : [];
      if (targets.length === 0) return { text: "没说要排哪天哪餐。" };
      const r = await s.generateMenu(targets, args.force === true);
      if (!r.ok) {
        if (r.reason === "plan-published") return { text: "这餐已经发给顾客了，确定要重新排吗？确认后我覆写。" };
        if (r.reason === "pool-too-small") return { text: "菜品池不够，排不满。先去菜品池加几道菜。" };
        return { text: "排菜失败，再试一下？" };
      }
      const lines = r.plans.map((p) => `${p.occasion === "lunch" ? "午餐" : "晚餐"}：${p.dishes.map((d) => d.name).join("、")}`);
      return { text: `排好了：\n${lines.join("\n")}` };
    },
  },
  {
    def: { type: "function", function: { name: "swap_dish", description: "换掉菜单里的一道菜。planId 和 dishId 从 get_menu 返回里拿。不传 replacementId=自动换一道（避重）；传了=指定换。force=true 改已发出的菜单（需桃子确认）。", parameters: { type: "object", properties: { planId: { type: "integer" }, dishId: { type: "integer" }, replacementId: { type: "integer" }, force: { type: "boolean" } }, required: ["planId", "dishId"] } } },
    execute: async (s, args) => {
      const r = await s.swapDish(Number(args.planId), Number(args.dishId), args.replacementId !== undefined ? Number(args.replacementId) : undefined, args.force === true);
      if (!r.ok) {
        if (r.error === "plan-published") return { text: "这餐已经发出去了，确定要换菜吗？确认后我改（旧文案会作废）。" };
        if (r.error === "no-alternative") return { text: "池里没有别的同类菜可换了。" };
        return { text: `换菜失败：${r.error}` };
      }
      // diff: find the new dish (in plan.dishes but not matching original dishId)
      const newName = r.plan.dishes.find((d) => String(d.id) !== String(args.dishId))?.name ?? "新菜";
      return { text: r.warning ? `换成了${newName}。注意：${r.warning}` : `换成了${newName}。` };
    },
  },
  {
    def: { type: "function", function: { name: "publish_menu", description: "发布某餐菜单（生成接龙群文案+标记已发出）。planId 从 get_menu 拿。用户说「发出去」「给我文案」「发群通知」时调它。", parameters: { type: "object", properties: { planId: { type: "integer" } }, required: ["planId"] } } },
    execute: async (s, args) => {
      const r = await s.publishMenu(Number(args.planId));
      if (!r.ok) return { text: `发布失败：${r.error}` };
      return { text: `菜单已发布，文案如下（复制贴群）：\n\n${r.publishText}` };
    },
  },
];

export const AGENT_TOOL_DEFS: ToolDef[] = AGENT_TOOLS.map((t) => t.def);
