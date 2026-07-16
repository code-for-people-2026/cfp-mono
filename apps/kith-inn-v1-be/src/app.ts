import { cors } from "hono/cors";
import { Hono } from "hono";
import type { AppVars } from "./middleware/operatorAuth";
import { authRoutes, customerAuthRoutes } from "./routes/auth";
import { bookingBatchesRoutes, publicBookingBatchesRoutes } from "./routes/bookingBatches";
import { customerOrderRoutes } from "./routes/customerOrders";
import { customerProfileRoutes } from "./routes/customerProfiles";
import { healthRoutes } from "./routes/health";
import { mealSlotsRoutes } from "./routes/mealSlots";
import { offeringsRoutes } from "./routes/offerings";
import { customerProfilesRoutes, ordersRoutes } from "./routes/orders";

export function createApp(options: { jwtSecret?: string } = {}) {
  const jwtSecret = options.jwtSecret ?? process.env.KITH_INN_V1_JWT_SECRET;
  if (!jwtSecret) throw new Error("KITH_INN_V1_JWT_SECRET is required");
  const app = new Hono<AppVars>();
  app.use("*", cors({ allowHeaders: ["Content-Type", "Authorization"] }));
  app.route("/health", healthRoutes());
  app.route("/auth/operator", authRoutes(jwtSecret));
  app.route("/auth/customer", customerAuthRoutes(jwtSecret));
  app.route("/public/booking-batches", publicBookingBatchesRoutes(jwtSecret));
  app.route("/customer/profiles", customerProfileRoutes(jwtSecret));
  app.route("/customer/reservations", customerOrderRoutes(jwtSecret));
  app.route("/merchant/offerings", offeringsRoutes(jwtSecret));
  app.route("/merchant/meal-slots", mealSlotsRoutes(jwtSecret));
  app.route("/merchant/booking-batches", bookingBatchesRoutes(jwtSecret));
  app.route("/merchant/customer-profiles", customerProfilesRoutes(jwtSecret));
  app.route("/merchant/orders", ordersRoutes(jwtSecret));
  return app;
}

export type App = ReturnType<typeof createApp>;
