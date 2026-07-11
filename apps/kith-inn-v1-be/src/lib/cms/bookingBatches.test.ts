import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookingBatch, CmsBookingBatchCreate } from "@cfp/kith-inn-v1-shared";
import {
  CmsBookingBatchError,
  createBookingBatch,
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
