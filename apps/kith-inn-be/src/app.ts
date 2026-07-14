import { cors } from "hono/cors";
import { Hono } from "hono";
import { assertKithInnProductionEnv } from "./config/env";
import type { AppVars } from "./middleware/sellerAuth";
import { authRoutes } from "./routes/auth";
import { chatRoutes } from "./routes/chat";
import { deliveryRoutes } from "./routes/delivery";
import { healthRoutes } from "./routes/health";
import { menuRoutes } from "./routes/menu";
import { offeringsRoutes } from "./routes/offerings";
import { orderRoutes } from "./routes/orders";
import { readinessRoutes } from "./routes/readiness";

/**
 * Compose the Hono app (no server start — kept pure so tests drive it via
 * `app.request()`). JWT_SECRET is required at composition time; a missing secret
 * throws rather than silently issuing tokens under "". CORS is open for dev (the
 * H5 FE runs on a different port); production uses a proper domain behind Nginx.
 */
export function createApp() {
  assertKithInnProductionEnv();
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error("JWT_SECRET is required");
  const app = new Hono<AppVars>();
  app.use("*", cors());
  app.route("/", healthRoutes());
  app.route("/ready", readinessRoutes({
    fetch,
    cmsBaseUrl: process.env.CMS_BASE_URL ?? "",
    internalToken: process.env.CMS_INTERNAL_TOKEN ?? "",
  }));
  app.route("/auth", authRoutes(jwtSecret));
  app.route("/offerings", offeringsRoutes(jwtSecret));
  app.route("/orders", orderRoutes(jwtSecret));
  app.route("/menu", menuRoutes(jwtSecret));
  app.route("/delivery", deliveryRoutes(jwtSecret));
  app.route("/chat", chatRoutes(jwtSecret));
  return app;
}

export type App = ReturnType<typeof createApp>;
