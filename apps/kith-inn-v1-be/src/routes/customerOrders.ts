import { customerReservationInputSchema } from "@cfp/kith-inn-v1-shared/api";
import type { CustomerReservationInput, CustomerReservationResponse } from "@cfp/kith-inn-v1-shared";
import { Hono, type Context } from "hono";
import {
  CustomerReservationError,
  submitCustomerReservations
} from "../domain/customerOrders/service";
import { CmsCustomerProfileError } from "../lib/cms/customerProfiles";
import { customerAuth, type CustomerAppVars } from "../middleware/customerAuth";

export type CustomerOrderRouteDeps = {
  submit: (token: string, openid: string, input: CustomerReservationInput) => Promise<CustomerReservationResponse>;
};
const defaultDeps: CustomerOrderRouteDeps = { submit: submitCustomerReservations };

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
  if (error instanceof CmsCustomerProfileError
    && ([401, 403, 404, 409, 422] as const).includes(error.status as 401)) {
    return c.json(
      { error: error.code, message: error.message },
      error.status as 401 | 403 | 404 | 409 | 422
    );
  }
  return c.json({ error: "cms-unavailable", message: "预订登记服务暂不可用" }, 502);
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
      return c.json(result);
    } catch (error) {
      return dependencyError(c, error);
    }
  });
  return app;
}
