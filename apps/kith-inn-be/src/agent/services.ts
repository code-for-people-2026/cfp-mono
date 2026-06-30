/**
 * Production `AgentServices` (PR7a) — the cms-backed implementation the 「今天」
 * agent's tools drive (PRD §5.5). Thin orchestration over the injected `AgentCms`
 * + the order-domain service + the delivery derivations; no business logic of its
 * own (the agent only *edits*, it doesn't decide). Same operations the detail tabs
 * will call — two front doors, one implementation.
 *
 * `now` is injectable so `getTodaySummary`/`markDelivered` (today-scoped) are
 * deterministic in tests; default = real clock. Today = Asia/Shanghai date
 * (桃子's tz), formatted via the en-CA locale trick (YYYY-MM-DD).
 */
import type { Customer, Fulfillment, Occasion, Order, OrderStatus } from "@cfp/kith-inn-shared";
import { normalizeCustomerName } from "../domain/customers/nameNormalize";
import { gapReport } from "../domain/delivery/derivations";
import { cancelOrder, confirmOrder, recordDraft, OrderStateError, type OrderCms } from "../domain/orders/service";

/** The cms surface the agent orchestrates: OrderCms (writes + offering read) + the
 *  reads the summary/delivery tools need. Injected so tests mock it wholesale. */
export type AgentCms = OrderCms & {
  listCustomers(jwt: string, query?: { name?: string }): Promise<Customer[]>;
  listFulfillments(jwt: string, query?: { date?: string; occasion?: string }): Promise<Fulfillment[]>;
  listOrders(jwt: string, query?: { date?: string; status?: OrderStatus }): Promise<Order[]>;
};

/** Today's date (YYYY-MM-DD) in Asia/Shanghai, off the injected clock. */
export function todayShanghai(now: () => Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now());
}

function customerName(order: Order): string {
  const c = order.customer;
  return typeof c === "object" && c !== null ? c.displayName : `#${c}`;
}

type AgentServicesDeps = {
  jwt: string;
  cms: AgentCms;
  /** Clock for today-scoped ops; default = real time. */
  now?: () => Date;
};

/** Build a cms-backed AgentServices bound to one operator's JWT. */
export function createCmsAgentServices(deps: AgentServicesDeps) {
  const { jwt, cms } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async recordOrder(input: { customerName: string; quantity: number; occasion: Occasion; date?: string }) {
      try {
        const customers = await cms.listCustomers(jwt);
        const want = normalizeCustomerName(input.customerName);
        const match = customers.find((c) => normalizeCustomerName(c.displayName) === want);
        if (!match) return { ok: false as const, error: `没找到顾客「${input.customerName}」，先在顾客里录一下地址` };

        const offerings = await cms.findOfferings(jwt);
        // ponytail: 桃子 sells one combo (4菜1汤 30元/份); a 份 = one combo. Multi-combo
        // merchants are V1 — pick the first combo-meal, error if the pool has none.
        const combo = offerings.find((o) => o.kind === "combo-meal");
        if (!combo) return { ok: false as const, error: "没有套餐商品，记不了单" };

        const result = await recordDraft(
          jwt,
          {
            customer: match.id,
            date: input.date ?? todayShanghai(now),
            source: "chat-paste",
            items: [{ offering: combo.id, mealOccasion: input.occasion, quantity: input.quantity }],
          },
          cms,
        );
        return { ok: true as const, orderId: result.order.id };
      } catch {
        return { ok: false as const, error: "记单失败" };
      }
    },

    async confirmOrder(input: { orderId: string | number }) {
      try {
        await confirmOrder(jwt, input.orderId, cms);
        return { ok: true as const };
      } catch (e) {
        if (e instanceof OrderStateError) {
          return { ok: false as const, error: e.code === "slot-archived" ? "需先重开档期" : "订单不是草稿，不能确认" };
        }
        return { ok: false as const, error: "确认失败" };
      }
    },

    async cancelOrder(input: { orderId: string | number }) {
      try {
        await cancelOrder(jwt, input.orderId, cms);
        return { ok: true as const };
      } catch {
        return { ok: false as const, error: "取消失败" };
      }
    },

    async markPaid(input: { orderId: string | number }) {
      try {
        await cms.updateOrder(jwt, input.orderId, { paymentStatus: "paid", paidAt: now().toISOString() });
        return { ok: true as const };
      } catch {
        return { ok: false as const, error: "标记失败" };
      }
    },

    async markDelivered(input: { building: string; unit?: string }) {
      try {
        const fulfillments = await cms.listFulfillments(jwt, { date: todayShanghai(now) });
        const targets = fulfillments.filter(
          (f) =>
            f.addrBuilding === input.building &&
            (input.unit === undefined || f.addrUnit === input.unit) &&
            (f.status === "pending" || f.status === "handed-off"),
        );
        if (targets.length === 0) return { ok: true as const, count: 0 };
        const ids = targets.map((f) => f.orderItem as string | number);
        await cms.setFulfillmentsByOrderItems(jwt, ids, { status: "done" });
        return { ok: true as const, count: targets.length };
      } catch {
        return { ok: false as const, error: "标记失败" };
      }
    },

    async getTodaySummary() {
      try {
        const today = todayShanghai(now);
        const [orders, fulfillments] = await Promise.all([
          cms.listOrders(jwt, { date: today }),
          cms.listFulfillments(jwt, { date: today }),
        ]);
        const active = orders.filter((o) => o.status !== "canceled");
        const recentOrders = active
          .slice(0, 5)
          .map((o) => `${customerName(o)} ${o.status === "draft" ? "草稿" : ""}`.trim())
          .join("；");
        return {
          unconfirmedOrders: active.filter((o) => o.status === "draft").length,
          pendingDeliveries: gapReport(fulfillments).totalPending,
          unpaidOrders: active.filter((o) => o.status === "confirmed" && o.paymentStatus === "unpaid").length,
          recentOrders,
        };
      } catch {
        // Degrade to zeros rather than throw — the agent loop + tool both call this;
        // a throw would 502 the whole /chat. The fallback prompt asks to rephrase.
        return { unconfirmedOrders: 0, pendingDeliveries: 0, unpaidOrders: 0, recentOrders: "" };
      }
    },
  };
}
