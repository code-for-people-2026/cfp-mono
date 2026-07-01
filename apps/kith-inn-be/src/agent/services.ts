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
import type { Customer, Fulfillment, Order, OrderStatus } from "@cfp/kith-inn-shared";
import { normalizeCustomerName } from "../domain/customers/nameNormalize";
import { gapReport } from "../domain/delivery/derivations";
import { cancelOrder, confirmOrder, recordDraft, OrderStateError, type OrderCms } from "../domain/orders/service";
import { setPending } from "./pendingState";

/** The cms surface the agent orchestrates: OrderCms (writes + offering read) + the
 *  reads the summary/delivery tools need. Injected so tests mock it wholesale. */
export type AgentCms = OrderCms & {
  listCustomers(jwt: string, query?: { name?: string }): Promise<Customer[]>;
  createCustomer(jwt: string, input: { displayName: string; address?: string }): Promise<Customer>;
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
  /** Operator id (from JWT) — keys the server-side pending confirmations. */
  operatorId: string | number;
  /** Clock for today-scoped ops; default = real time. */
  now?: () => Date;
};

/** Build a cms-backed AgentServices bound to one operator's JWT. */
export function createCmsAgentServices(deps: AgentServicesDeps) {
  const { jwt, cms, operatorId } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    /**
     * Batch-record an 接龙 paste. Existing customers (matched by normalized name)
     * → draft recorded; new names → collected in `needsConfirmation` for 桃子 to
     * confirm (NOT created here — customers are created on confirmation, never
     * speculatively). One combo per item (桃子 = single combo).
     */
    async recordOrders(items: Array<{ customerName: string; address?: string; quantity: number; occasion: "lunch" | "dinner"; date?: string }>) {
      const recorded: Array<{ name: string; orderId: string | number }> = [];
      const needsConfirmation: Array<{ customerName: string; address?: string; quantity: number; occasion: "lunch" | "dinner" }> = [];
      const failed: Array<{ customerName: string; error: string }> = [];
      try {
        const [customers, offerings] = await Promise.all([cms.listCustomers(jwt), cms.findOfferings(jwt)]);
        // ponytail: 桃子 sells one combo (4菜1汤 30元/份); a 份 = one combo. Multi-combo
        // merchants are V1 — pick the first combo-meal, error if the pool has none.
        const combo = offerings.find((o) => o.kind === "combo-meal");
        const date = items.find((it) => it.date)?.date ?? todayShanghai(now);
        for (const it of items) {
          if (!combo) {
            failed.push({ customerName: it.customerName, error: "没有套餐商品，记不了单" });
            continue;
          }
          const want = normalizeCustomerName(it.customerName);
          const match = customers.find((c) => normalizeCustomerName(c.displayName) === want);
          if (!match) {
            needsConfirmation.push({ customerName: it.customerName, address: it.address, quantity: it.quantity, occasion: it.occasion });
            continue;
          }
          try {
            const result = await recordDraft(
              jwt,
              {
                customer: match.id,
                date: it.date ?? date,
                source: "chat-paste",
                items: [{ offering: combo.id, mealOccasion: it.occasion, quantity: it.quantity }],
              },
              cms,
            );
            recorded.push({ name: it.customerName, orderId: result.order.id });
          } catch {
            failed.push({ customerName: it.customerName, error: "记单失败" });
          }
        }
      } catch {
        // whole-batch failure (cms read down) → everything failed
        for (const it of items) failed.push({ customerName: it.customerName, error: "记单失败" });
      }
      // #97: persist new-customer confirmations server-side so 「都建」 is a
      // deterministic button click (POST /chat/confirm-customers), not an LLM
      // recall across turns. setPending([]) clears when there's nothing pending.
      setPending(operatorId, needsConfirmation);
      return { recorded, needsConfirmation, failed };
    },

    /**
     * After 桃子 confirms the new-customer list: create each customer then record
     * their draft in one pass. Errors are collected per-item (don't abort the batch).
     */
    async createCustomersAndOrders(items: Array<{ displayName: string; address?: string; quantity: number; occasion: "lunch" | "dinner"; date?: string }>) {
      const created: Array<{ name: string; orderId: string | number }> = [];
      const failed: Array<{ displayName: string; error: string }> = [];
      const offerings = await cms.findOfferings(jwt).catch(() => []);
      const combo = offerings.find((o) => o.kind === "combo-meal");
      const date = items.find((it) => it.date)?.date ?? todayShanghai(now);
      for (const it of items) {
        try {
          if (!combo) {
            failed.push({ displayName: it.displayName, error: "没有套餐商品，记不了单" });
            continue;
          }
          const customer = await cms.createCustomer(jwt, { displayName: it.displayName, address: it.address });
          const result = await recordDraft(
            jwt,
            {
              customer: customer.id,
              date: it.date ?? date,
              source: "chat-paste",
              items: [{ offering: combo.id, mealOccasion: it.occasion, quantity: it.quantity }],
            },
            cms,
          );
          created.push({ name: it.displayName, orderId: result.order.id });
        } catch {
          failed.push({ displayName: it.displayName, error: "建顾客或记单失败" });
        }
      }
      return { created, failed };
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

    async markDelivered(input: { address: string }) {
      // Codex P1: a blank address makes `"...".includes("")` true for every
      // fulfillment → would mark ALL of them done. Reject up front.
      const address = input.address?.trim();
      if (!address) return { ok: false as const, error: "地址不能为空" };
      try {
        const fulfillments = await cms.listFulfillments(jwt, { date: todayShanghai(now) });
        // Address lives on the ORDER (frozen snapshot), not the fulfillment —
        // cms populates orderItem→order, so resolve each one's order.address.
        const orderAddress = (f: Fulfillment): string => {
          const oi = f.orderItem;
          if (oi && typeof oi === "object") {
            const o = oi.order;
            if (o && typeof o === "object" && typeof o.address === "string") return o.address;
          }
          return "";
        };
        const targets = fulfillments.filter(
          (f) =>
            orderAddress(f).includes(address) &&
            (f.status === "pending" || f.status === "handed-off"),
        );
        if (targets.length === 0) return { ok: true as const, count: 0 };
        const ids = targets.map((f) => (typeof f.orderItem === "object" ? f.orderItem.id : f.orderItem));
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
