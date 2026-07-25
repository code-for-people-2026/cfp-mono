import type {
  BookingBatch,
  BookingBatchMutationResponse,
  MealSlot,
  MealSlotTarget,
  MealSlotBookingConfig
} from "@cfp/kith-inn-v1-shared";

const sameId = (left: string | number, right: string | number) => String(left) === String(right);
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BookingConfigContext = {
  weekStart: string;
  target: MealSlotTarget | null;
};

export type BookingReturnMode = "navigate-to" | "redirect-to" | "navigate-back";

function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value ? value : null;
}

export function bookingConfigContext(params: Record<string, unknown>): BookingConfigContext | null {
  const weekStart = calendarDate(params.weekStart);
  if (weekStart === null || new Date(`${weekStart}T00:00:00.000Z`).getUTCDay() !== 1) return null;
  const date = calendarDate(params.date);
  const occasion = params.occasion;
  const offset = date === null
    ? -1
    : (Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${weekStart}T00:00:00.000Z`)) / DAY_MS;
  const target: MealSlotTarget | null = date !== null && (occasion === "lunch" || occasion === "dinner") &&
    offset >= 0 && offset <= 4
    ? { date, occasion }
    : null;
  return { weekStart, target };
}

export function bookingConfigUrl(weekStart: string, target?: MealSlotTarget): string {
  const base = `/pages/merchant/batches/index?weekStart=${encodeURIComponent(weekStart)}`;
  return target
    ? `${base}&date=${encodeURIComponent(target.date)}&occasion=${encodeURIComponent(target.occasion)}`
    : base;
}

export function bookingMenuUrl(context: BookingConfigContext): string {
  const base = `/pages/merchant/menu/index?weekStart=${encodeURIComponent(context.weekStart)}`;
  return context.target
    ? `${base}&date=${encodeURIComponent(context.target.date)}&occasion=${encodeURIComponent(context.target.occasion)}`
    : base;
}

export function bookingReturnMode(input: {
  hasContext: boolean;
  platform: string | undefined;
  pageCount: number;
}): BookingReturnMode {
  if (!input.hasContext) return "navigate-to";
  return input.platform === "h5" || input.pageCount <= 1 ? "redirect-to" : "navigate-back";
}

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
