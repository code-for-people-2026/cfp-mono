import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";

const ORIG = process.env.JWT_SECRET;
const ORIG_RELEASE_SHA = process.env.RELEASE_SHA;
afterEach(() => {
  process.env.JWT_SECRET = ORIG;
  if (ORIG_RELEASE_SHA === undefined) delete process.env.RELEASE_SHA;
  else process.env.RELEASE_SHA = ORIG_RELEASE_SHA;
});

describe("createApp", () => {
  it("throws if JWT_SECRET is missing (fail-closed at composition)", () => {
    delete process.env.JWT_SECRET;
    expect(() => createApp()).toThrow(/JWT_SECRET/);
  });

  it("GET / returns the health probe", async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.RELEASE_SHA = "release-a";
    const res = await createApp().request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", releaseSha: "release-a" });

    delete process.env.RELEASE_SHA;
    expect(await (await createApp().request("/")).json()).toEqual({ status: "ok", releaseSha: "unknown" });
  });
});
