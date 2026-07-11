import { expect, it } from "vitest";
import type { BookingBatch, MealSlot } from "@cfp/kith-inn-v1-shared";
import {
  assertBatchSlotsAvailable,
  bookingBatchShare,
  defaultBookingBatchTitle,
  nextBookingConfig
} from "./availability";

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

it("derives config, readable titles and a public-only path", () => {
  expect(nextBookingConfig(slot({ orderStatus: "draft" }), { priceCents: 2800 }, "2026-07-10T01:00:00.000Z"))
    .toEqual({ priceCents: 2800 });
  expect(defaultBookingBatchTitle([slot()])).toBe("2026-07-13 午餐预订");
  expect(defaultBookingBatchTitle([slot(), slot({ id: 12, occasion: "dinner" })])).toBe("2026-07-13 午晚餐预订");
  expect(defaultBookingBatchTitle([slot(), slot({ id: 12, date: "2026-07-15" })]))
    .toBe("2026-07-13 至 2026-07-15 预订");
  expect(defaultBookingBatchTitle([slot({ occasion: "dinner" })])).toBe("2026-07-13 晚餐预订");
  const batch: BookingBatch = {
    id: 31,
    sellerId: 7,
    publicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11",
    title: "一周预订",
    status: "open",
    mealSlotIds: [11],
    createdById: 1
  };
  expect(bookingBatchShare(batch)).toEqual({
    title: "一周预订",
    path: `/pages/booking/index?batch=${batch.publicId}`
  });
});

it("accepts only open, unexpired batch slots", () => {
  expect(() => assertBatchSlotsAvailable([slot()], "2026-07-10T01:00:00.000Z")).not.toThrow();
  expect(() => assertBatchSlotsAvailable([slot({ orderStatus: "draft" })], "2026-07-10T01:00:00.000Z"))
    .toThrow(/meal-slot-unavailable/);
  expect(() => assertBatchSlotsAvailable([slot({ orderDeadline: null })], "2026-07-10T01:00:00.000Z"))
    .toThrow(/meal-slot-unavailable/);
  expect(() => assertBatchSlotsAvailable([slot({ orderDeadline: "2026-07-10T01:00:00.000Z" })], "2026-07-10T01:00:00.000Z"))
    .toThrow(/meal-slot-unavailable/);
});
