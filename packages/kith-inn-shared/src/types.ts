/**
 * kith-inn domain + contract types. **Derived from the zod schemas in
 * `schemas.ts` via `z.infer` (#89)** — schemas are the single source of truth;
 * this file only re-exports the inferred types + their doc comments. enum types
 * live in `enums.ts`.
 *
 * Both imports below are `import type`-only → TS import-elides them, so no zod
 * runtime leaks to type-only consumers (FE/Taro weapp imports these as types).
 *
 * `seller` / relationship fields are a union of bare id or populated doc,
 * matching Payload's shallow (`number | string`) vs populated (`{ id }`) shapes.
 */
import type { z } from "zod";
import type {
  addressGapSchema,
  addressGroupSchema,
  cardPayloadSchema,
  chatMessageSchema,
  confirmCustomerItemSchema,
  customerSchema,
  deliveryCardDataSchema,
  deliveryCardGroupSchema,
  deliveryViewSchema,
  fulfillmentSchema,
  menuDishSchema,
  menuPlanSchema,
  menuPlanViewSchema,
  menuSlotSchema,
  offeringCreateSchema,
  offeringSchema,
  offeringUpdateSchema,
  operatorSchema,
  orderCardDataSchema,
  orderItemSchema,
  orderReconciliationCandidateSchema,
  orderReconciliationPreviewSchema,
  orderReconciliationRequestSchema,
  orderReconciliationResultSchema,
  orderReconciliationRowSchema,
  orderReconciliationScopeSchema,
  orderSchema,
  relaxedRuleSchema,
  serviceSlotSchema,
  sellerSchema,
  swapRequestSchema,
  weekMenuSchema,
} from "./schemas";

/** 经营画像：定价 fallback、开了哪些 module（菜单/送餐/采购）、每 module 配置。 */
export type Seller = z.infer<typeof sellerSchema>;

/** 登录主体（桃子 owner / 未来帮手 helper）。 */
export type Operator = z.infer<typeof operatorSchema>;

/** 顾客：接龙里的称呼（identify key）+ 自由文本送餐地址（下单时 snapshot 进 order.address）。 */
export type Customer = z.infer<typeof customerSchema>;

/** 菜/SKU/套餐/课时（kind）；component=一道菜，combo-meal=按份卖的套餐（parentOfferings=组件池）。 */
export type Offering = z.infer<typeof offeringSchema>;
/** 菜品池新增写输入（M1：菜名 + 主料 + 分类）。 */
export type OfferingCreate = z.infer<typeof offeringCreateSchema>;
/** 菜品池编辑写输入（M1：name/mainIngredient/category 任选，空对象被拒）。 */
export type OfferingUpdate = z.infer<typeof offeringUpdateSchema>;

/** 服务时间桶（开餐 slot）。draft=预占，open=确认即开餐，archived=软删。 */
export type ServiceSlot = z.infer<typeof serviceSlotSchema>;

/** 订单条目（每条 = 一个 offering × 份数；餐次在 order.occasion）。 */
export type OrderItem = z.infer<typeof orderItemSchema>;

/** 订单（顾客+日期+餐次；draft=纯记录→confirm 物化→cancel 终态；address 是创建时地址快照）。 */
export type Order = z.infer<typeof orderSchema>;

/** 送餐履约（per order；serviceDate/occasion 冗余便于按日分拣）。 */
export type Fulfillment = z.infer<typeof fulfillmentSchema>;

/** 菜单计划（某 slot 卖哪些 offerings + 发群文案）。 */
export type MenuPlan = z.infer<typeof menuPlanSchema>;

/** 聊天消息（「今天」对话；role=user/assistant）。 */
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// ── menu contract (GET /menu/week) ─────────────────────────────────────────
/** 菜单规划用的一道菜。 */
export type MenuDish = z.infer<typeof menuDishSchema>;
/** 菜单的一个槽（某天某餐的菜）。 */
export type MenuSlot = z.infer<typeof menuSlotSchema>;
/** 周菜单结果：成功（slots）或 pool-too-small（菜池填不满去重约束）。 */
export type WeekMenu = z.infer<typeof weekMenuSchema>;

/** 菜单 plan 视图（feature 003，按餐次）。 */
export type MenuPlanView = z.infer<typeof menuPlanViewSchema>;
/** 自动换菜放宽规则；数组顺序遵循四级评分优先级。 */
export type RelaxedRule = z.infer<typeof relaxedRuleSchema>;
/** 换菜请求（feature 003）。 */
export type SwapRequest = z.infer<typeof swapRequestSchema>;

// ── delivery contract (GET /delivery) ──────────────────────────────────────
/** 按地址分组的送篮（源头防错：照这张装篮）。 */
export type AddressGroup = z.infer<typeof addressGroupSchema>;
/** 缺口（收尾防漏：这趟还差几个地址未送）。 */
export type AddressGap = z.infer<typeof addressGapSchema>;
/** 送餐 tab 数据源：分拣 + 缺口对账（派生不落表）。 */
export type DeliveryView = z.infer<typeof deliveryViewSchema>;

// ── atomic order reconciliation contract (feature 012) ─────────────────────
export type OrderReconciliationScope = z.infer<typeof orderReconciliationScopeSchema>;
export type OrderReconciliationCandidate = z.infer<typeof orderReconciliationCandidateSchema>;
export type OrderReconciliationRow = z.infer<typeof orderReconciliationRowSchema>;
export type OrderReconciliationRequest = z.infer<typeof orderReconciliationRequestSchema>;
export type OrderReconciliationPreview = z.infer<typeof orderReconciliationPreviewSchema>;
export type OrderReconciliationResult = z.infer<typeof orderReconciliationResultSchema>;

// ── chat cards (#98) ───────────────────────────────────────────────────────
/** record_orders 预览卡里一行待记/待建顾客（operation-confirm args.items 用）。 */
export type ConfirmCustomerItem = z.infer<typeof confirmCustomerItemSchema>;
/** orders 卡 data：今天的订单列表 + 日期。 */
export type OrderCardData = z.infer<typeof orderCardDataSchema>;
/** delivery 卡里一个地址组（含 ids 供「送达」按钮精确勾销，PR #101 Codex P1）。 */
export type DeliveryCardGroup = z.infer<typeof deliveryCardGroupSchema>;
/** delivery 卡 data：缺口数 + 按地址分组。 */
export type DeliveryCardData = z.infer<typeof deliveryCardDataSchema>;
/** 聊天回复附带的结构化卡片（orders / delivery / operation-confirm）。 */
export type CardPayload = z.infer<typeof cardPayloadSchema>;
