import { serve } from "@hono/node-server";
import { createApp } from "./app";

// Auto-load .env (Node 24 native process.loadEnvFile — no new dep). tsx/node
// don't auto-load .env, so without this `pnpm dev` in a fresh shell lacks
// JWT_SECRET/CMS_BASE_URL etc. No-op if .env absent (prod — env from runtime).
try {
  process.loadEnvFile();
} catch {
  /* no .env in cwd — rely on runtime env */
}

// Boot shim (not unit-covered — exercised by running the server). The app logic
// + routes are tested via createApp().request() in vitest.
const port = Number(process.env.BE_PORT ?? 3310);
const app = createApp();
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`kith-inn-be listening on http://localhost:${info.port}`);
});
