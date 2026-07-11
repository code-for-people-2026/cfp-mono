import { expect, it, vi } from "vitest";
import type { BookingBatch, MealSlot } from "@cfp/kith-inn-v1-shared";
import {
  batchCloseText,
  bookingDeadlineInputValue,
  buildBookingConfig,
  copyBookingBatchPath,
  selectableBookingSlots,
  toggleBookingSlot
} from "./bookingBatches";

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
  generatedAt: "2026-07-10T01:00:00.000Z",
  ...overrides
});

it("selects only open unexpired slots and toggles stable ids", () => {
  const now = "2026-07-10T01:00:00.000Z";
  expect(selectableBookingSlots([
    slot(),
    slot({ id: 12, orderStatus: "draft" }),
    slot({ id: 13, orderDeadline: null }),
    slot({ id: 14, orderDeadline: now })
  ], now).map(({ id }) => id)).toEqual([11]);
  expect(toggleBookingSlot([], slot(), now)).toEqual([11]);
  expect(toggleBookingSlot([11], slot(), now)).toEqual([]);
  expect(toggleBookingSlot([], slot({ orderStatus: "closed" }), now)).toEqual([]);
});

it("parses yuan/deadline config without leaking invalid values", () => {
  expect(buildBookingConfig({ priceYuan: "28.50", orderDeadline: "2026-07-12T09:00", orderStatus: "open" }))
    .toEqual({ priceCents: 2850, orderDeadline: "2026-07-12T01:00:00.000Z", orderStatus: "open" });
  expect(buildBookingConfig({ priceYuan: "", orderDeadline: "", orderStatus: "draft" }))
    .toEqual({ priceCents: null, orderDeadline: null, orderStatus: "draft" });
  expect(buildBookingConfig({ priceYuan: "28", orderDeadline: "", orderStatus: "draft" }))
    .toEqual({ priceCents: 2800, orderDeadline: null, orderStatus: "draft" });
  expect(buildBookingConfig({ priceYuan: "28.555", orderDeadline: "bad", orderStatus: "open" })).toBeNull();
  expect(buildBookingConfig({ priceYuan: "28", orderDeadline: "bad", orderStatus: "open" })).toBeNull();
  expect(buildBookingConfig({ priceYuan: "-1", orderDeadline: "2026-07-12T09:00", orderStatus: "open" })).toBeNull();
  expect(buildBookingConfig({ priceYuan: "abc", orderDeadline: "", orderStatus: "draft" })).toBeNull();
  expect(bookingDeadlineInputValue("2026-07-12T01:00:00.000Z")).toBe("2026-07-12T09:00");
  expect(bookingDeadlineInputValue(null)).toBe("");
});

it("copies the deterministic public path and describes close impact", async () => {
  const batch: BookingBatch = {
    id: 31,
    sellerId: 7,
    publicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11",
    title: "午餐预订",
    status: "open",
    mealSlotIds: [11],
    createdById: 1
  };
  const setClipboardData = vi.fn(async () => undefined);
  await copyBookingBatchPath({ title: batch.title, path: `/pages/booking/index?batch=${batch.publicId}` }, setClipboardData);
  expect(setClipboardData).toHaveBeenCalledWith({ data: `/pages/booking/index?batch=${batch.publicId}` });
  expect(batchCloseText(batch)).toBe("关闭批次只会停用此分享入口，不会关闭其中餐次。确认关闭？");
  expect(batchCloseText({ ...batch, status: "closed" })).toBe("该批次已关闭");
});
