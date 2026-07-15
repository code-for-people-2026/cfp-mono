import { Hono } from "hono";

/** Liveness probe (no DB/cms touch) — for deploy smoke tests + the FE reachability check. */
export function healthRoutes(releaseSha: string) {
  const app = new Hono();
  app.get("/", (c) => c.json({ status: "ok", releaseSha }));
  return app;
}
