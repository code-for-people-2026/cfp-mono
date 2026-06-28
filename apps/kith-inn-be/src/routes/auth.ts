import { Hono } from "hono";
import { issueToken } from "../lib/auth/jwt";
import { findOperatorByOpenid as findOperatorByOpenidFn, type OperatorRecord } from "../lib/cms/client";
import { code2session as code2sessionFn } from "../lib/wx/code2session";

/** Injectable boundary dependencies (defaults = the real fetch-based impls). */
export type AuthDeps = {
  code2session: (code: string) => Promise<string>;
  findOperatorByOpenid: (openid: string) => Promise<OperatorRecord | null>;
};

/**
 * `POST /auth/wx-login { code }` — the login trust root (Tech Spec §3.1):
 * code → openid → operator → seller, then issue an operator JWT the FE holds and
 * the BE forwards to cms. The operator must be provisioned (seeded) + active; a
 * new openid is NOT auto-onboarded in M0 (that's M4 multi-seller).
 */
export function authRoutes(jwtSecret: string, deps: AuthDeps = {
  code2session: code2sessionFn,
  findOperatorByOpenid: findOperatorByOpenidFn,
}) {
  const app = new Hono();
  app.post("/wx-login", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
    const code = body?.code;
    if (typeof code !== "string" || code === "") {
      return c.json({ error: "code required" }, 400);
    }
    try {
      const openid = await deps.code2session(code);
      const operator = await deps.findOperatorByOpenid(openid);
      if (!operator || !operator.active) {
        return c.json({ error: "operator not provisioned" }, 401);
      }
      const token = await issueToken(
        { operatorId: operator.id, sellerId: operator.sellerId, role: operator.role },
        jwtSecret,
      );
      return c.json({
        token,
        operator: { id: operator.id, sellerId: operator.sellerId, role: operator.role },
      });
    } catch {
      // WeChat or cms unreachable / errored — fail closed, don't leak internals.
      return c.json({ error: "wx-login failed" }, 502);
    }
  });

  /**
   * `POST /auth/dev-login { openid }` — H5 dev shortcut (no Taro.login on H5).
   * Skips the WeChat code exchange and looks up the operator by openid directly.
   * Only available when `NODE_ENV !== "production"` — the FE's H5 dev path uses
   * this; weapp uses /wx-login.
   */
  app.post("/dev-login", async (c) => {
    if (process.env.NODE_ENV === "production") {
      return c.json({ error: "dev-login disabled in production" }, 404);
    }
    const body = (await c.req.json().catch(() => null)) as { openid?: unknown } | null;
    const openid = body?.openid;
    if (typeof openid !== "string" || openid === "") {
      return c.json({ error: "openid required" }, 400);
    }
    try {
      const operator = await deps.findOperatorByOpenid(openid);
      if (!operator || !operator.active) {
        return c.json({ error: "operator not provisioned" }, 401);
      }
      const token = await issueToken(
        { operatorId: operator.id, sellerId: operator.sellerId, role: operator.role },
        jwtSecret,
      );
      return c.json({
        token,
        operator: { id: operator.id, sellerId: operator.sellerId, role: operator.role },
      });
    } catch {
      return c.json({ error: "dev-login failed" }, 502);
    }
  });

  return app;
}
