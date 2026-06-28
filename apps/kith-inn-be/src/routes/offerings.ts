import { Hono } from "hono";
import type { Offering } from "@cfp/kith-inn-shared";
import { findOfferings as findOfferingsFn } from "../lib/cms/client";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

/** Injectable cms boundary (default = the real fetch-based client). */
export type OfferingsDeps = {
  findOfferings: (operatorJwt: string) => Promise<Offering[]>;
};

/**
 * `GET /offerings` — the H5 deliverable's data source: 桃子's offering pool with
 * 主料 labels. Protected by sellerAuth (the operator JWT carries the sellerId);
 * the raw token is forwarded to cms as `x-kith-inn-operator` (seller-token
 * passthrough, no admin key).
 */
export function offeringsRoutes(jwtSecret: string, deps: OfferingsDeps = { findOfferings: findOfferingsFn }) {
  const app = new Hono<AppVars>();
  app.use("/", sellerAuth(jwtSecret));
  app.get("/", async (c) => {
    // sellerAuth guarantees `token` is set (it 401s otherwise); the cast encodes
    // that invariant without a dead defensive branch.
    const offerings = await deps.findOfferings(c.get("token") as string);
    return c.json({ offerings });
  });
  return app;
}
