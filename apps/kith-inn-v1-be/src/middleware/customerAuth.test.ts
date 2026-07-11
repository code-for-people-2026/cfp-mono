import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { issueCustomerToken, issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { customerAuth, type CustomerAppVars } from "./customerAuth";

const SECRET = "v1-secret";

function protectedApp() {
  const app = new Hono<CustomerAppVars>();
  app.use("*", customerAuth(SECRET));
  app.get("/", (c) => c.json({
    sellerId: c.get("sellerId"),
    openid: c.get("customerOpenid"),
    token: c.get("customerToken")
  }));
  return app;
}

describe("customerAuth", () => {
  it("attaches only verified customer claims", async () => {
    const token = await issueCustomerToken({ sellerId: 7, openid: "wx-customer" }, SECRET);
    const response = await protectedApp().request("/", { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sellerId: 7, openid: "wx-customer", token });
  });

  it("rejects missing, operator and expired tokens", async () => {
    const app = protectedApp();
    expect((await app.request("/")).status).toBe(401);
    const operator = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
    expect((await app.request("/", { headers: { Authorization: `Bearer ${operator}` } })).status).toBe(401);
    const expired = await issueCustomerToken({ sellerId: 7, openid: "wx" }, SECRET, 1);
    expect((await app.request("/", { headers: { Authorization: `Bearer ${expired}` } })).status).toBe(401);
  });
});
