/**
 * kith-inn domain enums — the single source of truth for every select/enum value
 * across FE / BE / cms (PRD §7.5 铁律 4: list enums ONCE, so adding a value later
 * doesn't force a Payload migration on three sides). Each enum is a `readonly`
 * tuple (the runtime values) with a derived union type.
 *
 * This package is zero-dependency so FE (Taro) and BE (Hono) can import it without
 * dragging in Payload. cms's collection configs (in @cfp/kith-inn-payload) consume
 * these as their `select` options.
 */

/** 用餐餐次 — service_slots 与 orders 共用（PRD §7.1 occasion 枚举）。 */
export const OCCASIONS = [
  "breakfast",
  "brunch",
  "lunch",
  "dinner",
  "all-day",
] as const;
export type Occasion = (typeof OCCASIONS)[number];

/** 菜单规划/正餐用的餐次子集（午/晚）。OCCASIONS 的子集 —— 单一定义处，免 types.ts
 *  内联、be menu/core.ts、fe menuView.ts 各抄一份（#89 收敛）。 */
export const MEAL_OCCASIONS = ["lunch", "dinner"] as const;
export type MealOccasion = (typeof MEAL_OCCASIONS)[number];

/** 记单生命周期（PRD §7.1 orders.status）。draft=纯记录零副作用，确认才物化，取消终态。 */
export const ORDER_STATUSES = ["draft", "confirmed", "canceled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** 手工到账记录轴（≠ 记单轴）。当前只写 unpaid/paid；reconciled 仅兼容历史数据。 */
export const PAYMENT_STATUSES = ["unpaid", "paid", "reconciled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** 订单来源（审计，不控流）。 */
export const ORDER_SOURCES = [
  "chat-paste",
  "chat-voice",
  "manual",
  "subscription",
  "import",
] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** offerings.kind — 菜/SKU/套餐/课时 的四类生意枢纽。一道菜 = component。 */
export const OFFERING_KINDS = [
  "combo-meal",
  "single-item",
  "service-session",
  "component",
] as const;
export type OfferingKind = (typeof OFFERING_KINDS)[number];

/**
 * offerings.category — kebab values + 中文 labels（PRD §7 命名约定：select 值
 * kebab-case）。菜单内核靠它组「2 荤 2 素 1 汤」。
 */
export const OFFERING_CATEGORIES = [
  { value: "meat", label: "荤" },
  { value: "veg", label: "素" },
  { value: "soup", label: "汤" },
  { value: "staple", label: "主食" },
] as const;
export type OfferingCategory = (typeof OFFERING_CATEGORIES)[number]["value"];

/** 履约状态。canceled 为终态、退出送餐/缺口口径。 */
export const FULFILLMENT_STATUSES = [
  "pending",
  "done",
  "canceled",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/** sellers.enabledModules — 组合事实源，驱动 access/tab/agent 工具注册。 */
export const SELLER_MODULES = [
  "menu-planning",
  "delivery",
  "purchasing",
  "booking",
] as const;
export type SellerModule = (typeof SELLER_MODULES)[number];

/** 商家软停用状态。 */
export const SELLER_STATUSES = ["active", "paused", "archived"] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

/** 登录主体角色。helper 预留（奶奶未来可能用手机）。 */
export const OPERATOR_ROLES = ["owner", "helper"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

/** 时间桶状态。draft=预占，open=确认即开餐，archived=软删不自动重开。 */
export const SERVICE_SLOT_STATUSES = ["draft", "open", "archived"] as const;
export type ServiceSlotStatus = (typeof SERVICE_SLOT_STATUSES)[number];

/** 菜单计划状态。published ≠ 已发微信群（线下动作）。 */
export const MENU_PLAN_STATUSES = ["draft", "published"] as const;
export type MenuPlanStatus = (typeof MENU_PLAN_STATUSES)[number];

/** 自动换菜的四级放宽原因；数组顺序也是冲突评分的业务优先级。 */
export const RELAXED_RULES = [
  "same-week-offering",
  "same-day-main-ingredient",
  "recent-offering",
  "recent-main-ingredient",
] as const;

/** 订阅状态（V1）。 */
export const SUBSCRIPTION_STATUSES = ["active", "paused"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** service_slots.granularity — 按餐次（桃子午/晚）vs 按时段（烘焙取货/家教）。 */
export const SERVICE_SLOT_GRANULARITIES = ["occasion", "time-slot"] as const;
export type ServiceSlotGranularity = (typeof SERVICE_SLOT_GRANULARITIES)[number];

/** chat_messages.role — 展示对话里谁说的话。 */
export const CHAT_ROLES = ["user", "assistant"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];
