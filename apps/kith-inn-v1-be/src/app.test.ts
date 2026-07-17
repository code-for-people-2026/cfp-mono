import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";

const originalSecret = process.env.KITH_INN_V1_JWT_SECRET;
afterEach(() => {
  process.env.KITH_INN_V1_JWT_SECRET = originalSecret;
});

describe("createApp", () => {
  it("serves the v1 health endpoint", async () => {
    const response = await createApp({ jwtSecret: "test-secret" }).request("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("allows the H5 JSON and bearer headers during CORS preflight", async () => {
    const response = await createApp({ jwtSecret: "test-secret" }).request("/auth/operator/dev-login", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:10087",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization"
      }
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type,Authorization");
  });

  it("mounts customer-owned profile and reservation routes behind customer auth", async () => {
    const app = createApp({ jwtSecret: "test-secret" });
    expect((await app.request("/customer/profiles")).status).toBe(401);
    expect((await app.request("/customer/profiles/21/deactivate", { method: "POST" })).status).toBe(401);
    expect((await app.request("/customer/reservations", { method: "POST" })).status).toBe(401);
    expect((await app.request("/customer/orders")).status).toBe(401);
    expect((await app.request("/merchant/jielong/preview", { method: "POST" })).status).toBe(401);
  });

  it("fails closed without the dedicated v1 JWT secret", () => {
    delete process.env.KITH_INN_V1_JWT_SECRET;
    expect(() => createApp()).toThrow(/KITH_INN_V1_JWT_SECRET/);
  });
});
