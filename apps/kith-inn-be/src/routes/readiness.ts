import { Hono } from "hono";

type ReadinessDeps = { fetch: typeof fetch; cmsBaseUrl: string; internalToken: string };

export function readinessRoutes(deps: ReadinessDeps) {
  const app = new Hono();
  app.get("/", async (c) => {
    try {
      const response = await deps.fetch(`${deps.cmsBaseUrl.replace(/\/$/, "")}/api/ready`, {
        headers: { "x-internal-token": deps.internalToken },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("CMS not ready");
      const body = (await response.json()) as { ok?: unknown; service?: unknown } | null;
      if (body?.ok !== true || body?.service !== "cms") throw new Error("CMS readiness contract mismatch");
      return c.json({ ok: true, service: "kith-inn-be" });
    } catch {
      return c.json({ ok: false, service: "kith-inn-be", category: "cms_unavailable" }, 503);
    }
  });
  return app;
}
