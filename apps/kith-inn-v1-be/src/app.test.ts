import { afterEach, describe, expect, it } from "vitest";
import { assertV1ProductionEnv, createApp } from "./app";

const originalSecret = process.env.KITH_INN_V1_JWT_SECRET;
const originalRelease = process.env.RELEASE_SHA;
afterEach(() => {
  process.env.KITH_INN_V1_JWT_SECRET = originalSecret;
  process.env.RELEASE_SHA = originalRelease;
});

describe("createApp", () => {
  it("serves the v1 health endpoint", async () => {
    process.env.RELEASE_SHA = "a".repeat(40);
    const response = await createApp({ jwtSecret: "test-secret" }).request("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", releaseSha: "a".repeat(40) });
  });

  it("uses a development release marker outside a published image", async () => {
    delete process.env.RELEASE_SHA;
    const response = await createApp({ jwtSecret: "test-secret" }).request("/health");
    await expect(response.json()).resolves.toEqual({ status: "ok", releaseSha: "development" });
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

  it("rejects missing or placeholder production WeChat configuration", () => {
    const valid = {
      NODE_ENV: "production", CMS_BASE_URL: "http://cms:3304",
      KITH_INN_V1_JWT_SECRET: "jwt-production-value",
      KITH_INN_V1_INTERNAL_TOKEN: "internal-production-value",
      WX_APPID: "wx-production-appid", WX_SECRET: "wx-production-value",
    };
    expect(() => assertV1ProductionEnv(valid)).not.toThrow();
    expect(() => assertV1ProductionEnv({ ...valid, WX_SECRET: "change-me" })).toThrow(/WX_SECRET/);
    expect(() => assertV1ProductionEnv({ ...valid, WX_APPID: "" })).toThrow(/WX_APPID/);
  });
});
