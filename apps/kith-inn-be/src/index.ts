import { serve } from "@hono/node-server";
import { createApp } from "./app";

// Boot shim (not unit-covered — exercised by running the server). The app logic
// + routes are tested via createApp().request() in vitest.
const port = Number(process.env.BE_PORT ?? 3310);
const app = createApp();
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`kith-inn-be listening on http://localhost:${info.port}`);
});
