import type { MiddlewareHandler } from "hono";
import { verifyCustomerToken } from "@cfp/kith-inn-v1-shared/auth";

export type CustomerAppVars = {
  Variables: {
    sellerId: string | number;
    customerOpenid: string;
    customerToken: string;
  };
};

export function customerAuth(secret: string): MiddlewareHandler<CustomerAppVars> {
  return async (c, next) => {
    const header = c.req.header("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return c.json({ error: "invalid-customer-session", message: "请从商家分享入口进入" }, 401);
    }
    const token = header.slice("Bearer ".length);
    const claims = await verifyCustomerToken(token, secret);
    if (!claims) return c.json({ error: "invalid-customer-session", message: "顾客会话已失效" }, 401);
    c.set("sellerId", claims.sellerId);
    c.set("customerOpenid", claims.openid);
    c.set("customerToken", token);
    await next();
  };
}
