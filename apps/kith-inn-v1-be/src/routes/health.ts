import { Hono } from "hono";

const releaseSha = () => process.env.RELEASE_SHA ?? "development";

export function healthRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.json({ status: "ok", releaseSha: releaseSha() }));
  return app;
}

export function readinessRoutes(deps: { fetch?: typeof fetch } = {}) {
  const app = new Hono();
  app.get("/", async (c) => {
    const cmsBaseUrl = process.env.CMS_BASE_URL?.replace(/\/+$/, "");
    const token = process.env.KITH_INN_V1_INTERNAL_TOKEN;
    if (!cmsBaseUrl || !token) {
      return c.json({ status: "unavailable", category: "cms_configuration" }, 503);
    }
    try {
      const response = await (deps.fetch ?? fetch)(`${cmsBaseUrl}/api/ready`, {
        headers: { "x-internal-token": token },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return c.json({ status: "unavailable", category: "cms_dependency" }, 503);
      const body = await response.json() as { ok?: unknown; service?: unknown } | null;
      if (body?.ok !== true || body.service !== "cms") {
        return c.json({ status: "unavailable", category: "cms_dependency" }, 503);
      }
      return c.json({ status: "ok", releaseSha: releaseSha() });
    } catch {
      return c.json({ status: "unavailable", category: "cms_dependency" }, 503);
    }
  });
  return app;
}
