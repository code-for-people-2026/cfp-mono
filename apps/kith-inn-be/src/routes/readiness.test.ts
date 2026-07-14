import { describe, expect, it, vi } from "vitest";
import { readinessRoutes } from "./readiness";

const requestReady = (fetchImpl: typeof fetch) =>
  readinessRoutes({ fetch: fetchImpl, cmsBaseUrl: "http://cms:3304", internalToken: "internal-value" }).request("/");

describe("GET /ready", () => {
  it("passes only after the authenticated CMS readiness probe succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const response = await requestReady(fetchMock as typeof fetch);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "kith-inn-be" });
    expect(fetchMock).toHaveBeenCalledWith("http://cms:3304/api/ready", {
      headers: { "x-internal-token": "internal-value" },
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    ["CMS reports its database unavailable", vi.fn().mockResolvedValue(new Response("database details", { status: 503 }))],
    ["CMS cannot be reached", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED secret"))],
  ])("returns a stable, redacted 503 when %s", async (_label, fetchMock) => {
    const response = await requestReady(fetchMock as typeof fetch);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, service: "kith-inn-be", category: "cms_unavailable" });
  });
});
