import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Offering, OfferingCreate, OfferingUpdate } from "@cfp/kith-inn-shared";
import { offeringCreateSchema, offeringUpdateSchema } from "@cfp/kith-inn-shared/schemas";
import { findOfferings as findOfferingsFn } from "../lib/cms/client";
import {
  createOffering as createOfferingFn,
  deactivateOffering as deactivateOfferingFn,
  purgeOffering as purgeOfferingFn,
  restoreOffering as restoreOfferingFn,
  updateOffering as updateOfferingFn,
} from "../lib/cms/offerings";
import { CmsHttpError } from "../lib/cms/orders";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

/** Injectable cms boundary (default = the real cms clients). */
export type OfferingsDeps = {
  findOfferings: (operatorJwt: string) => Promise<Offering[]>;
  createOffering: (jwt: string, input: OfferingCreate) => Promise<Offering>;
  updateOffering: (jwt: string, id: string | number, patch: OfferingUpdate) => Promise<Offering>;
  deactivateOffering: (jwt: string, id: string | number) => Promise<void>;
  restoreOffering: (jwt: string, id: string | number) => Promise<void>;
  purgeOffering: (jwt: string, id: string | number) => Promise<void>;
};

/** Forward cms error status (e.g. 404 cross-tenant) instead of flattening to 502. */
const cmsStatus = (e: unknown, fallback: ContentfulStatusCode = 502): ContentfulStatusCode =>
  e instanceof CmsHttpError ? (e.status as ContentfulStatusCode) : fallback;

/**
 * Offerings routes (PRD §6.2 菜品池). All sellerAuth-protected; the operator JWT
 * is forwarded to cms as seller-token passthrough. 菜品池 = kind=component (含
 * active+inactive，FE 按 active 分「菜品池/已停用」两区); CRUD writes name +
 * mainIngredient + category; delete = soft-deactivate, restore reactivates.
 */
export function offeringsRoutes(
  jwtSecret: string,
  deps: OfferingsDeps = {
    findOfferings: findOfferingsFn,
    createOffering: createOfferingFn,
    updateOffering: updateOfferingFn,
    deactivateOffering: deactivateOfferingFn,
    restoreOffering: restoreOfferingFn,
    purgeOffering: purgeOfferingFn,
  },
) {
  const app = new Hono<AppVars>();
  app.use("*", sellerAuth(jwtSecret));

  app.get("/", async (c) => {
    // ponytail: 仅过滤 kind=component；active 分区交给 FE partitionByActive，避免 be/cms 两处重复
    const offerings = (await deps.findOfferings(c.get("token") as string)).filter((o) => o.kind === "component");
    return c.json({ offerings });
  });

  app.post("/", async (c) => {
    const parsed = offeringCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "name and category required" }, 400);
    try {
      const offering = await deps.createOffering(c.get("token") as string, parsed.data);
      return c.json({ offering }, 201);
    } catch (e) {
      return c.json({ error: "create failed" }, cmsStatus(e));
    }
  });

  app.patch("/:id", async (c) => {
    const parsed = offeringUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "no updatable fields" }, 400);
    try {
      const offering = await deps.updateOffering(c.get("token") as string, c.req.param("id"), parsed.data);
      return c.json({ offering });
    } catch (e) {
      return c.json({ error: "update failed" }, cmsStatus(e));
    }
  });

  app.delete("/:id", async (c) => {
    try {
      await deps.deactivateOffering(c.get("token") as string, c.req.param("id"));
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: "deactivate failed" }, cmsStatus(e));
    }
  });

  app.post("/:id/restore", async (c) => {
    try {
      await deps.restoreOffering(c.get("token") as string, c.req.param("id"));
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: "restore failed" }, cmsStatus(e));
    }
  });

  /** DELETE /offerings/:id/purge — hard delete (only for inactive offerings; FK-guarded by DB). */
  app.delete("/:id/purge", async (c) => {
    try {
      await deps.purgeOffering(c.get("token") as string, c.req.param("id"));
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: "purge failed" }, cmsStatus(e));
    }
  });

  return app;
}
