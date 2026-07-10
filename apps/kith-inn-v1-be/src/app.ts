import { cors } from "hono/cors";
import { Hono } from "hono";
import type { AppVars } from "./middleware/operatorAuth";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { mealSlotsRoutes } from "./routes/mealSlots";
import { offeringsRoutes } from "./routes/offerings";

export function createApp(options: { jwtSecret?: string } = {}) {
  const jwtSecret = options.jwtSecret ?? process.env.KITH_INN_V1_JWT_SECRET;
  if (!jwtSecret) throw new Error("KITH_INN_V1_JWT_SECRET is required");
  const app = new Hono<AppVars>();
  app.use("*", cors({ allowHeaders: ["Content-Type", "Authorization"] }));
  app.route("/health", healthRoutes());
  app.route("/auth/operator", authRoutes(jwtSecret));
  app.route("/merchant/offerings", offeringsRoutes(jwtSecret));
  app.route("/merchant/meal-slots", mealSlotsRoutes(jwtSecret));
  return app;
}

export type App = ReturnType<typeof createApp>;
