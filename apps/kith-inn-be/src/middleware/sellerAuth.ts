import type { MiddlewareHandler } from "hono";
import { verifyToken } from "../lib/auth/jwt";

/** Hono app variables set by the seller-auth middleware. */
export type AppVars = {
  Variables: {
    operatorId?: string | number;
    sellerId?: string | number;
    token?: string;
  };
};

/**
 * Verify the operator JWT from `Authorization: Bearer <token>`, then attach the
 * operatorId / sellerId / raw token to the context for downstream routes. The
 * sellerId drives every tenant-scoped read; the raw token is forwarded to cms as
 * `x-kith-inn-operator` (seller-token passthrough — no admin key, §3.1).
 *
 * Fail-closed: any missing/invalid token → 401. A missing JWT_SECRET (passed as
 * `""`) makes every verify fail → 401, so a misconfigured server refuses all
 * tenant access rather than granting it.
 */
export function sellerAuth(secret: string): MiddlewareHandler<AppVars> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = header.slice("Bearer ".length);
    const payload = await verifyToken(token, secret);
    if (!payload) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("operatorId", payload.operatorId);
    c.set("sellerId", payload.sellerId);
    c.set("token", token);
    await next();
  };
}
