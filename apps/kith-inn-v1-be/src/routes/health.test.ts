import { afterEach, describe, expect, it, vi } from "vitest";
import { readinessRoutes } from "./health";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("v1 readiness", () => {
  it("probes the shared CMS through the configured container-network URL", async () => {
    process.env.CMS_BASE_URL = "http://kith-inn-cms:3304/";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    process.env.RELEASE_SHA = "a".repeat(40);
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, service: "cms" }));
    const response = await readinessRoutes({ fetch }).request("/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", releaseSha: "a".repeat(40) });
    expect(fetch).toHaveBeenCalledWith("http://kith-inn-cms:3304/api/ready", expect.objectContaining({
      headers: { "x-internal-token": "internal" },
      signal: expect.any(AbortSignal),
    }));
  });

  it("fails closed for missing config, rejected CMS auth and network errors", async () => {
    delete process.env.CMS_BASE_URL;
    delete process.env.KITH_INN_V1_INTERNAL_TOKEN;
    expect((await readinessRoutes().request("/")).status).toBe(503);

    process.env.CMS_BASE_URL = "http://cms:3304";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    expect((await readinessRoutes().request("/")).status).toBe(503);
    expect((await readinessRoutes({
      fetch: vi.fn().mockResolvedValue(Response.json({ ok: true, service: "not-cms" })),
    }).request("/")).status).toBe(503);
    expect((await readinessRoutes({
      fetch: vi.fn().mockRejectedValue(new Error("secret network detail")),
    }).request("/")).status).toBe(503);
  });
});
