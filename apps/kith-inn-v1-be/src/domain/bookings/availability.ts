import type {
  BookingBatch,
  CmsCustomerBookingBatch,
  CustomerBookingBatchView,
  MealSlot,
  MealSlotBookingConfig
} from "@cfp/kith-inn-v1-shared";

export class BookingAvailabilityError extends Error {
  constructor(
    public readonly code: "invalid-meal-slot-transition" | "meal-slot-not-ready" | "meal-slot-unavailable",
    public readonly status: 409 | 422
  ) {
    super(code);
  }
}

export function nextBookingConfig(
  slot: MealSlot,
  input: MealSlotBookingConfig,
  now: string
): MealSlotBookingConfig {
  const nextStatus = input.orderStatus ?? slot.orderStatus;
  if (slot.orderStatus === "closed" && nextStatus !== "closed") {
    throw new BookingAvailabilityError("invalid-meal-slot-transition", 409);
  }
  if (slot.orderStatus === "open" && nextStatus === "draft") {
    throw new BookingAvailabilityError("invalid-meal-slot-transition", 409);
  }
  const deadline = input.orderDeadline === undefined ? slot.orderDeadline : input.orderDeadline;
  if (nextStatus === "open" && (
    slot.menuItems.length !== 5 || deadline === null || Date.parse(deadline) <= Date.parse(now)
  )) {
    throw new BookingAvailabilityError("meal-slot-not-ready", 422);
  }
  return input;
}

export function assertBatchSlotsAvailable(slots: MealSlot[], now: string): void {
  if (slots.some((slot) => slot.orderStatus !== "open" || slot.orderDeadline === null ||
    Date.parse(slot.orderDeadline) <= Date.parse(now))) {
    throw new BookingAvailabilityError("meal-slot-unavailable", 409);
  }
}

export function defaultBookingBatchTitle(slots: MealSlot[]): string {
  const dates = [...new Set(slots.map(({ date }) => date))].sort();
  if (dates.length > 1) return `${dates[0]} 至 ${dates.at(-1)} 预订`;
  const occasions = new Set(slots.map(({ occasion }) => occasion));
  const label = occasions.size === 2 ? "午晚餐" : occasions.has("lunch") ? "午餐" : "晚餐";
  return `${dates[0]} ${label}预订`;
}

export function bookingBatchShare(batch: BookingBatch) {
  return {
    title: batch.title,
    path: `/pages/booking/index?batch=${encodeURIComponent(batch.publicId)}`
  };
}

export function customerBookingBatchView(
  { seller, batch, slots }: CmsCustomerBookingBatch,
  now: string
): CustomerBookingBatchView {
  return {
    sellerName: seller.name,
    title: batch.title,
    status: batch.status,
    sharePath: bookingBatchShare(batch).path,
    slots: slots.map((slot) => {
      const unavailableReason = batch.status !== "open"
        ? "booking-batch-closed" as const
        : slot.orderStatus !== "open"
          ? "meal-slot-closed" as const
          : slot.orderDeadline === null || Date.parse(slot.orderDeadline) <= Date.parse(now)
            ? "order-deadline-passed" as const
            : null;
      return {
        date: slot.date,
        occasion: slot.occasion,
        menuItems: slot.menuItems,
        unitPriceCents: slot.priceCents ?? seller.defaultPriceCents,
        orderDeadline: slot.orderDeadline,
        canBook: unavailableReason === null,
        unavailableReason
      };
    })
  };
}
