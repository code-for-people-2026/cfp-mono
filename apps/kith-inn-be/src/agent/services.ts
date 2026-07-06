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
import type { Customer, DeliveryCardData, Fulfillment, MenuPlan, MenuPlanView, Offering, Order, OrderStatus, Seller } from "@cfp/kith-inn-shared";
import { normalizeCustomerName } from "../domain/customers/nameNormalize";
import { fulfillmentsMatchingAddress, gapReport, packingSort } from "../domain/delivery/derivations";
import { generateForTargets, swapDish, swapDishSpecified, toMenuDish } from "../domain/menu/core";
import { buildJielongMenuText } from "../domain/menu/jielongText";
import type { MenuPlanPatch, MenuPlanUpsertInput } from "../lib/cms/menuPlans";
import { cancelOrder, confirmOrder, recordDraft, OrderStateError, type OrderCms } from "../domain/orders/service";
import { customerName, todayShanghai } from "../lib/domainUtil";
import { setPending } from "./pendingState";

/** The cms surface the agent orchestrates: OrderCms (writes + offering read) + the
 *  reads the summary/delivery tools need. Injected so tests mock it wholesale. */
export type AgentCms = OrderCms & {
  listCustomers(jwt: string, query?: { name?: string }): Promise<Customer[]>;
  createCustomer(jwt: string, input: { displayName: string; address?: string }): Promise<Customer>;
  listFulfillments(jwt: string, query?: { date?: string; occasion?: string }): Promise<Fulfillment[]>;
  listOrders(jwt: string, query?: { date?: string; status?: OrderStatus }): Promise<Order[]>;
  setFulfillmentsByIds(jwt: string, ids: Array<string | number>, set: { status: "done" }): Promise<void>;
  // Menu plan cms methods (feature 005, reuse feature 003/004 cms clients)
  listMenuPlans(jwt: string, query: { from: string; to: string }): Promise<MenuPlan[]>;
  getMenuPlan(jwt: string, id: string | number): Promise<MenuPlan>;
  upsertMenuPlans(jwt: string, items: MenuPlanUpsertInput[]): Promise<MenuPlan[]>;
  patchMenuPlan(jwt: string, id: string | number, patch: MenuPlanPatch): Promise<MenuPlan>;
  getSeller(jwt: string): Promise<Seller>;
};

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
      const needsConfirmation: Array<{ customerName: string; address?: string; quantity: number; occasion: "lunch" | "dinner"; date?: string }> = [];
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
            // Carry the resolved date (item's own, else the batch default) so the
            // pending row + later confirm records the new customer for the right
            // day — not always today (Codex P1).
            needsConfirmation.push({ customerName: it.customerName, address: it.address, quantity: it.quantity, occasion: it.occasion, date: it.date ?? date });
            continue;
          }
          try {
            const result = await recordDraft(
              jwt,
              {
                customer: match.id,
                date: it.date ?? date,
                occasion: it.occasion,
                source: "chat-paste",
                items: [{ offering: combo.id, quantity: it.quantity }],
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
      // #97: persist new-customer confirmations server-side so the confirmation
      // action is a deterministic button click (POST /chat/confirm-customers),
      // not an LLM recall across turns. setPending([]) clears when there's nothing pending.
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
              occasion: it.occasion,
              source: "chat-paste",
              items: [{ offering: combo.id, quantity: it.quantity }],
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
          if (e.code === "slot-archived") return { ok: false as const, error: "需先重开档期" };
          if (e.code === "empty-order") return { ok: false as const, error: "订单没有明细，不能确认" };
          return { ok: false as const, error: "订单不是草稿，不能确认" };
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
        const targets = fulfillmentsMatchingAddress(fulfillments, address);
        if (targets.length === 0) return { ok: true as const, count: 0 };
        const ids = targets.map((f) => f.id);
        await cms.setFulfillmentsByIds(jwt, ids, { status: "done" });
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

    /** Today's orders (active only) for the orders card. */
    async getTodayOrders(): Promise<Order[]> {
      try {
        const today = todayShanghai(now);
        const orders = await cms.listOrders(jwt, { date: today });
        return orders.filter((o) => o.status !== "canceled");
      } catch {
        return [];
      }
    },

    /** Today's delivery snapshot (per-address groups + outstanding) for the delivery card. */
    async getTodayDelivery(): Promise<DeliveryCardData> {
      try {
        const today = todayShanghai(now);
        const fulfillments = await cms.listFulfillments(jwt, { date: today });
        const active = fulfillments.filter((f) => f.status !== "canceled");
        const groups = packingSort(active).map((g) => ({
          address: g.address,
          count: g.count,
          done: g.fulfillments.filter((f) => f.status === "done").length,
          total: g.fulfillments.length,
          ids: g.fulfillments.map((f) => f.id),
        }));
        return { totalPending: gapReport(active).totalPending, groups };
      } catch {
        return { totalPending: 0, groups: [] };
      }
    },

    // ── Menu tools (feature 005) ──────────────────────────────────────

    /** Generate or regenerate menu plans for given targets (feature 003 domain fns). */
    async generateMenu(targets: Array<{ date: string; occasion: "lunch" | "dinner" }>, force?: boolean) {
      try {
        const [offerings, existing] = await Promise.all([
          cms.findOfferings(jwt),
          cms.listMenuPlans(jwt, {
            from: targets.map((t) => t.date).sort()[0]!,
            to: targets.map((t) => t.date).sort().at(-1)!,
          }),
        ]);
        const pubKey = new Set(
          existing.filter((p) => p.status === "published").map((p) => {
            const s = p.slot as { date?: string; occasion?: string };
            return `${s?.date}|${s?.occasion}`;
          }),
        );
        for (const t of targets) {
          if (pubKey.has(`${t.date}|${t.occasion}`) && !force) {
            return { ok: false as const, reason: "plan-published" };
          }
        }
        const pool = offerings.filter((o) => o.active !== false && o.kind === "component").map(toMenuDish);
        const result = generateForTargets({ targets, pool });
        if (!result.ok) return { ok: false as const, reason: "pool-too-small" };
        const items: MenuPlanUpsertInput[] = result.menu.map((s) => ({
          date: s.day, occasion: s.occasion, offerings: s.dishes.map((d) => d.id), status: "draft",
        }));
        const written = await cms.upsertMenuPlans(jwt, items);
        return { ok: true as const, plans: written.map(menuPlanToView) };
      } catch {
        return { ok: false as const, reason: "generate failed" };
      }
    },

    /** Swap a dish in a plan (auto or specified). Returns {plan, warning?} or error. */
    async swapDish(planId: string | number, dishId: string | number, replacementId?: string | number, force?: boolean) {
      try {
        const plan = await cms.getMenuPlan(jwt, planId);
        if (plan.status === "published" && !force) return { ok: false as const, error: "plan-published" };
        const offerings = (plan.offerings ?? []) as Offering[];
        const pool = (await cms.findOfferings(jwt)).filter((o) => o.active !== false && o.kind === "component").map(toMenuDish);
        const slot = plan.slot as { date: string; occasion: "lunch" | "dinner" };
        const menu = [{ day: slot.date, occasion: slot.occasion, dishes: offerings.map(toMenuDish) }];
        let newReplacementId: string | number;
        let warning: string | undefined;
        if (replacementId !== undefined) {
          const r = swapDishSpecified({ menu, target: { day: slot.date, occasion: slot.occasion }, dishId, replacementId, pool });
          if (!r.ok) return { ok: false as const, error: r.reason };
          newReplacementId = r.replacement.id;
          warning = r.warning;
        } else {
          const r = swapDish({ menu, target: { day: slot.date, occasion: slot.occasion }, dishId, pool });
          if (!r.ok) return { ok: false as const, error: r.reason };
          newReplacementId = r.replacement.id;
        }
        const newOfferings = offerings.map((o) => (String(o.id) === String(dishId) ? newReplacementId : o.id));
        const patch: MenuPlanPatch = plan.status === "published"
          ? { offerings: newOfferings, publishText: null }
          : { offerings: newOfferings };
        const updated = await cms.patchMenuPlan(jwt, planId, patch);
        return { ok: true as const, plan: menuPlanToView(updated), warning };
      } catch {
        return { ok: false as const, error: "swap failed" };
      }
    },

    /** Publish a plan (draft→published + 接龙文案). */
    async publishMenu(planId: string | number) {
      try {
        const plan = await cms.getMenuPlan(jwt, planId);
        let text = plan.publishText;
        const patch: MenuPlanPatch = {};
        if (plan.status === "draft") patch.status = "published";
        if (!text) {
          const seller = await cms.getSeller(jwt);
          const dishNames = (plan.offerings as Offering[]).map((o) => o.name);
          const slot = plan.slot as { date: string; occasion: "lunch" | "dinner" };
          text = buildJielongMenuText({ date: slot.date, occasion: slot.occasion, dishNames }, { name: seller.name, priceCents: seller.defaultPriceCents });
          patch.publishText = text;
        }
        if (Object.keys(patch).length > 0) await cms.patchMenuPlan(jwt, planId, patch);
        return { ok: true as const, publishText: text };
      } catch {
        return { ok: false as const, error: "publish failed" };
      }
    },

    /** Get plans for a date (or today). */
    async getMenu(date?: string) {
      try {
        const d = date ?? todayShanghai(now);
        const plans = await cms.listMenuPlans(jwt, { from: d, to: d });
        return plans.map(menuPlanToView);
      } catch {
        return [];
      }
    },
  };
}

/** MenuPlan (cms depth-populated) → MenuPlanView. */
function menuPlanToView(plan: MenuPlan): MenuPlanView {
  const slot = plan.slot as { date: string; occasion: "lunch" | "dinner" };
  return {
    planId: plan.id,
    date: slot.date,
    occasion: slot.occasion,
    status: plan.status,
    dishes: (plan.offerings as Offering[]).map(toMenuDish),
    ...(plan.publishText ? { publishText: plan.publishText } : {}),
  };
}
