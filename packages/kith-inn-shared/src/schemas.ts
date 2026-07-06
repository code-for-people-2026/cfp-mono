/**
 * zod schemas — the single source of truth for kith-inn domain + contract types
 * (#89). `types.ts` derives every type via `z.infer<typeof XSchema>`, so a field
 * change is made once here. enums stay defined as const arrays in `enums.ts`
 * (cms `select` options consume those at runtime); schemas derive from them.
 *
 * This file is the ONLY place `zod` is imported as a **value** in this package.
 * `types.ts` imports the schemas `import type`-only → TS import-elides them, so
 * no zod runtime reaches type-only consumers (FE/Taro weapp).
 */
import { z } from "zod";
import {
  CHAT_ROLES,
  FULFILLMENT_STATUSES,
  MEAL_OCCASIONS,
  MENU_PLAN_STATUSES,
  OCCASIONS,
  OFFERING_KINDS,
  OPERATOR_ROLES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  SERVICE_SLOT_GRANULARITIES,
  SERVICE_SLOT_STATUSES,
  SELLER_MODULES,
  SELLER_STATUSES,
} from "./enums";
import type { OfferingCategory, OfferingKind } from "./enums";
import type { Seller } from "./types";

// ponytail: OFFERING_CATEGORIES in enums.ts is a {value,label}[] (payload select
// needs the labels); the value tuple is mirrored here for z.enum literal inference.
// Keep in sync with OFFERING_CATEGORIES.
const OFFERING_CATEGORY_VALUES = ["meat", "veg", "soup", "staple"] as const;

// ── enum schemas (one-way derivation: const array → zod enum) ──
const occasionSchema = z.enum(OCCASIONS);
const menuMealOccasionSchema = z.enum(MEAL_OCCASIONS);
const orderStatusSchema = z.enum(ORDER_STATUSES);
const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
const orderSourceSchema = z.enum(ORDER_SOURCES);
const offeringKindSchema = z.enum(OFFERING_KINDS);
export const offeringCategorySchema = z.enum(OFFERING_CATEGORY_VALUES);
const fulfillmentStatusSchema = z.enum(FULFILLMENT_STATUSES);
const sellerModuleSchema = z.enum(SELLER_MODULES);
const sellerStatusSchema = z.enum(SELLER_STATUSES);
const operatorRoleSchema = z.enum(OPERATOR_ROLES);
const serviceSlotStatusSchema = z.enum(SERVICE_SLOT_STATUSES);
const serviceSlotGranularitySchema = z.enum(SERVICE_SLOT_GRANULARITIES);
const menuPlanStatusSchema = z.enum(MENU_PLAN_STATUSES);
const chatRoleSchema = z.enum(CHAT_ROLES);

/** id-or-populated-doc union (payload shallow = number|string; depth-populated = doc). */
const rel = <T extends z.ZodType>(doc: T) => z.union([z.string(), z.number(), doc]);
const id = z.union([z.string(), z.number()]);

// ── domain entities ──
export const sellerSchema = z.object({
  id: id,
  name: z.string(),
  serviceArea: z.string().optional(),
  defaultPriceCents: z.number().optional(),
  status: sellerStatusSchema,
  enabledModules: z.array(sellerModuleSchema).optional(),
  moduleSettings: z.record(z.string(), z.unknown()).optional(),
  profileFreeText: z.string().optional(),
});

export const operatorSchema = z.object({
  id: id,
  wechatOpenid: z.string(),
  role: operatorRoleSchema,
  active: z.boolean(),
  seller: rel(z.lazy(() => sellerSchema)),
});

export const customerSchema = z.object({
  id: id,
  displayName: z.string(),
  defaultServings: z.number().optional(),
  defaultOccasion: occasionSchema.optional(),
  note: z.string().optional(),
  address: z.string().optional(),
  seller: rel(z.lazy(() => sellerSchema)),
});

// ponytail: Offering self-references via parentOfferings; an explicit interface +
// `z.ZodType<Offering>` annotation breaks the inference cycle (zod's standard
// recursive pattern). z.infer<typeof offeringSchema> === Offering.
interface Offering {
  id: string | number;
  name: string;
  kind: OfferingKind;
  mainIngredient?: string;
  category?: OfferingCategory;
  parentOfferings?: Array<string | number | Offering>;
  unitLabel?: string;
  priceCents?: number;
  tags?: string[];
  lastUsedAt?: string;
  useCount?: number;
  recipe?: Record<string, unknown>;
  active?: boolean;
  seller: string | number | Seller;
}
export const offeringSchema: z.ZodType<Offering> = z.object({
  id: id,
  name: z.string(),
  kind: offeringKindSchema,
  mainIngredient: z.string().optional(),
  category: offeringCategorySchema.optional(),
  parentOfferings: z.array(rel(z.lazy(() => offeringSchema))).optional(),
  unitLabel: z.string().optional(),
  priceCents: z.number().optional(),
  tags: z.array(z.string()).optional(),
  lastUsedAt: z.string().optional(),
  useCount: z.number().optional(),
  recipe: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
  seller: rel(z.lazy(() => sellerSchema)),
});

// ── offering write contract (M1 菜品池 CRUD: name + mainIngredient + category) ──
// z.object 非 passthrough → 多余字段（priceCents/tags/recipe/kind/seller/id）被 strip = M1 白名单。
export const offeringCreateSchema = z.object({
  name: z.string().min(1),
  mainIngredient: z.string().optional(),
  category: offeringCategorySchema,
});
export const offeringUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    // nullable so a PATCH can explicitly CLEAR an optional 主料 (null = clear);
    // undefined (key absent after strip) = leave unchanged (Codex #112 P2).
    mainIngredient: z.string().nullable().optional(),
    category: offeringCategorySchema.optional(),
  })
  // strip 先跑，再拒绝空对象 → handler 靠 safeParse 即可挡空 PATCH（→ 400，Codex P2）。
  .refine((d) => Object.keys(d).length > 0, { message: "empty update" });

export const serviceSlotSchema = z.object({
  id: id,
  date: z.string(),
  granularity: serviceSlotGranularitySchema,
  occasion: occasionSchema.optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  status: serviceSlotStatusSchema,
  seller: rel(z.lazy(() => sellerSchema)),
});

export const orderItemSchema = z.object({
  id: id,
  order: rel(z.lazy(() => orderSchema)),
  offering: rel(z.lazy(() => offeringSchema)),
  quantity: z.number(),
  unitPriceCents: z.number().optional(),
  note: z.string().optional(),
  seller: rel(z.lazy(() => sellerSchema)),
});

export const orderSchema = z.object({
  id: id,
  customer: rel(z.lazy(() => customerSchema)),
  date: z.string(),
  occasion: occasionSchema,
  status: orderStatusSchema,
  source: orderSourceSchema,
  placedAt: z.string().optional(),
  note: z.string().optional(),
  totalCents: z.number().optional(),
  address: z.string().optional(),
  paymentStatus: paymentStatusSchema,
  paymentMethod: z.string().optional(),
  paidAt: z.string().optional(),
  idempotencyKey: z.string().optional(),
  createdBy: rel(z.lazy(() => operatorSchema)).optional(),
  seller: rel(z.lazy(() => sellerSchema)),
});

export const fulfillmentSchema = z.object({
  id: id,
  order: rel(z.lazy(() => orderSchema)),
  serviceDate: z.string(),
  occasion: occasionSchema.optional(),
  status: fulfillmentStatusSchema,
  seller: rel(z.lazy(() => sellerSchema)),
});

export const menuPlanSchema = z.object({
  id: id,
  slot: rel(z.lazy(() => serviceSlotSchema)),
  offerings: z.array(rel(z.lazy(() => offeringSchema))),
  publishText: z.string().optional(),
  status: menuPlanStatusSchema,
  seller: rel(z.lazy(() => sellerSchema)),
});

// ── menu contract (promoted from be domain/menu/core.ts + fe logic/menuView.ts) ──
export const menuDishSchema = z.object({
  id: id,
  name: z.string(),
  category: offeringCategorySchema,
  mainIngredient: z.string().optional(),
  tags: z.array(z.string()).optional(),
  useCount: z.number().optional(),
  lastUsedAt: z.string().optional(),
});
export const menuSlotSchema = z.object({
  day: z.string(),
  occasion: menuMealOccasionSchema,
  dishes: z.array(menuDishSchema),
});
export const weekMenuSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), menu: z.array(menuSlotSchema) }),
  z.object({
    ok: z.literal(false),
    reason: z.literal("pool-too-small"),
    missing: z.object({ category: z.string(), needed: z.number(), available: z.number(), slot: z.string() }),
  }),
]);

// ── menu plan view + swap contract (feature 003 菜单编辑 + 接龙发布) ──
/** 已发布/暂定菜单的视图（GET /menu/plans 元素 / swap 响应里的 plan）。 */
export const menuPlanViewSchema = z.object({
  planId: id,
  date: z.string(),
  occasion: menuMealOccasionSchema,
  status: z.enum(["draft", "published"]),
  dishes: z.array(menuDishSchema),
  publishText: z.string().optional(),
});
/** POST /menu/plans/:id/swap 请求体（force 仅改 published plan 时需）。 */
export const swapRequestSchema = z.object({
  dishId: id,
  replacementId: id.optional(),
  force: z.boolean().optional(),
});

// ── delivery contract (promoted from be domain/delivery/derivations.ts + fe logic/deliveryView.ts) ──
export const addressGroupSchema = z.object({
  address: z.string(),
  count: z.number(),
  fulfillments: z.array(fulfillmentSchema),
});
export const addressGapSchema = z.object({ address: z.string(), pending: z.number() });
export const deliveryViewSchema = z.object({
  sort: z.array(addressGroupSchema),
  gaps: z.object({ gaps: z.array(addressGapSchema), totalPending: z.number() }),
});

// ── chat cards (#98) ──
export const confirmCustomerItemSchema = z.object({
  customerName: z.string(),
  address: z.string().optional(),
  quantity: z.number(),
  occasion: menuMealOccasionSchema,
  date: z.string().optional(),
});
export const orderCardDataSchema = z.object({ orders: z.array(orderSchema), date: z.string() });
export const deliveryCardGroupSchema = z.object({
  address: z.string(),
  count: z.number(),
  done: z.number(),
  total: z.number(),
  ids: z.array(id),
});
export const deliveryCardDataSchema = z.object({ totalPending: z.number(), groups: z.array(deliveryCardGroupSchema) });
export const cardPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("customer-confirm"), data: z.object({ items: z.array(confirmCustomerItemSchema) }) }),
  z.object({ type: z.literal("orders"), data: orderCardDataSchema }),
  z.object({ type: z.literal("delivery"), data: deliveryCardDataSchema }),
  z.object({ type: z.literal("operation-confirm"), data: z.object({ toolName: z.string(), summary: z.string(), args: z.record(z.string(), z.unknown()) }) }),
]);

export const chatMessageSchema = z.object({
  id: id,
  operator: rel(z.lazy(() => operatorSchema)).optional(),
  content: z.string(),
  role: chatRoleSchema,
  createdAt: z.string(),
  seller: rel(z.lazy(() => sellerSchema)),
  card: cardPayloadSchema.optional(),
}).superRefine((message, ctx) => {
  if (message.role === "user" && message.card) {
    ctx.addIssue({
      code: "custom",
      path: ["card"],
      message: "user chat messages cannot carry generated cards",
    });
  }
});
