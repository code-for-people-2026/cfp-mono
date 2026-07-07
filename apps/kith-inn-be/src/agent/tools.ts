import type { CardPayload, DeliveryCardData, MenuPlanView, Order } from "@cfp/kith-inn-shared";
import type { ToolDef } from "../lib/llm/chatWithTools";
import { setPendingOp } from "./pendingOps";

/**
 * 「今天」主 agent 的工具（PRD §5.5）。agent 只**编排**这些确定性操作，不持业务逻辑——
 * 与「菜单/订单/送餐」详情 tab 同一套后端操作（两个前门、一套实现）。`AgentServices`
 * 是这些操作的服务端抽象（生产里 cms-backed，测试里 mock）。
 */

/** The deterministic operations the agent's tools drive (DI — mock in tests). */
export type AgentServices = {
  previewOrders(items: Array<{ customerName: string; quantity: number; occasion: "lunch" | "dinner"; date?: string }>): Promise<{ date: string; isNew: boolean[] }>;
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
  getDishPool(): Promise<Array<{ id: string | number; name: string; mainIngredient?: string; category?: string }>>;
  createOffering(input: { name: string; mainIngredient?: string; category?: string }): Promise<{ id: string | number; name: string }>;
  // Preview reads for operation-confirm cards (#126 rich previews) — all read-only.
  previewOrder(orderId: string | number): Promise<{ displayName: string; quantity: number; occasion: string } | null>;
  previewDelivered(address: string): Promise<number>;
  previewMenuTargets(targets: Array<{ date: string; occasion: "lunch" | "dinner" }>, force?: boolean): Promise<{ ok: true; lines: string[] } | { ok: false; reason: string }>;
  previewSwap(planId: string | number, dishId: string | number, replacementId: string | number | undefined, force?: boolean): Promise<{ ok: true; oldName: string; newName: string; warning?: string } | { ok: false; error: string }>;
  previewPublish(planId: string | number): Promise<{ ok: true; publishText: string } | { ok: false; error: string }>;
  markUnpaid?(input: { orderId: string | number }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Operator id (from JWT) — keys the server-side pending ops (#126). */
  operatorId: string | number;
};

export type AgentTool = {
  def: ToolDef;
  execute: (services: AgentServices, args: Record<string, unknown>) => Promise<{ text: string; card?: CardPayload }>;
};

const occasionZh = (o: unknown) => (o === "lunch" ? "午餐" : o === "dinner" ? "晚餐" : String(o));

/** "#45（王燕萍 2份午餐）" — falls back to just the id if the order can't be read. */
const orderLabel = async (s: AgentServices, orderId: number) => {
  const o = await s.previewOrder(orderId);
  return o ? `#${orderId}（${o.displayName} ${o.quantity}份${occasionZh(o.occasion)}）` : `#${orderId}`;
};

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

/** Build an operation-confirm card. The `: CardPayload` return annotation contextually
 *  types the literal so `type: "operation-confirm"` stays a literal — no cast needed (#126).
 *  `opId` ties the card to its server-side pending op so a stale click is rejected (409). */
const opConfirmCard = (toolName: string, summary: string, args: Record<string, unknown>, opId: string): CardPayload => ({
  type: "operation-confirm",
  data: { toolName, summary, args, opId },
});

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
      if (items.length === 0) return { text: "没说要记谁的单。" };
      // previewOrders throws if the customer lookup fails — never silently mark
      // everyone "new" (would create duplicates on confirm). Surface a retry prompt
      // instead of emitting a card. The resolved date is stamped onto undated items
      // so a card generated before midnight doesn't record for the wrong day when
      // confirmed after (Codex P2).
      let date: string;
      let isNew: boolean[];
      try {
        ({ date, isNew } = await s.previewOrders(items));
      } catch {
        return { text: "查不到顾客信息，稍后再试一下？" };
      }
      const stamped = items.map((it) => ({ ...it, date: it.date ?? date }));
      const newNames = stamped.filter((_, i) => isNew[i]).map((it) => it.customerName);
      const summary = `将记 ${stamped.length} 单：${stamped.map((it) => `${it.customerName} ${it.quantity}份${occasionZh(it.occasion)}`).join("、")}${newNames.length > 0 ? `（新顾客 ${newNames.join("、")} 待建）` : ""}`;
      const opId = setPendingOp(s.operatorId, { toolName: "record_orders", summary, args: { items: stamped, isNew } });
      return { text: summary + "。点下面「确认」" + (newNames.length > 0 ? "，新顾客填一下地址。" : "。"), card: opConfirmCard("record_orders", summary, { items: stamped, isNew }, opId) };
    },
  },
  {
    def: { type: "function", function: { name: "confirm_order", description: "确认一个草稿订单（转正：开餐 slot + 建送餐履约）。", parameters: { type: "object", properties: { orderId: { type: "integer" } }, required: ["orderId"] } } },
    execute: async (s, args) => {
      const orderId = Number(args.orderId);
      const label = await orderLabel(s, orderId);
      const summary = `将确认订单 ${label}（开餐+建送餐履约）`;
      const opId = setPendingOp(s.operatorId, { toolName: "confirm_order", args: { orderId }, summary });
      return { text: summary + "。点下面「确认」。", card: opConfirmCard("confirm_order", summary, { orderId }, opId) };
    },
  },
  {
    def: { type: "function", function: { name: "cancel_order", description: "取消一个订单（作废，其送餐履约一并取消）。", parameters: { type: "object", properties: { orderId: { type: "integer" } }, required: ["orderId"] } } },
    execute: async (s, args) => {
      const orderId = Number(args.orderId);
      const label = await orderLabel(s, orderId);
      const summary = `将取消订单 ${label}（作废+退出经营口径）`;
      const opId = setPendingOp(s.operatorId, { toolName: "cancel_order", args: { orderId }, summary });
      return { text: summary + "。点下面「确认」。", card: opConfirmCard("cancel_order", summary, { orderId }, opId) };
    },
  },
  {
    def: { type: "function", function: { name: "mark_paid", description: "标记一个订单已付款。", parameters: { type: "object", properties: { orderId: { type: "integer" } }, required: ["orderId"] } } },
    execute: async (s, args) => {
      const orderId = Number(args.orderId);
      const label = await orderLabel(s, orderId);
      const summary = `将标记订单 ${label} 为已付款`;
      const opId = setPendingOp(s.operatorId, { toolName: "mark_paid", args: { orderId }, summary });
      return { text: summary + "。点下面「确认」。", card: opConfirmCard("mark_paid", summary, { orderId }, opId) };
    },
  },
  {
    def: { type: "function", function: { name: "mark_delivered", description: "标记某个地址已送达（按地址片段匹配，如「26B」匹配所有含 26B 的）。", parameters: { type: "object", properties: { address: { type: "string" } }, required: ["address"] } } },
    execute: async (s, args) => {
      const address = String(args.address ?? "");
      const count = await s.previewDelivered(address);
      if (count === 0) return { text: `没找到 ${address} 的待送订单。` };
      const summary = `将标记 ${address} 送达（${count} 份）`;
      const opId = setPendingOp(s.operatorId, { toolName: "mark_delivered", args: { address }, summary });
      return { text: summary + "。点下面「确认」。", card: opConfirmCard("mark_delivered", summary, { address }, opId) };
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
    def: { type: "function", function: { name: "get_dish_pool", description: "查菜品池里所有可选的菜（用户问「我有哪些菜」「菜品池有什么」「能做什么菜」时调它）。返回菜名+主料+分类。", parameters: { type: "object", properties: {} } } },
    execute: async (s) => {
      const pool = await s.getDishPool();
      if (pool.length === 0) return { text: "菜品池是空的。" };
      const byCat: Record<string, string[]> = {};
      const cat = (c?: string) => c ?? "veg";
      for (const d of pool) (byCat[cat(d.category)] ??= []).push(`${d.name}(${d.mainIngredient ?? "?"})`);
      const parts = [
        byCat.meat?.length && `荤：${byCat.meat.join("、")}`,
        byCat.veg?.length && `素：${byCat.veg.join("、")}`,
        byCat.soup?.length && `汤：${byCat.soup.join("、")}`,
        byCat.staple?.length && `主食：${byCat.staple.join("、")}`,
      ].filter(Boolean);
      return { text: `菜品池共 ${pool.length} 道菜：\n${parts.join("\n")}` };
    },
  },
  {
    def: { type: "function", function: { name: "add_dish", description: "往菜品池加一道新菜。用户说「加一道菜叫XX」「新增菜品」时调它。name=菜名（必填），mainIngredient=主料（如牛肉/鸡肉/青菜），category=分类（meat荤/veg素/soup汤/staple主食）。", parameters: { type: "object", properties: { name: { type: "string", description: "菜名，如 蒜蓉粉丝虾" }, mainIngredient: { type: "string", description: "主料，如 虾" }, category: { type: "string", enum: ["meat", "veg", "soup", "staple"], description: "meat=荤 veg=素 soup=汤 staple=主食" } }, required: ["name"] } } },
    execute: async (s, args) => {
      const name = String(args.name ?? "").trim();
      if (!name) return { text: "菜名不能空。" };
      const input = { name, mainIngredient: args.mainIngredient ? String(args.mainIngredient) : undefined, category: args.category ? String(args.category) : undefined };
      const summary = `将添加：${name}（主料${input.mainIngredient ?? "?"}/${input.category ?? "?"}）`;
      const opId = setPendingOp(s.operatorId, { toolName: "add_dish", args: input, summary });
      return { text: summary + "。点下面「确认」。", card: opConfirmCard("add_dish", summary, input, opId) };
    },
  },
  {
    def: { type: "function", function: { name: "get_menu", description: "查某天的菜单（已排好的 plan）。用户问「明天/今天菜单是什么」「安排了什么菜」时调它。date 格式 YYYY-MM-DD，省略=今天。", parameters: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD，省略=今天" } } } } },
    execute: async (s, args) => {
      const date = typeof args.date === "string" ? args.date : undefined;
      const plans = await s.getMenu(date);
      if (plans.length === 0) return { text: `${date ?? "今天"}还没有排菜单。` };
      const lines = plans.map((p) => {
        const occ = p.occasion === "lunch" ? "午餐" : "晚餐";
        const dishes = p.dishes.map((d) => `${d.name}(#${d.id})`).join("、");
        return `${occ}(plan#${p.planId})：${dishes}`;
      });
      return { text: `${date ?? "今天"}菜单：\n${lines.join("\n")}` };
    },
  },
  {
    def: { type: "function", function: { name: "generate_menu", description: "生成或重新排菜。用户说「排一下明天午餐」「生成下周菜单」「重新排」时调它。targets 是要排的日期+餐次列表。force=true 覆盖已发出的菜单（需桃子确认）。", parameters: { type: "object", properties: { targets: { type: "array", items: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, occasion: { type: "string", enum: ["lunch", "dinner"] } }, required: ["date", "occasion"] } }, force: { type: "boolean" } }, required: ["targets"] } } },
    execute: async (s, args) => {
      const targets = Array.isArray(args.targets) ? args.targets.map((t) => ({ date: String((t as { date?: unknown }).date), occasion: (t as { occasion?: unknown }).occasion === "dinner" ? "dinner" as const : "lunch" as const })) : [];
      if (targets.length === 0) return { text: "没说要排哪天哪餐。" };
      const force = args.force === true;
      const preview = await s.previewMenuTargets(targets, force);
      if (!preview.ok) return { text: preview.reason === "pool-too-small" ? "菜品池不够，排不出来。" : preview.reason === "plan-published" ? "这餐已发给顾客了，要重排得说「强制」。" : "排菜预览失败，再试一下。" };
      const head = `将为 ${targets.map((t) => `${t.date} ${t.occasion === "lunch" ? "午餐" : "晚餐"}`).join("、")} 排菜`;
      const summary = `${head}：\n${preview.lines.join("\n")}`;
      const opId = setPendingOp(s.operatorId, { toolName: "generate_menu", args: { targets, force }, summary });
      return { text: summary + "\n点下面「确认」。", card: opConfirmCard("generate_menu", summary, { targets, force }, opId) };
    },
  },
  {
    def: { type: "function", function: { name: "swap_dish", description: "换掉菜单里的一道菜。planId 和 dishId 从 get_menu 返回里拿。不传 replacementId=自动换一道（避重）；传了=指定换。force=true 改已发出的菜单（需桃子确认）。", parameters: { type: "object", properties: { planId: { type: "integer" }, dishId: { type: "integer" }, replacementId: { type: "integer" }, force: { type: "boolean" } }, required: ["planId", "dishId"] } } },
    execute: async (s, args) => {
      const planId = Number(args.planId);
      const dishId = Number(args.dishId);
      const replacementId = args.replacementId !== undefined ? Number(args.replacementId) : undefined;
      const force = args.force === true;
      const preview = await s.previewSwap(planId, dishId, replacementId, force);
      if (!preview.ok) return { text: preview.error === "plan-published" ? "这餐已发给顾客了，要改得说「强制」。" : `换不了：${preview.error}` };
      const summary = `将把 ${preview.oldName} 换成 ${preview.newName}${preview.warning ? `（${preview.warning}）` : ""}`;
      const opId = setPendingOp(s.operatorId, { toolName: "swap_dish", args: { planId, dishId, replacementId, force }, summary });
      return { text: summary + "。点下面「确认」。", card: opConfirmCard("swap_dish", summary, { planId, dishId, replacementId, force }, opId) };
    },
  },
  {
    def: { type: "function", function: { name: "publish_menu", description: "发布某餐菜单（生成接龙群文案+标记已发出）。planId 从 get_menu 拿。用户说「发出去」「给我文案」「发群通知」时调它。", parameters: { type: "object", properties: { planId: { type: "integer" } }, required: ["planId"] } } },
    execute: async (s, args) => {
      const planId = Number(args.planId);
      const preview = await s.previewPublish(planId);
      if (!preview.ok) return { text: "读不到这餐菜单，再试一下。" };
      const summary = `将发布菜单，接龙文案如下：\n\n${preview.publishText}`;
      const opId = setPendingOp(s.operatorId, { toolName: "publish_menu", args: { planId }, summary });
      return { text: summary + "\n点下面「确认」后文案会自动复制。", card: opConfirmCard("publish_menu", summary, { planId }, opId) };
    },
  },
];

export const AGENT_TOOL_DEFS: ToolDef[] = AGENT_TOOLS.map((t) => t.def);
