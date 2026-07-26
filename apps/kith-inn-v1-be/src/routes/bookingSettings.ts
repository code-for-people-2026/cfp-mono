import type {
  SellerBookingSettings,
  SellerBookingSettingsUpdate,
  SellerSnapshot
} from "@cfp/kith-inn-v1-shared";
import { sellerBookingSettingsUpdateSchema } from "@cfp/kith-inn-v1-shared/api";
import { Hono } from "hono";
import {
  CmsSellerError,
  getSeller as getSellerFn,
  updateSellerBookingSettings as updateSettingsFn
} from "../lib/cms/seller";
import { operatorAuth, type AppVars } from "../middleware/operatorAuth";

export type BookingSettingsDeps = {
  getSeller: (token: string) => Promise<SellerSnapshot>;
  updateSettings: (token: string, input: SellerBookingSettingsUpdate) => Promise<SellerBookingSettings>;
};

const defaultDeps: BookingSettingsDeps = {
  getSeller: getSellerFn,
  updateSettings: updateSettingsFn
};

export function bookingSettingsRoutes(secret: string, deps: BookingSettingsDeps = defaultDeps) {
  const app = new Hono<AppVars>();
  app.use("*", operatorAuth(secret));

  const dependencyError = (error: unknown) => {
    if (!(error instanceof CmsSellerError)) {
      return { status: 502 as const, body: { error: "cms-unavailable", message: "商家服务暂不可用" } };
    }
    const status: 401 | 403 | 404 | 409 | 422 | 502 =
      ([401, 403, 404, 409, 422] as const).includes(error.status as 401)
      ? error.status as 401 | 403 | 404 | 409 | 422
      : 502;
    return { status, body: { error: error.code, message: error.message } };
  };

  app.get("/", async (c) => {
    try {
      const { defaultPriceCents } = await deps.getSeller(c.get("operatorToken"));
      return c.json({ defaultPriceCents });
    } catch (error) {
      const mapped = dependencyError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  app.patch("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    }
    const parsed = sellerBookingSettingsUpdateSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid-booking-settings", message: "默认价格无效" }, 422);
    try {
      return c.json(await deps.updateSettings(c.get("operatorToken"), parsed.data));
    } catch (error) {
      const mapped = dependencyError(error);
      return c.json(mapped.body, mapped.status);
    }
  });

  return app;
}
