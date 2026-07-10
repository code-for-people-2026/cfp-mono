import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { issueOperatorSelectionToken, issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { operatorAuth, type AppVars } from "./operatorAuth";

const SECRET = "v1-secret";

function protectedApp() {
  const app = new Hono<AppVars>();
  app.use("*", operatorAuth(SECRET));
  app.get("/", (c) => c.json({
    operatorId: c.get("operatorId"),
    sellerId: c.get("sellerId"),
    token: c.get("operatorToken")
  }));
  return app;
}

describe("operatorAuth", () => {
  it("attaches verified operator claims and raw token", async () => {
    const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
    const response = await protectedApp().request("/", { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ operatorId: 1, sellerId: 7, token });
  });

  it("rejects missing/non-bearer/invalid/selection/expired tokens", async () => {
    const app = protectedApp();
    expect((await app.request("/")).status).toBe(401);
    expect((await app.request("/", { headers: { Authorization: "Basic x" } })).status).toBe(401);
    expect((await app.request("/", { headers: { Authorization: "Bearer bad" } })).status).toBe(401);
    const selection = await issueOperatorSelectionToken([
      { operatorId: 1, sellerId: 7 },
      { operatorId: 2, sellerId: 8 }
    ], SECRET);
    expect((await app.request("/", { headers: { Authorization: `Bearer ${selection}` } })).status).toBe(401);
    const expired = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET, 100);
    expect((await app.request("/", { headers: { Authorization: `Bearer ${expired}` } })).status).toBe(401);
  });
});
