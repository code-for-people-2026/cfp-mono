import { Hono } from "hono";

export function healthRoutes() {
  const app = new Hono();
  app.get("/", (c) => c.json({ status: "ok", releaseSha: process.env.RELEASE_SHA ?? "development" }));
  return app;
}
