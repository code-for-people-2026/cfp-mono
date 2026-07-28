import type { MiddlewareHandler } from "hono";
import { verifyOperatorToken } from "@cfp/kith-inn-v1-shared/auth";

export type AppVars = {
  Variables: {
    operatorId: string | number;
    sellerId: string | number;
    operatorToken: string;
  };
};

export function operatorAuth(
  secret: string,
  previousSecret = process.env.KITH_INN_V1_PREVIOUS_JWT_SECRET
): MiddlewareHandler<AppVars> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized", message: "请先登录" }, 401);
    }
    const token = header.slice("Bearer ".length);
    const claims = await verifyOperatorToken(token, secret) ?? (
      previousSecret?.trim() && previousSecret !== secret
        ? await verifyOperatorToken(token, previousSecret)
        : null
    );
    if (!claims) return c.json({ error: "unauthorized", message: "登录已失效" }, 401);
    c.set("operatorId", claims.operatorId);
    c.set("sellerId", claims.sellerId);
    c.set("operatorToken", token);
    await next();
  };
}
