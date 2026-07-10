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

  it("fails closed without the dedicated v1 JWT secret", () => {
    delete process.env.KITH_INN_V1_JWT_SECRET;
    expect(() => createApp()).toThrow(/KITH_INN_V1_JWT_SECRET/);
  });
});
