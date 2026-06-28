import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";

const ORIG = process.env.JWT_SECRET;
afterEach(() => {
  process.env.JWT_SECRET = ORIG;
});

describe("createApp", () => {
  it("throws if JWT_SECRET is missing (fail-closed at composition)", () => {
    delete process.env.JWT_SECRET;
    expect(() => createApp()).toThrow(/JWT_SECRET/);
  });

  it("GET / returns the health probe", async () => {
    process.env.JWT_SECRET = "test-secret";
    const res = await createApp().request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
