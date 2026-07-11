import type {
  BookingBatch,
  BookingBatchMutationResponse,
  MealSlot,
  MealSlotBookingConfig
} from "@cfp/kith-inn-v1-shared";

const sameId = (left: string | number, right: string | number) => String(left) === String(right);
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function selectableBookingSlots(slots: MealSlot[], now: string): MealSlot[] {
  return slots.filter((slot) => slot.orderStatus === "open" && slot.orderDeadline !== null &&
    Date.parse(slot.orderDeadline) > Date.parse(now));
}

export function toggleBookingSlot(
  selected: Array<string | number>,
  slot: MealSlot,
  now: string
): Array<string | number> {
  if (!selectableBookingSlots([slot], now).length) return selected;
  return selected.some((id) => sameId(id, slot.id))
    ? selected.filter((id) => !sameId(id, slot.id))
    : [...selected, slot.id];
}

export function buildBookingConfig(input: {
  priceYuan: string;
  orderDeadline: string;
  orderStatus: MealSlot["orderStatus"];
}): MealSlotBookingConfig | null {
  const price = input.priceYuan.trim();
  const deadline = input.orderDeadline.trim();
  if (price && !/^\d+(?:\.\d{1,2})?$/.test(price)) return null;
  const deadlineInstant = deadline ? Date.parse(`${deadline}:00.000+08:00`) : null;
  if (deadlineInstant !== null && Number.isNaN(deadlineInstant)) return null;
  const priceCents = price ? Math.round(Number(price) * 100) : null;
  return {
    priceCents,
    orderDeadline: deadlineInstant === null ? null : new Date(deadlineInstant).toISOString(),
    orderStatus: input.orderStatus
  };
}

export function bookingDeadlineInputValue(value: string | null): string {
  return value === null ? "" : new Date(Date.parse(value) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 16);
}

export function copyBookingBatchPath(
  share: BookingBatchMutationResponse["share"],
  setClipboardData: (options: { data: string }) => Promise<unknown>
): Promise<unknown> {
  return setClipboardData({ data: share.path });
}

export function batchCloseText(batch: BookingBatch): string {
  return batch.status === "open"
    ? "关闭批次只会停用此分享入口，不会关闭其中餐次。确认关闭？"
    : "该批次已关闭";
}
