import {
  bookingBatchCreateSchema,
  bookingBatchListQuerySchema,
  bookingBatchUpdateSchema
} from "@cfp/kith-inn-v1-shared/api";
import type {
  BookingBatch,
  BookingBatchUpdate,
  CmsBookingBatchCreate,
  CmsCustomerBookingBatch,
  MealSlot
} from "@cfp/kith-inn-v1-shared";
import { Hono, type Context } from "hono";
import {
  assertBatchSlotsAvailable,
  BookingAvailabilityError,
  bookingBatchShare,
  customerBookingBatchView,
  defaultBookingBatchTitle
} from "../domain/bookings/availability";
import {
  CmsBookingBatchError,
  createBookingBatch as createBookingBatchFn,
  getCustomerBookingBatch as getCustomerBookingBatchFn,
  listBookingBatches as listBookingBatchesFn,
  updateBookingBatch as updateBookingBatchFn
} from "../lib/cms/bookingBatches";
import {
  CmsMealSlotError,
  getMealSlot as getMealSlotFn
} from "../lib/cms/mealSlots";
import { operatorAuth, type AppVars } from "../middleware/operatorAuth";
import { customerAuth, type CustomerAppVars } from "../middleware/customerAuth";

export type BookingBatchesDeps = {
  listBookingBatches: (token: string, status?: BookingBatch["status"]) => Promise<BookingBatch[]>;
  createBookingBatch: (token: string, input: CmsBookingBatchCreate) => Promise<BookingBatch>;
  updateBookingBatch: (token: string, id: string | number, input: BookingBatchUpdate) => Promise<BookingBatch>;
  getMealSlot: (token: string, id: string | number) => Promise<MealSlot>;
  now: () => string;
  uuid: () => string;
};

const defaultDeps: BookingBatchesDeps = {
  listBookingBatches: (token, status) => listBookingBatchesFn(token, status),
  createBookingBatch: (token, input) => createBookingBatchFn(token, input),
  updateBookingBatch: (token, id, input) => updateBookingBatchFn(token, id, input),
  getMealSlot: (token, id) => getMealSlotFn(token, id),
  now: () => new Date().toISOString(),
  uuid: () => crypto.randomUUID()
};

async function bodyOf(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

function dependencyError(c: Context, error: unknown) {
  if (error instanceof CmsMealSlotError && error.status === 404) {
    return c.json({ error: "meal-slot-not-found", message: "餐次不存在" }, 404);
  }
  if (!(error instanceof CmsMealSlotError) && !(error instanceof CmsBookingBatchError)) {
    return c.json({ error: "cms-unavailable", message: "预订批次服务暂不可用" }, 502);
  }
  const status = ([401, 403, 404, 409, 422] as const).includes(error.status as 401)
    ? error.status as 401 | 403 | 404 | 409 | 422
    : 502;
  return c.json({ error: error.code, message: error.message }, status);
}

export function bookingBatchesRoutes(secret: string, deps: BookingBatchesDeps = defaultDeps) {
  const app = new Hono<AppVars>();
  app.use("*", operatorAuth(secret));

  app.get("/", async (c) => {
    const parsed = bookingBatchListQuerySchema.safeParse({ status: c.req.query("status") });
    if (!parsed.success) return c.json({ error: "invalid-booking-batch-query", message: "预订批次筛选无效" }, 400);
    try {
      const docs = await deps.listBookingBatches(c.get("operatorToken"), parsed.data.status);
      return c.json({ docs: docs.map((doc) => ({ doc, share: bookingBatchShare(doc) })) });
    } catch (error) {
      return dependencyError(c, error);
    }
  });

  app.post("/", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = bookingBatchCreateSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-booking-batch", message: "预订批次参数无效" }, 422);
    const token = c.get("operatorToken");
    try {
      const slots = await Promise.all(parsed.data.mealSlotIds.map((id) => deps.getMealSlot(token, id)));
      assertBatchSlotsAvailable(slots, deps.now());
      const base = {
        title: parsed.data.title ?? defaultBookingBatchTitle(slots),
        status: "open" as const,
        mealSlotIds: parsed.data.mealSlotIds,
        createdById: c.get("operatorId")
      };
      let lastConflict: CmsBookingBatchError | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const doc = await deps.createBookingBatch(token, { publicId: deps.uuid(), ...base });
          return c.json({ doc, share: bookingBatchShare(doc) }, 201);
        } catch (error) {
          if (!(error instanceof CmsBookingBatchError) || error.status !== 409) throw error;
          lastConflict = error;
        }
      }
      throw lastConflict;
    } catch (error) {
      if (error instanceof BookingAvailabilityError) {
        return c.json({ error: error.code, message: "所选餐次不可预订" }, error.status);
      }
      return dependencyError(c, error);
    }
  });

  app.patch("/:id", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = bookingBatchUpdateSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-booking-batch-update", message: "预订批次更新无效" }, 422);
    const token = c.get("operatorToken");
    try {
      const id = c.req.param("id");
      const doc = (await deps.listBookingBatches(token)).find((batch) => String(batch.id) === id);
      if (!doc) return c.json({ error: "booking-batch-not-found", message: "预订批次不存在" }, 404);
      if (doc.status === "archived") {
        return c.json({ error: "invalid-booking-batch-transition", message: "已归档批次不能关闭" }, 409);
      }
      const updated = doc.status === "closed" ? doc : await deps.updateBookingBatch(token, id, parsed.data);
      return c.json({ doc: updated, share: bookingBatchShare(updated) });
    } catch (error) {
      return dependencyError(c, error);
    }
  });

  return app;
}

export type PublicBookingBatchesDeps = {
  getCustomerBookingBatch: (token: string, publicId: string) => Promise<CmsCustomerBookingBatch>;
  now: () => string;
};

const defaultPublicDeps: PublicBookingBatchesDeps = {
  getCustomerBookingBatch: (token, publicId) => getCustomerBookingBatchFn(token, publicId),
  now: () => new Date().toISOString()
};

export function publicBookingBatchesRoutes(
  secret: string,
  deps: PublicBookingBatchesDeps = defaultPublicDeps
) {
  const app = new Hono<CustomerAppVars>();
  app.use("*", customerAuth(secret));
  app.get("/:publicId", async (c) => {
    try {
      const internal = await deps.getCustomerBookingBatch(c.get("customerToken"), c.req.param("publicId"));
      return c.json(customerBookingBatchView(internal, deps.now()));
    } catch (error) {
      if (error instanceof CmsBookingBatchError && error.status === 404) {
        return c.json({ error: "booking-batch-not-found", message: "预订入口不存在" }, 404);
      }
      if (error instanceof CmsBookingBatchError && error.status === 403) {
        return c.json({ error: error.code, message: error.message }, 403);
      }
      return c.json({ error: "cms-unavailable", message: "预订批次服务暂不可用" }, 502);
    }
  });
  return app;
}
