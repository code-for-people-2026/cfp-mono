/**
 * Production `AgentServices` (PR7a) — the cms-backed implementation the 「今天」
 * agent's tools drive (PRD §5.5). Thin orchestration over the injected `AgentCms`
 * + the order-domain service + the delivery derivations; no business logic of its
 * own (the agent only *edits*, it doesn't decide). Same operations the detail tabs
 * will call — two front doors, one implementation.
 *
 * `now` is injectable so `getTodaySummary` (today-scoped) is
 * deterministic in tests; default = real clock. Today = Asia/Shanghai date
 * (桃子's tz), formatted via the en-CA locale trick (YYYY-MM-DD).
 */
import type { Customer, DeliveryCardData, Fulfillment, MenuPlan, MenuPlanView, Offering, Order, OrderStatus, Seller } from "@cfp/kith-inn-shared";
import { normalizeCustomerName } from "../domain/customers/nameNormalize";
import { gapReport, packingSort } from "../domain/delivery/derivations";
import { generateForTargets, swapDish, swapDishSpecified, toMenuDish } from "../domain/menu/core";
import { buildJielongMenuText } from "../domain/menu/jielongText";
import type { MenuPlanPatch, MenuPlanUpsertInput } from "../lib/cms/menuPlans";
import { cancelOrder, confirmOrder, recordDraft, OrderStateError, type OrderCms } from "../domain/orders/service";
import { customerName, todayShanghai } from "../lib/domainUtil";

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
  createOffering(jwt: string, input: { name: string; mainIngredient?: string; category?: string }): Promise<{ id: string | number; name: string }>;
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
  /** Payload date fields return ISO (e.g. 2026-07-08T00:00:00.000Z); trim to YYYY-MM-DD. */
  const dayOnly = (iso: string) => iso.split("T")[0]!;

  return {
    /**
     * Read-only classify of an 接龙 paste for the record_orders preview card (#126):
     * which names are existing customers vs new (need 桃子 to type an address).
     * Returns `isNew` aligned by index with `items` — NO writes. The actual record
     * happens on confirm (recordOrders for known, createCustomersAndOrders for new).
     * Throws if the customer lookup fails — never silently classify unknown as "new"
     * (that would create duplicates on confirm). Caller (the tool) surfaces the error.
     */
    async previewOrders(items: Array<{ customerName: string; quantity: number; occasion: "lunch" | "dinner"; date?: string }>) {
      const customers = await cms.listCustomers(jwt);
      const knownSet = new Set(customers.map((c) => normalizeCustomerName(c.displayName)));
      const date = items.find((it) => it.date)?.date ?? todayShanghai(now);
      return { date, isNew: items.map((it) => !knownSet.has(normalizeCustomerName(it.customerName))) };
    },

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
      // In the #126 flow record_orders preview already split known/new, so this is
      // only called for known items and needsConfirmation stays empty. Returned for
      // any caller that still inspects it.
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

    async markUnpaid(input: { orderId: string | number }) {
      // ponytail: OrderUpdatePatch.paidAt 类型是 string（非 nullable），且全仓无人读 paidAt——
      // 回退只翻 paymentStatus=unpaid，留旧 paidAt 无害。要部分退款/清付款时间时再扩类型为 nullable。
      try {
        await cms.updateOrder(jwt, input.orderId, { paymentStatus: "unpaid" });
        return { ok: true as const };
      } catch {
        return { ok: false as const, error: "回退失败" };
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
            return `${s?.date?.split("T")[0]}|${s?.occasion}`;
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
        const date = dayOnly(slot.date);
        const menu = [{ day: date, occasion: slot.occasion, dishes: offerings.map(toMenuDish) }];
        let newReplacementId: string | number;
        let warning: string | undefined;
        if (replacementId !== undefined) {
          const r = swapDishSpecified({ menu, target: { day: date, occasion: slot.occasion }, dishId, replacementId, pool });
          if (!r.ok) return { ok: false as const, error: r.reason };
          newReplacementId = r.replacement.id;
          warning = r.warning;
        } else {
          const r = swapDish({ menu, target: { day: date, occasion: slot.occasion }, dishId, pool });
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
          text = buildJielongMenuText([{ date: dayOnly(slot.date), occasion: slot.occasion, dishNames }], { name: seller.name, priceCents: seller.defaultPriceCents });
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

    /** Get the dish pool (active component offerings). */
    async getDishPool() {
      try {
        const offerings = await cms.findOfferings(jwt);
        return offerings
          .filter((o) => o.active !== false && o.kind === "component")
          .map((o) => ({ id: o.id, name: o.name, mainIngredient: o.mainIngredient, category: o.category }));
      } catch {
        return [];
      }
    },

    /** Add a dish to the pool (feature 002 cms internal POST). */
    async createOffering(input: { name: string; mainIngredient?: string; category?: string }) {
      return cms.createOffering(jwt, input);
    },

    // ── Preview reads for operation-confirm cards (#126 rich previews) ───────
    // All read-only: mirror the write method's compute without persisting. Failures
    // degrade to a safe default (null / empty / reason) so the tool still emits a card.

    /** Order display info for confirm/cancel/mark_paid/mark_unpaid previews. */
    async previewOrder(orderId: string | number) {
      try {
        const o = await cms.getOrder(jwt, orderId);
        const c = o.customer;
        const displayName = c && typeof c === "object" ? ((c as { displayName?: string }).displayName ?? String(o.customer)) : String(o.customer);
        const quantity = (o.items ?? []).reduce((n, it) => n + (it.quantity ?? 0), 0);
        return { displayName, quantity, occasion: o.occasion };
      } catch {
        return null;
      }
    },
    /** Planned dish lines for a generate_menu preview (dry-run, no upsert). */
    async previewMenuTargets(targets: Array<{ date: string; occasion: "lunch" | "dinner" }>, force?: boolean) {
      try {
        const [offerings, existing] = await Promise.all([
          cms.findOfferings(jwt),
          cms.listMenuPlans(jwt, { from: targets.map((t) => t.date).sort()[0]!, to: targets.map((t) => t.date).sort().at(-1)! }),
        ]);
        const pubKey = new Set(
          existing.filter((p) => p.status === "published").map((p) => {
            const s = p.slot as { date?: string; occasion?: string };
            return `${s?.date?.split("T")[0]}|${s?.occasion}`;
          }),
        );
        for (const t of targets) if (pubKey.has(`${t.date}|${t.occasion}`) && !force) return { ok: false as const, reason: "plan-published" };
        const pool = offerings.filter((o) => o.active !== false && o.kind === "component").map(toMenuDish);
        const result = generateForTargets({ targets, pool });
        if (!result.ok) return { ok: false as const, reason: "pool-too-small" };
        return { ok: true as const, lines: result.menu.map((s) => `${s.occasion === "lunch" ? "午餐" : "晚餐"}：${s.dishes.map((d) => d.name).join("、")}`) };
      } catch {
        return { ok: false as const, reason: "preview failed" };
      }
    },
    /** old→new dish names for a swap_dish preview (dry-run, no patch). */
    async previewSwap(planId: string | number, dishId: string | number, replacementId: string | number | undefined, force?: boolean) {
      try {
        const plan = await cms.getMenuPlan(jwt, planId);
        if (plan.status === "published" && !force) return { ok: false as const, error: "plan-published" };
        const offerings = (plan.offerings ?? []) as Offering[];
        const target = offerings.find((o) => String(o.id) === String(dishId));
        const pool = (await cms.findOfferings(jwt)).filter((o) => o.active !== false && o.kind === "component").map(toMenuDish);
        const slot = plan.slot as { date: string; occasion: "lunch" | "dinner" };
        const date = dayOnly(slot.date);
        const menu = [{ day: date, occasion: slot.occasion, dishes: offerings.map(toMenuDish) }];
        let newName: string;
        let warning: string | undefined;
        if (replacementId !== undefined) {
          const r = swapDishSpecified({ menu, target: { day: date, occasion: slot.occasion }, dishId, replacementId, pool });
          if (!r.ok) return { ok: false as const, error: r.reason };
          newName = r.replacement.name;
          warning = r.warning;
        } else {
          const r = swapDish({ menu, target: { day: date, occasion: slot.occasion }, dishId, pool });
          if (!r.ok) return { ok: false as const, error: r.reason };
          newName = r.replacement.name;
        }
        return { ok: true as const, oldName: target?.name ?? `#${dishId}`, newName, ...(warning ? { warning } : {}) };
      } catch {
        return { ok: false as const, error: "preview failed" };
      }
    },
    /** The 掾龙 text for a publish_menu preview (no status flip / patch). */
    async previewPublish(planId: string | number) {
      try {
        const plan = await cms.getMenuPlan(jwt, planId);
        let text = plan.publishText;
        if (!text) {
          const seller = await cms.getSeller(jwt);
          const dishNames = (plan.offerings as Offering[]).map((o) => o.name);
          const slot = plan.slot as { date: string; occasion: "lunch" | "dinner" };
          text = buildJielongMenuText([{ date: dayOnly(slot.date), occasion: slot.occasion, dishNames }], { name: seller.name, priceCents: seller.defaultPriceCents });
        }
        return { ok: true as const, publishText: text };
      } catch {
        return { ok: false as const, error: "preview failed" };
      }
    },

    operatorId,
  };
}

/** MenuPlan (cms depth-populated) → MenuPlanView. */
function menuPlanToView(plan: MenuPlan): MenuPlanView {
  const slot = plan.slot as { date: string; occasion: "lunch" | "dinner" };
  return {
    planId: plan.id,
    date: slot.date.split("T")[0]!,
    occasion: slot.occasion,
    status: plan.status,
    dishes: (plan.offerings as Offering[]).map(toMenuDish),
    ...(plan.publishText ? { publishText: plan.publishText } : {}),
  };
}
