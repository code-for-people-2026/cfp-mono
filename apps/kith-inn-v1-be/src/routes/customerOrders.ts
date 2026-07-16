import { customerOrderCancelSchema, customerOrderUpdateSchema, customerReservationInputSchema }
  from "@cfp/kith-inn-v1-shared/api";
import type { CustomerOrderCancel, CustomerOrderUpdate, CustomerOrderView, CustomerReservationInput,
  CustomerReservationResponse } from "@cfp/kith-inn-v1-shared";
import { Hono, type Context } from "hono";
import {
  CustomerReservationError,
  cancelCustomerOrder,
  editCustomerOrder,
  listCustomerOrders,
  submitCustomerReservations
} from "../domain/customerOrders/service";
import { CmsCustomerProfileError } from "../lib/cms/customerProfiles";
import { CmsBookingBatchError } from "../lib/cms/bookingBatches";
import { CmsOrderError } from "../lib/cms/orders";
import { customerAuth, type CustomerAppVars } from "../middleware/customerAuth";

export type CustomerOrderRouteDeps = {
  submit: (token: string, openid: string, input: CustomerReservationInput) => Promise<CustomerReservationResponse>;
};
export type CustomerOrderManagementRouteDeps = {
  list: (token: string) => Promise<CustomerOrderView[]>;
  edit: (token: string, id: string | number, input: CustomerOrderUpdate) => Promise<CustomerOrderView>;
  cancel: (token: string, id: string | number, input: CustomerOrderCancel) => Promise<CustomerOrderView>;
};
const defaultDeps: CustomerOrderRouteDeps = { submit: submitCustomerReservations };
const managementDefaults: CustomerOrderManagementRouteDeps = {
  list: listCustomerOrders, edit: editCustomerOrder, cancel: cancelCustomerOrder
};
const publicCmsOrderErrors = new Set([
  "invalid-customer-session", "seller-inactive", "booking-batch-closed", "meal-slot-not-in-batch",
  "meal-slot-closed", "order-deadline-passed", "customer-profile-inactive", "customer-order-status-changed"
]);
const publicItemErrors = new Set([
  "booking-batch-closed",
  "meal-slot-not-in-batch",
  "meal-slot-closed",
  "order-deadline-passed",
  "customer-profile-inactive",
  "order-coordinate-occupied",
  "confirmed-order-locked",
  "canceled-order-confirmation-required",
  "order-status-changed",
  "reservation-item-failed"
]);

async function bodyOf(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

function dependencyError(c: Context, error: unknown) {
  if (error instanceof CustomerReservationError) {
    return c.json(
      { error: error.code, message: error.message },
      error.status as 400 | 401 | 403 | 404 | 409 | 422
    );
  }
  if (error instanceof CmsOrderError) {
    if (error.code === "customer-order-not-found" || error.code === "relationship-owner-mismatch") {
      return c.json({ error: "order-not-found", message: "订单不存在" }, 404);
    }
    if (publicCmsOrderErrors.has(error.code)
      && ([401, 403, 404, 409, 422] as const).includes(error.status as 401)) {
      return c.json({ error: error.code, message: error.message }, error.status as 401 | 403 | 404 | 409 | 422);
    }
  }
  if ((error instanceof CmsCustomerProfileError || error instanceof CmsBookingBatchError)
    && ([401, 403, 404, 409, 422] as const).includes(error.status as 401)) {
    return c.json(
      { error: error.code, message: error.message },
      error.status as 401 | 403 | 404 | 409 | 422
    );
  }
  return c.json({ error: "cms-unavailable", message: "预订登记服务暂不可用" }, 502);
}

async function managementResponse(c: Context, operation: () => Promise<Record<string, unknown>>) {
  try { return c.json(await operation()); }
  catch (error) { return dependencyError(c, error); }
}

function sanitizeResult(result: CustomerReservationResponse["results"][number]) {
  if (result.status !== "failed" || publicItemErrors.has(result.error)) return result;
  return { target: result.target, status: "failed" as const,
    error: "reservation-item-failed", message: "登记失败" };
}

export function customerOrderRoutes(secret: string, deps: CustomerOrderRouteDeps = defaultDeps) {
  const app = new Hono<CustomerAppVars>();
  app.use("*", customerAuth(secret));
  app.post("/", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = customerReservationInputSchema.safeParse(body.value);
    if (!parsed.success) {
      return c.json({ error: "invalid-reservation-request", message: "预订登记参数无效" }, 422);
    }
    try {
      const result = await deps.submit(c.get("customerToken"), c.get("customerOpenid"), parsed.data);
      return c.json({ ...result, results: result.results.map(sanitizeResult) });
    } catch (error) {
      return dependencyError(c, error);
    }
  });
  return app;
}

export function customerOrderManagementRoutes(secret: string,
  deps: CustomerOrderManagementRouteDeps = managementDefaults) {
  const app = new Hono<CustomerAppVars>();
  app.use("*", customerAuth(secret));
  app.get("/", (c) => managementResponse(c, async () => ({ docs: await deps.list(c.get("customerToken")) })));
  app.patch("/:id", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = customerOrderUpdateSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-customer-order-update", message: "修改订单参数无效" }, 422);
    return managementResponse(c, async () => ({ doc:
      await deps.edit(c.get("customerToken"), c.req.param("id"), parsed.data) }));
  });
  app.post("/:id/cancel", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = customerOrderCancelSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-customer-order-cancel", message: "取消订单参数无效" }, 422);
    return managementResponse(c, async () => ({ doc:
      await deps.cancel(c.get("customerToken"), c.req.param("id"), parsed.data) }));
  });
  return app;
}
