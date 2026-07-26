import type { ServiceClosure, ServiceClosureCreate } from "@cfp/kith-inn-v1-shared";
import { mealSlotRangeSchema, serviceClosureCreateSchema } from "@cfp/kith-inn-v1-shared/api";
import { Hono } from "hono";
import {
  CmsServiceClosureError,
  createServiceClosure as createClosureFn,
  deleteServiceClosure as deleteClosureFn,
  listServiceClosures as listClosuresFn
} from "../lib/cms/serviceClosures";
import { operatorAuth, type AppVars } from "../middleware/operatorAuth";

export type ServiceClosuresDeps = {
  listClosures: (token: string, range: { from: string; to: string }) => Promise<ServiceClosure[]>;
  createClosure: (token: string, input: ServiceClosureCreate) => Promise<ServiceClosure>;
  deleteClosure: (token: string, id: string | number) => Promise<void>;
};

const defaultDeps: ServiceClosuresDeps = {
  listClosures: listClosuresFn,
  createClosure: createClosureFn,
  deleteClosure: deleteClosureFn
};

export function serviceClosuresRoutes(secret: string, deps: ServiceClosuresDeps = defaultDeps) {
  const app = new Hono<AppVars>();
  app.use("*", operatorAuth(secret));

  const dependencyError = (error: unknown) => {
    if (!(error instanceof CmsServiceClosureError)) {
      return { status: 502 as const, body: { error: "cms-unavailable", message: "营业安排服务暂不可用" } };
    }
    const status: 401 | 403 | 404 | 409 | 422 | 502 = error.code === "internal-unauthorized"
      ? 502
      : ([401, 403, 404, 409, 422] as const).includes(error.status as 401)
      ? error.status as 401 | 403 | 404 | 409 | 422
      : 502;
    return { status, body: { error: error.code, message: error.message } };
  };

  app.get("/", async (c) => {
    const parsed = mealSlotRangeSchema.safeParse({ from: c.req.query("from"), to: c.req.query("to") });
    if (!parsed.success) return c.json({ error: "invalid-service-closure-range", message: "日期范围无效" }, 400);
    try {
      return c.json({ docs: await deps.listClosures(c.get("operatorToken"), parsed.data) });
    } catch (error) {
      const mapped = dependencyError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    }
    const parsed = serviceClosureCreateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid-service-closure", message: "打烊安排无效" }, 422);
    try {
      return c.json({ doc: await deps.createClosure(c.get("operatorToken"), parsed.data) }, 201);
    } catch (error) {
      const mapped = dependencyError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  app.delete("/:id", async (c) => {
    try {
      await deps.deleteClosure(c.get("operatorToken"), c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      const mapped = dependencyError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  return app;
}
