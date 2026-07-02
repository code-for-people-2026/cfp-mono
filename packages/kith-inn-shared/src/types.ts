/**
 * kith-inn domain entity types — the FE ↔ BE ↔ cms contract. Plain TS, no
 * Payload dependency. They mirror the Payload collection shapes (hand-written
 * because cms disables Payload type generation); drift is watched by review.
 *
 * `seller` / relationship fields are union of bare id or populated doc, matching
 * Payload's shallow (`number | string`) vs populated (`{ id }`) shapes.
 */
import type {
  ChatRole,
  CustomerKind,
  FulfillmentMode,
  FulfillmentStatus,
  MenuPlanStatus,
  Occasion,
  OfferingCategory,
  OfferingKind,
  OperatorRole,
  OrderSource,
  OrderStatus,
  PaymentStatus,
  SellerModule,
  SellerStatus,
  ServiceSlotGranularity,
  ServiceSlotStatus,
} from "./enums";

export type Seller = {
  id: string | number;
  name: string;
  serviceArea?: string;
  /** Pricing-resolver fallback (桃子 = 3000 = 30 元/份). */
  defaultPriceCents?: number;
  status: SellerStatus;
  /** Combo fact-source: which modules are on — drives access/tab/agent-tool gating. */
  enabledModules?: SellerModule[];
  /** Per-module config json (e.g. delivery.deliverers, menuStructure, serviceDays). */
  moduleSettings?: Record<string, unknown>;
  profileFreeText?: string;
};

export type Operator = {
  id: string | number;
  wechatOpenid: string;
  role: OperatorRole;
  active: boolean;
  seller: string | number | Seller;
};

export type Customer = {
  id: string | number;
  /** 接龙里的称呼 — identification key (NOT unique; MVP name-normalize + manual merge). */
  displayName: string;
  kind: CustomerKind;
  defaultServings?: number;
  defaultOccasion?: Occasion;
  note?: string;
  /** 自由文本送餐地址（如 "3e23a"）——桃子送餐时认得就行，不结构化。下单时若是
   *  新顾客，凭这个（+姓名）创建；下单（draft-create）时快照进 order.address。 */
  address?: string;
  seller: string | number | Seller;
};

export type Offering = {
  id: string | number;
  name: string;
  kind: OfferingKind;
  mainIngredient?: string;
  category?: OfferingCategory;
  /** combo → its components (self-relationship). */
  parentOfferings?: Array<string | number | Offering>;
  unitLabel?: string;
  /** 菜品定价 (pricing-resolver middle priority). */
  priceCents?: number;
  /** json string-array (清淡/费工…) — lean modeling, no per-tag sub-tables. */
  tags?: string[];
  lastUsedAt?: string;
  useCount?: number;
  recipe?: Record<string, unknown>;
  active?: boolean;
  seller: string | number | Seller;
};

export type ServiceSlot = {
  id: string | number;
  date: string;
  granularity: ServiceSlotGranularity;
  occasion?: Occasion;
  startAt?: string;
  endAt?: string;
  status: ServiceSlotStatus;
  seller: string | number | Seller;
};

export type OrderItem = {
  id: string | number;
  order: string | number | Order;
  offering: string | number | Offering;
  mealOccasion?: Occasion;
  /** time-slot-granularity sellers only; snapshot from the slot's startAt/endAt. */
  timeWindow?: string;
  quantity: number;
  /** Empty = derive default; snapshotted at draft-create (M1 simplification). */
  unitPriceCents?: number;
  note?: string;
  seller: string | number | Seller;
};

export type Order = {
  id: string | number;
  customer: string | number | Customer;
  /** 用餐日 (≠ 录入时间). Day-granular. */
  date: string;
  status: OrderStatus;
  source: OrderSource;
  placedAt?: string;
  note?: string;
  /** Read-only derived = Σ(item.quantity × resolved unit price); canceled excluded. */
  totalCents?: number;
  /** Frozen delivery-address snapshot — copied from customer.address at draft-create,
   *  like e-commerce (the order never changes address after creation; an edit = new order). */
  address?: string;
  paymentStatus: PaymentStatus;
  paymentMethod?: string;
  paidAt?: string;
  idempotencyKey?: string;
  createdBy?: string | number | Operator;
  seller: string | number | Seller;
};

export type Fulfillment = {
  id: string | number;
  orderItem: string | number | OrderItem;
  /** Denormalized 用餐日 — delivery views batch on it, avoid re-joining order. */
  serviceDate: string;
  occasion?: Occasion;
  mode: FulfillmentMode;
  status: FulfillmentStatus;
  /** Controlled value ∈ seller.moduleSettings.delivery.deliverers. */
  assignee?: string;
  timeWindow?: string;
  seller: string | number | Seller;
};

export type MenuPlan = {
  id: string | number;
  slot: string | number | ServiceSlot;
  offerings: Array<string | number | Offering>;
  publishText?: string;
  status: MenuPlanStatus;
  seller: string | number | Seller;
};

export type ChatMessage = {
  id: string | number;
  operator?: string | number | Operator;
  content: string;
  role: ChatRole;
  createdAt: string;
  seller: string | number | Seller;
};

/** One new-customer row surfaced in a customer-confirm card (mirrors the agent's
 *  `needsConfirmation` shape — passed through unchanged). `date` is the meal day
 *  the row should be recorded for (defaults to today at record time). */
export type ConfirmCustomerItem = {
  customerName: string;
  address?: string;
  quantity: number;
  occasion: "lunch" | "dinner";
  date?: string;
};

/** A structured card attached to an assistant chat reply (lower-AI-narration,
 *  higher-trust surface than prose). Lives only on the turn that produced it —
 *  cards are NOT persisted into chat history (MVP). */
export type OrderCardData = { orders: Order[]; date: string };

/** Delivery snapshot for a delivery card: outstanding count + per-address groups
 *  (pre-aggregated so the FE renders without re-deriving). `ids` = the group's
 *  orderItem ids, so the 「送达」 button marks exactly this group (not a substring
 *  match that would spill across addresses — Codex P1). */
export type DeliveryCardGroup = { address: string; count: number; done: number; total: number; ids: Array<string | number> };
export type DeliveryCardData = { totalPending: number; groups: DeliveryCardGroup[] };

export type CardPayload =
  | { type: "customer-confirm"; data: { items: ConfirmCustomerItem[] } }
  | { type: "orders"; data: OrderCardData }
  | { type: "delivery"; data: DeliveryCardData };
