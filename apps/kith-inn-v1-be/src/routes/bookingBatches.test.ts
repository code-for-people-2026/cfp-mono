import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BookingBatch,
  CmsBookingBatchCreate,
  MealSlot
} from "@cfp/kith-inn-v1-shared";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { CmsBookingBatchError } from "../lib/cms/bookingBatches";
import { CmsMealSlotError } from "../lib/cms/mealSlots";
import { bookingBatchesRoutes, type BookingBatchesDeps } from "./bookingBatches";

const SECRET = "v1-secret";
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const NOW = "2026-07-10T01:00:00.000Z";
const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});
const UUIDS = [
  "72b8b5fc-84d2-4c70-a35b-0a42742fcd11",
  "10a6c650-d190-4a32-baa3-b89a0679d90f"
];
const slot = (overrides: Partial<MealSlot> = {}): MealSlot => ({
  id: 11,
  sellerId: 7,
  date: "2026-07-13",
  occasion: "lunch",
  menuItems: Array.from({ length: 5 }, (_, index) => ({
    offeringId: index + 1,
    nameSnapshot: `菜${index + 1}`,
    mainIngredientSnapshot: null,
    categorySnapshot: index < 2 ? "meat" : index < 4 ? "veg" : "soup"
  })),
  orderStatus: "open",
  orderDeadline: "2026-07-12T01:00:00.000Z",
  priceCents: null,
  generatedAt: NOW,
  ...overrides
});
const batch = (overrides: Partial<BookingBatch> = {}): BookingBatch => ({
  id: 31,
  sellerId: 7,
  publicId: UUIDS[0]!,
  title: "2026-07-13 午餐预订",
  status: "open",
  mealSlotIds: [11],
  createdById: 1,
  ...overrides
});

function deps(overrides: Partial<BookingBatchesDeps> = {}): BookingBatchesDeps {
  let uuidIndex = 0;
  return {
    listBookingBatches: vi.fn(async () => []),
    createBookingBatch: vi.fn(async (_token: string, input: CmsBookingBatchCreate) => batch({
      publicId: input.publicId,
      title: input.title,
      mealSlotIds: input.mealSlotIds,
      createdById: input.createdById
    })),
    updateBookingBatch: vi.fn(async (_token, id) => batch({ id, status: "closed" })),
    getMealSlot: vi.fn(async (_token: string, id: string | number) => slot({ id })),
    now: () => NOW,
    uuid: () => UUIDS[uuidIndex++]!,
    ...overrides
  };
}

function request(app: ReturnType<typeof bookingBatchesRoutes>, path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
  });
}

describe("merchant booking-batch list/create", () => {
  it("lists with derived share data and validates status/auth", async () => {
    const listBookingBatches = vi.fn(async () => [batch()]);
    const app = bookingBatchesRoutes(SECRET, deps({ listBookingBatches }));
    const response = await request(app, "/?status=open");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ docs: [{
      doc: batch(),
      share: { title: batch().title, path: `/pages/booking/index?batch=${UUIDS[0]}` }
    }] });
    expect(listBookingBatches).toHaveBeenCalledWith(token, "open");
    expect((await request(app, "/?status=bad")).status).toBe(400);
    expect((await app.request("/")).status).toBe(401);
  });

  it("deduplicates slots, derives the title and stamps operator/UUID", async () => {
    const injected = deps();
    const response = await request(bookingBatchesRoutes(SECRET, injected), "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotIds: [11, 11] })
    });
    expect(response.status).toBe(201);
    expect(injected.getMealSlot).toHaveBeenCalledOnce();
    expect(injected.createBookingBatch).toHaveBeenCalledWith(token, {
      publicId: UUIDS[0],
      title: "2026-07-13 午餐预订",
      status: "open",
      mealSlotIds: [11],
      createdById: 1
    });
  });

  it("rejects invalid/unavailable slots before writes", async () => {
    for (const unavailable of [slot({ orderStatus: "draft" }), slot({ orderDeadline: null })]) {
      const injected = deps({ getMealSlot: vi.fn(async () => unavailable) });
      const response = await request(bookingBatchesRoutes(SECRET, injected), "/", {
        method: "POST",
        body: JSON.stringify({ mealSlotIds: [11] })
      });
      expect(response.status).toBe(409);
      expect(injected.createBookingBatch).not.toHaveBeenCalled();
    }
    const missing = deps({ getMealSlot: vi.fn(async () => { throw new CmsMealSlotError(404, "not-found", "不存在"); }) });
    const response = await request(bookingBatchesRoutes(SECRET, missing), "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotIds: [99] })
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "meal-slot-not-found" });
  });

  it("retries UUID conflicts finitely and validates the request", async () => {
    const createBookingBatch = vi.fn()
      .mockRejectedValueOnce(new CmsBookingBatchError(409, "booking-batch-conflict", "冲突"))
      .mockImplementation(async (_token: string, input: CmsBookingBatchCreate) => batch({ publicId: input.publicId }));
    const app = bookingBatchesRoutes(SECRET, deps({ createBookingBatch }));
    const response = await request(app, "/", {
      method: "POST",
      body: JSON.stringify({ title: " 自定义 ", mealSlotIds: [11] })
    });
    expect(response.status).toBe(201);
    expect(createBookingBatch).toHaveBeenNthCalledWith(2, token, expect.objectContaining({
      publicId: UUIDS[1],
      title: "自定义"
    }));
    expect((await request(app, "/", { method: "POST", body: "{" })).status).toBe(400);
    expect((await request(app, "/", { method: "POST", body: JSON.stringify({ mealSlotIds: [] }) })).status).toBe(422);

    const conflicts = deps({
      createBookingBatch: vi.fn(async () => {
        throw new CmsBookingBatchError(409, "booking-batch-conflict", "冲突");
      }),
      uuid: () => UUIDS[0]!
    });
    expect((await request(bookingBatchesRoutes(SECRET, conflicts), "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotIds: [11] })
    })).status).toBe(409);
    expect(conflicts.createBookingBatch).toHaveBeenCalledTimes(3);

    const failed = deps({ createBookingBatch: vi.fn(async () => { throw new Error("offline"); }) });
    expect((await request(bookingBatchesRoutes(SECRET, failed), "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotIds: [11] })
    })).status).toBe(502);
  });
});

describe("merchant booking-batch close", () => {
  it("closes open batches and returns closed batches idempotently", async () => {
    const updateBookingBatch = vi.fn(async () => batch({ status: "closed" }));
    const app = bookingBatchesRoutes(SECRET, deps({
      listBookingBatches: vi.fn(async () => [batch()]),
      updateBookingBatch
    }));
    expect((await request(app, "/31", { method: "PATCH", body: JSON.stringify({ status: "closed" }) })).status).toBe(200);
    expect(updateBookingBatch).toHaveBeenCalledWith(token, "31", { status: "closed" });

    const idempotent = deps({ listBookingBatches: vi.fn(async () => [batch({ status: "closed" })]) });
    expect((await request(bookingBatchesRoutes(SECRET, idempotent), "/31", {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" })
    })).status).toBe(200);
    expect(idempotent.updateBookingBatch).not.toHaveBeenCalled();
  });

  it("rejects missing/archived batches, invalid bodies and dependency errors", async () => {
    const missing = bookingBatchesRoutes(SECRET, deps());
    expect((await request(missing, "/99", { method: "PATCH", body: JSON.stringify({ status: "closed" }) })).status)
      .toBe(404);
    const archived = bookingBatchesRoutes(SECRET, deps({
      listBookingBatches: vi.fn(async () => [batch({ status: "archived" })])
    }));
    expect((await request(archived, "/31", { method: "PATCH", body: JSON.stringify({ status: "closed" }) })).status)
      .toBe(409);
    expect((await request(missing, "/99", { method: "PATCH", body: "{" })).status).toBe(400);
    expect((await request(missing, "/99", { method: "PATCH", body: JSON.stringify({ status: "open" }) })).status)
      .toBe(422);
    const failed = bookingBatchesRoutes(SECRET, deps({
      listBookingBatches: vi.fn(async () => { throw new Error("offline"); })
    }));
    expect((await request(failed, "/31", { method: "PATCH", body: JSON.stringify({ status: "closed" }) })).status)
      .toBe(502);
  });

  it("preserves actionable list failures", async () => {
    for (const status of [401, 403, 404, 409, 422, 500]) {
      const app = bookingBatchesRoutes(SECRET, deps({
        listBookingBatches: vi.fn(async () => {
          throw new CmsBookingBatchError(status, `cms-${status}`, "失败");
        })
      }));
      const response = await request(app, "/");
      expect(response.status).toBe(status === 500 ? 502 : status);
    }
  });

  it("wires every real CMS dependency by default", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/meal-slots/11")) {
        return new Response(JSON.stringify({ doc: slot({ orderDeadline: "2099-07-12T01:00:00.000Z" }) }));
      }
      if (url.includes("/booking-batches?") || (url.endsWith("/booking-batches") && method === "GET")) {
        return new Response(JSON.stringify({ docs: [batch()] }));
      }
      if (url.endsWith("/booking-batches") && method === "POST") {
        const input = JSON.parse(String(init?.body)) as CmsBookingBatchCreate;
        return new Response(JSON.stringify({ doc: batch({ ...input }) }), { status: 201 });
      }
      if (url.endsWith("/booking-batches/31") && method === "PATCH") {
        return new Response(JSON.stringify({ doc: batch({ status: "closed" }) }));
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const app = bookingBatchesRoutes(SECRET);
    expect((await request(app, "/?status=open")).status).toBe(200);
    expect((await request(app, "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotIds: [11] })
    })).status).toBe(201);
    expect((await request(app, "/31", {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" })
    })).status).toBe(200);
  });
});
