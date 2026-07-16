import { customerProfileCreateSchema, customerProfileDeactivateSchema } from "@cfp/kith-inn-v1-shared/api";
import type { CustomerProfile, CustomerProfileCreate } from "@cfp/kith-inn-v1-shared";
import { Hono, type Context } from "hono";
import {
  CmsCustomerProfileError,
  createCustomerOwnedProfile,
  deactivateCustomerOwnedProfile,
  listCustomerOwnedProfiles
} from "../lib/cms/customerProfiles";
import { customerAuth, type CustomerAppVars } from "../middleware/customerAuth";

export type CustomerProfileRouteDeps = {
  listProfiles: (token: string) => Promise<CustomerProfile[]>;
  createProfile: (token: string, input: CustomerProfileCreate) => Promise<CustomerProfile>;
  deactivateProfile: (token: string, id: string | number) => Promise<CustomerProfile>;
};
const defaultDeps: CustomerProfileRouteDeps = {
  listProfiles: listCustomerOwnedProfiles,
  createProfile: createCustomerOwnedProfile,
  deactivateProfile: deactivateCustomerOwnedProfile
};

async function bodyOf(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

function dependencyError(c: Context, error: unknown) {
  if (error instanceof CmsCustomerProfileError
    && ([401, 403, 404, 409, 422] as const).includes(error.status as 401)) {
    return c.json(
      { error: error.code, message: error.message },
      error.status as 401 | 403 | 404 | 409 | 422
    );
  }
  return c.json({ error: "cms-unavailable", message: "顾客资料服务暂不可用" }, 502);
}

export function customerProfileRoutes(secret: string, deps: CustomerProfileRouteDeps = defaultDeps) {
  const app = new Hono<CustomerAppVars>();
  app.use("*", customerAuth(secret));

  app.get("/", async (c) => {
    try {
      return c.json({ docs: await deps.listProfiles(c.get("customerToken")) });
    } catch (error) {
      return dependencyError(c, error);
    }
  });

  app.post("/", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = customerProfileCreateSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-customer-profile", message: "顾客资料参数无效" }, 422);
    try {
      const doc = await deps.createProfile(c.get("customerToken"), parsed.data);
      return c.json({ doc }, 201);
    } catch (error) {
      return dependencyError(c, error);
    }
  });

  app.post("/:id/deactivate", async (c) => {
    const rawBody = await c.req.text();
    let body: unknown = {};
    if (rawBody.trim() !== "") {
      try { body = JSON.parse(rawBody); }
      catch { return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400); }
    }
    if (!customerProfileDeactivateSchema.safeParse(body).success) {
      return c.json({ error: "invalid-customer-profile-deactivate", message: "停用资料参数无效" }, 422);
    }
    try { return c.json({ doc: await deps.deactivateProfile(c.get("customerToken"), c.req.param("id")) }); }
    catch (error) { return dependencyError(c, error); }
  });

  return app;
}
