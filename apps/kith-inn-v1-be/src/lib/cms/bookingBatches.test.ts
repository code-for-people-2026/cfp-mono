import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookingBatch, CmsBookingBatchCreate, CmsCustomerBookingBatch } from "@cfp/kith-inn-v1-shared";
import {
  CmsBookingBatchError,
  createBookingBatch,
  getCustomerBookingBatch,
  listBookingBatches,
  updateBookingBatch
} from "./bookingBatches";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

const batch: BookingBatch = {
  id: 31,
  sellerId: 7,
  publicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11",
  title: "午餐预订",
  status: "open",
  mealSlotIds: [11],
  createdById: 1
};
const response = (body: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  }))
});

describe("CMS booking-batch client", () => {
  it("lists, creates and closes through the correct boundaries", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const listDeps = response({ docs: [batch] });
    await expect(listBookingBatches("jwt", "open", listDeps)).resolves.toEqual([batch]);
    expect(listDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/booking-batches?status=open",
      { headers: { "x-kith-inn-v1-operator": "jwt" } }
    );
    await expect(listBookingBatches("jwt", undefined, response({ docs: [] }))).resolves.toEqual([]);

    const input: CmsBookingBatchCreate = {
      publicId: batch.publicId,
      title: batch.title,
      status: "open",
      mealSlotIds: batch.mealSlotIds,
      createdById: batch.createdById
    };
    const createDeps = response({ doc: batch }, 201);
    await expect(createBookingBatch("jwt", input, createDeps)).resolves.toEqual(batch);
    expect(createDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/booking-batches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-kith-inn-v1-internal": "internal" }),
        body: JSON.stringify(input)
      })
    );

    const closed = { ...batch, status: "closed" as const };
    const updateDeps = response({ doc: closed });
    await expect(updateBookingBatch("jwt", 31, { status: "closed" }, updateDeps)).resolves.toEqual(closed);
    expect(updateDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/booking-batches/31",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "closed" }) })
    );
  });

  it("preserves errors and rejects malformed success payloads", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(listBookingBatches("jwt", undefined, response({ error: "forbidden", message: "失败" }, 403)))
      .rejects.toMatchObject({ status: 403, code: "forbidden", message: "失败" });
    await expect(listBookingBatches("jwt", undefined, response({ error: "conflict" }, 409)))
      .rejects.toMatchObject({ status: 409, code: "conflict", message: "预订批次服务失败" });
    const invalidJson = { fetch: vi.fn<typeof fetch>(async () => new Response("bad", { status: 500 })) };
    await expect(listBookingBatches("jwt", undefined, invalidJson))
      .rejects.toMatchObject({ code: "cms-booking-batch-failed" });
    for (const body of [null, {}, { docs: [{}] }]) {
      await expect(listBookingBatches("jwt", undefined, response(body)))
        .rejects.toBeInstanceOf(CmsBookingBatchError);
    }
    await expect(createBookingBatch("jwt", {
      publicId: batch.publicId,
      title: batch.title,
      status: "open",
      mealSlotIds: [11],
      createdById: 1
    }, response({}))).rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(createBookingBatch("jwt", {
      publicId: batch.publicId,
      title: batch.title,
      status: "open",
      mealSlotIds: [11],
      createdById: 1
    }, response(null))).rejects.toMatchObject({ code: "invalid-cms-response" });
  });

  it("uses global fetch and fails without CMS_BASE_URL", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetch = response({ docs: [] }).fetch;
    vi.stubGlobal("fetch", fetch);
    await expect(listBookingBatches("jwt")).resolves.toEqual([]);
    delete process.env.CMS_BASE_URL;
    await expect(listBookingBatches("jwt")).rejects.toThrow(/CMS_BASE_URL/);
  });
});

describe("CMS customer booking-batch client", () => {
  const customerBatch: CmsCustomerBookingBatch = {
    seller: { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" },
    batch,
    slots: [{
      id: 11,
      sellerId: 7,
      date: "2026-07-13",
      occasion: "lunch",
      menuItems: Array.from({ length: 5 }, (_, index) => ({
        offeringId: index + 1,
        nameSnapshot: `菜${index + 1}`,
        mainIngredientSnapshot: null,
        categorySnapshot: index < 2 ? "meat" as const : index < 4 ? "veg" as const : "soup" as const
      })),
      orderStatus: "open",
      orderDeadline: "2026-07-12T01:00:00.000Z",
      priceCents: null,
      generatedAt: "2026-07-10T01:00:00.000Z"
    }]
  };

  it("uses only the customer header and validates the snapshot", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    const deps = response(customerBatch);
    await expect(getCustomerBookingBatch("customer-jwt", batch.publicId, deps)).resolves.toEqual(customerBatch);
    expect(deps.fetch).toHaveBeenCalledWith(
      `http://cms.test/api/internal/kiv1/customer/booking-batches/${batch.publicId}`,
      { headers: { "x-kith-inn-v1-customer": "customer-jwt" } }
    );
  });

  it("preserves not-found and rejects malformed snapshots", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(getCustomerBookingBatch("jwt", batch.publicId, response({ error: "not-found" }, 404)))
      .rejects.toMatchObject({ status: 404, code: "not-found" });
    await expect(getCustomerBookingBatch("jwt", batch.publicId, response({ error: "forbidden", message: "失败" }, 403)))
      .rejects.toMatchObject({ status: 403, code: "forbidden", message: "失败" });
    await expect(getCustomerBookingBatch("jwt", batch.publicId, {
      fetch: vi.fn(async () => new Response("bad", { status: 500 }))
    })).rejects.toMatchObject({ code: "cms-booking-batch-failed" });
    await expect(getCustomerBookingBatch("jwt", batch.publicId, response({})))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
  });

  it("uses global fetch by default", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetch = response(customerBatch).fetch;
    vi.stubGlobal("fetch", fetch);
    await expect(getCustomerBookingBatch("jwt", batch.publicId)).resolves.toEqual(customerBatch);
  });
});
