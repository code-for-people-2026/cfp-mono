import { cors } from "hono/cors";
import { Hono } from "hono";
import type { AppVars } from "./middleware/sellerAuth";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { offeringsRoutes } from "./routes/offerings";
import { orderRoutes } from "./routes/orders";

/**
 * Compose the Hono app (no server start — kept pure so tests drive it via
 * `app.request()`). JWT_SECRET is required at composition time; a missing secret
 * throws rather than silently issuing tokens under "". CORS is open for dev (the
 * H5 FE runs on a different port); production uses a proper domain behind Nginx.
 */
export function createApp() {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error("JWT_SECRET is required");
  const app = new Hono<AppVars>();
  app.use("*", cors());
  app.route("/", healthRoutes());
  app.route("/auth", authRoutes(jwtSecret));
  app.route("/offerings", offeringsRoutes(jwtSecret));
  app.route("/orders", orderRoutes(jwtSecret));
  return app;
}

export type App = ReturnType<typeof createApp>;
