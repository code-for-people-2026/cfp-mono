import { Hono } from "hono";

/** Liveness probe (no DB/cms touch) — for deploy smoke tests + the FE reachability check. */
export function healthRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.json({ status: "ok" }));
  return app;
}
