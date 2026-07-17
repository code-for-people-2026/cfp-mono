import {
  bulkMarkDeliveredInputSchema,
  customerProfileCreateSchema,
  manualOrderCreateSchema,
  manualOrderUpdateSchema,
  orderActionSchema,
  orderListQuerySchema,
  orderResubmitSchema
} from "@cfp/kith-inn-v1-shared/api";
import type {
  BulkMarkDeliveredResult,
  CmsCustomerProfile,
  CmsOrderCreate,
  CmsOrderUpdate,
  CustomerProfileCreate,
  MealSlot,
  Order,
  SellerSnapshot
} from "@cfp/kith-inn-v1-shared";
import { Hono, type Context } from "hono";
import {
  buildDraftOrder,
  ConfirmedImpactConfirmationRequiredError,
  editOrderPatch,
  existingOrderSummary,
  InvalidOrderTransitionError,
  publicCustomerProfile,
  resubmitOrderPatch,
  transitionOrder
} from "../domain/orders/service";
import { summarizeOrders } from "../domain/orders/summary";
import {
  CmsCustomerProfileError,
  createCustomerProfile as createCustomerProfileFn,
  listCustomerProfiles as listCustomerProfilesFn
} from "../lib/cms/customerProfiles";
import {
  CmsMealSlotError,
  getMealSlot as getMealSlotFn,
  listMealSlots as listMealSlotsFn
} from "../lib/cms/mealSlots";
import {
  CmsOrderError,
  createOrder as createOrderFn,
  getOrder as getOrderFn,
  listOrders as listOrdersFn,
  updateOrder as updateOrderFn
} from "../lib/cms/orders";
import {
  CmsSellerError,
  getSeller as getSellerFn
} from "../lib/cms/seller";
import { operatorAuth, type AppVars } from "../middleware/operatorAuth";

export type OrdersDeps = {
  getSeller: (token: string) => Promise<SellerSnapshot>;
  listMealSlots: (token: string, range: { from: string; to: string }) => Promise<MealSlot[]>;
  getMealSlot: (token: string, id: string | number) => Promise<MealSlot>;
  listCustomerProfiles: (token: string, query: string) => Promise<CmsCustomerProfile[]>;
  createCustomerProfile: (token: string, input: CustomerProfileCreate) => Promise<CmsCustomerProfile>;
  listOrders: (token: string, mealSlotId: string | number) => Promise<Order[]>;
  getOrder: (token: string, id: string | number) => Promise<Order>;
  createOrder: (token: string, input: CmsOrderCreate) => Promise<Order>;
  updateOrder: (token: string, id: string | number, input: CmsOrderUpdate) => Promise<Order>;
  now: () => string;
};

const defaultDeps: OrdersDeps = {
  getSeller: (token) => getSellerFn(token),
  listMealSlots: (token, range) => listMealSlotsFn(token, range),
  getMealSlot: (token, id) => getMealSlotFn(token, id),
  listCustomerProfiles: (token, query) => listCustomerProfilesFn(token, query),
  createCustomerProfile: (token, input) => createCustomerProfileFn(token, input),
  listOrders: (token, mealSlotId) => listOrdersFn(token, mealSlotId),
  getOrder: (token, id) => getOrderFn(token, id),
  createOrder: (token, input) => createOrderFn(token, input),
  updateOrder: (token, id, input) => updateOrderFn(token, id, input),
  now: () => new Date().toISOString()
};

async function bodyOf(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

const dependencyErrors = [
  CmsSellerError,
  CmsMealSlotError,
  CmsCustomerProfileError,
  CmsOrderError
] as const;

function isDependencyError(error: unknown): error is
  CmsSellerError | CmsMealSlotError | CmsCustomerProfileError | CmsOrderError {
  return dependencyErrors.some((ErrorType) => error instanceof ErrorType);
}

function dependencyError(c: Context, error: unknown) {
  if (!isDependencyError(error)) {
    return c.json({ error: "cms-unavailable", message: "订单服务暂不可用" }, 502);
  }
  const status = ([401, 403, 404, 409, 422] as const).includes(error.status as 401)
    ? error.status as 401 | 403 | 404 | 409 | 422
    : 502;
  return c.json({ error: error.code, message: error.message }, status);
}

export function customerProfilesRoutes(secret: string, deps: OrdersDeps = defaultDeps) {
  const app = new Hono<AppVars>();
  app.use("*", operatorAuth(secret));

  app.get("/", async (c) => {
    const query = c.req.query("query") ?? "";
    if (query.length > 240) return c.json({ error: "invalid-query", message: "顾客资料搜索词过长" }, 400);
    try {
      const docs = await deps.listCustomerProfiles(c.get("operatorToken"), query);
      return c.json({ docs: docs.map(publicCustomerProfile) });
    } catch (error) {
      return dependencyError(c, error);
    }
  });

  app.post("/", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = customerProfileCreateSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-customer-profile", message: "顾客资料无效" }, 422);
    try {
      const doc = await deps.createCustomerProfile(c.get("operatorToken"), parsed.data);
      return c.json({ doc: publicCustomerProfile(doc) }, 201);
    } catch (error) {
      return dependencyError(c, error);
    }
  });

  return app;
}

function sameId(left: string | number | null, right: string | number) {
  return String(left) === String(right);
}

export function ordersRoutes(secret: string, deps: OrdersDeps = defaultDeps) {
  const app = new Hono<AppVars>();
  app.use("*", operatorAuth(secret));

  app.get("/", async (c) => {
    const parsed = orderListQuerySchema.safeParse({
      date: c.req.query("date"),
      occasion: c.req.query("occasion")
    });
    if (!parsed.success) return c.json({ error: "invalid-order-query", message: "订单餐次无效" }, 400);
    const token = c.get("operatorToken");
    try {
      const slots = await deps.listMealSlots(token, { from: parsed.data.date, to: parsed.data.date });
      const mealSlot = slots.find((slot) => slot.date === parsed.data.date && slot.occasion === parsed.data.occasion);
      if (!mealSlot) return c.json({ error: "meal-slot-not-found", message: "餐次不存在" }, 404);
      const docs = await deps.listOrders(token, mealSlot.id);
      return c.json({ mealSlot, docs, summary: summarizeOrders(docs) });
    } catch (error) {
      return dependencyError(c, error);
    }
  });

  app.post("/", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = manualOrderCreateSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-order", message: "补单数据无效" }, 422);
    const token = c.get("operatorToken");
    try {
      const mealSlot = await deps.getMealSlot(token, parsed.data.mealSlotId);
      const profile = parsed.data.newProfile
        ? await deps.createCustomerProfile(token, parsed.data.newProfile)
        : (await deps.listCustomerProfiles(token, ""))
          .find((candidate) => sameId(candidate.id, parsed.data.customerProfileId!));
      if (!profile) {
        return c.json({ error: "customer-profile-not-found", message: "顾客资料不存在" }, 404);
      }
      const input = buildDraftOrder({
        seller: await deps.getSeller(token),
        slot: mealSlot,
        profile,
        quantity: parsed.data.quantity,
        note: parsed.data.note
      });
      try {
        const doc = await deps.createOrder(token, input);
        return c.json({ doc, profile: publicCustomerProfile(profile) }, 201);
      } catch (error) {
        if (!(error instanceof CmsOrderError) || error.status !== 409) throw error;
        const existing = (await deps.listOrders(token, mealSlot.id))
          .find((candidate) => sameId(candidate.customerProfileId, profile.id));
        if (!existing) throw error;
        const canceled = existing.status === "canceled";
        return c.json({
          error: canceled ? "canceled-order-exists" : "order-exists",
          message: canceled ? "已取消订单需要明确重提" : "订单已存在，请确认更新",
          existing: existingOrderSummary(existing)
        }, 409);
      }
    } catch (error) {
      return dependencyError(c, error);
    }
  });

  app.patch("/:id", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = manualOrderUpdateSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-order-update", message: "订单修改无效" }, 422);
    const token = c.get("operatorToken");
    try {
      const order = await deps.getOrder(token, c.req.param("id"));
      const patch = editOrderPatch(order, parsed.data);
      return c.json({
        doc: Object.keys(patch).length === 0
          ? order
          : await deps.updateOrder(token, c.req.param("id"), patch)
      });
    } catch (error) {
      if (error instanceof ConfirmedImpactConfirmationRequiredError) {
        return c.json({ error: "confirmed-impact-confirmation-required", message: error.message }, 409);
      }
      if (error instanceof InvalidOrderTransitionError) {
        return c.json({ error: "invalid-order-transition", message: error.message }, 409);
      }
      return dependencyError(c, error);
    }
  });

  app.post("/bulk-mark-delivered", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = bulkMarkDeliveredInputSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-bulk-selection", message: "批量订单选择无效" }, 422);
    const token = c.get("operatorToken");
    const now = deps.now();
    const results: BulkMarkDeliveredResult[] = [];
    for (const id of parsed.data.ids) {
      try {
        const order = await deps.getOrder(token, id);
        const patch = transitionOrder(order, "mark-delivered", now);
        if (patch !== null) await deps.updateOrder(token, id, patch);
        results.push({ id, status: "updated" });
      } catch (error) {
        if (isDependencyError(error) && (error.status === 401 || error.status === 403)) {
          return dependencyError(c, error);
        }
        results.push({
          id,
          status: "failed",
          error: error instanceof InvalidOrderTransitionError
            ? "invalid-order-transition"
            : isDependencyError(error) ? error.code : "cms-unavailable"
        });
      }
    }
    return c.json({ results });
  });

  app.post("/:id/:action", async (c) => {
    const action = orderActionSchema.safeParse(c.req.param("action"));
    if (!action.success) return c.json({ error: "not-found", message: "订单操作不存在" }, 404);
    const token = c.get("operatorToken");
    const id = c.req.param("id");
    try {
      const order = await deps.getOrder(token, id);
      let patch: CmsOrderUpdate | null;
      if (action.data === "resubmit") {
        const body = await bodyOf(c);
        if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
        const input = orderResubmitSchema.safeParse(body.value);
        if (!input.success) return c.json({ error: "invalid-order-resubmit", message: "订单重提数据无效" }, 422);
        const [mealSlot, seller] = await Promise.all([
          deps.getMealSlot(token, order.mealSlotId),
          deps.getSeller(token)
        ]);
        patch = resubmitOrderPatch(order, input.data, mealSlot.priceCents ?? seller.defaultPriceCents);
      } else {
        patch = transitionOrder(order, action.data, deps.now());
      }
      return c.json({ doc: patch === null ? order : await deps.updateOrder(token, id, patch) });
    } catch (error) {
      if (error instanceof InvalidOrderTransitionError) {
        return c.json({ error: "invalid-order-transition", message: error.message }, 409);
      }
      return dependencyError(c, error);
    }
  });

  return app;
}
