import type {
  BookingBatch,
  BookingBatchDetailResponse,
  BookingBatchListResponse,
  BookingBatchMutationResponse,
  BookingBatchTargetedCreate,
  BookingShareTarget,
  BulkMealSlotBookingStatusResult,
  MealSlot,
  MealSlotTarget,
  MealSlotBookingConfig,
  ServiceClosure
} from "@cfp/kith-inn-v1-shared";

const sameId = (left: string | number, right: string | number) => String(left) === String(right);
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BookingConfigContext = {
  weekStart: string;
  target: MealSlotTarget | null;
  source?: "home";
};

export type BookingReturnMode = "navigate-to" | "redirect-to" | "navigate-back";
export type BookingBatchLiveSummary = {
  dateText: string;
  slotCountText: string;
  priceText: string;
  deadlineLines: string[];
};

export type BookingWriteGuard = {
  run: (write: () => Promise<void>) => Promise<boolean>;
};

export function createBookingWriteGuard(): BookingWriteGuard {
  let active = false;
  return {
    async run(write) {
      if (active) return false;
      active = true;
      try {
        await write();
        return true;
      } finally {
        active = false;
      }
    }
  };
}

export const BOOKING_SHARE_FALLBACK = {
  title: "街坊味预订",
  path: "/pages/merchant/batches/index"
};

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
  return { weekStart, target, ...(params.source === "home" ? { source: "home" as const } : {}) };
}

export function bookingConfigUrl(weekStart: string, target?: MealSlotTarget, source?: "home"): string {
  const base = `/pages/merchant/batches/index?weekStart=${encodeURIComponent(weekStart)}`;
  const targetUrl = target
    ? `${base}&date=${encodeURIComponent(target.date)}&occasion=${encodeURIComponent(target.occasion)}`
    : base;
  return source === "home" ? `${targetUrl}&source=home` : targetUrl;
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

export function bookingWeekStart(value: string): string | null {
  const date = calendarDate(value);
  if (date === null) return null;
  const instant = new Date(`${date}T00:00:00.000Z`);
  const day = instant.getUTCDay();
  instant.setUTCDate(instant.getUTCDate() - (day === 0 ? 6 : day - 1));
  return instant.toISOString().slice(0, 10);
}

export function bookingWeekDates(weekStart: string): string[] {
  if (bookingWeekStart(weekStart) !== weekStart) return [];
  const instant = new Date(`${weekStart}T00:00:00.000Z`);
  return Array.from({ length: 5 }, (_, offset) => {
    const date = new Date(instant);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}

export function toggleOperationalSelection(
  selected: Array<string | number>,
  id: string | number,
  limit = 20
): { selected: Array<string | number>; limitReached: boolean } {
  if (selected.some((item) => sameId(item, id))) {
    return { selected: selected.filter((item) => !sameId(item, id)), limitReached: false };
  }
  return selected.length >= limit
    ? { selected, limitReached: true }
    : { selected: [...selected, id], limitReached: false };
}

export function selectableBookingSlots(slots: MealSlot[], now: string): MealSlot[] {
  return slots.filter((slot) => slot.orderStatus === "open" && slot.orderDeadline !== null &&
    Date.parse(slot.orderDeadline) > Date.parse(now));
}

export function bookingShareSelection(
  target: BookingShareTarget,
  slots: MealSlot[],
  now: string
): BookingBatchTargetedCreate | null {
  const matching = selectableBookingSlots(slots, now).filter((slot) => slot.date === target.date &&
    (target.kind === "day" || slot.occasion === target.occasion));
  if (matching.length === 0 || (target.kind === "meal" && matching.length !== 1)) return null;
  return { target, mealSlotIds: matching.map(({ id }) => id) };
}

export function bookingShareTargetText(target: BookingShareTarget | null | undefined): string {
  if (!target) return "历史分享入口";
  return target.kind === "day"
    ? `${target.date} 当天`
    : `${target.date} ${target.occasion === "lunch" ? "午餐" : "晚餐"}`;
}

export function bookingBatchStatusText(status: BookingBatch["status"]): string {
  return status === "open" ? "开放中" : status === "closed" ? "已关闭" : "已归档";
}

export function bookingSlotLiveStatusText(
  slot: Pick<MealSlot, "orderStatus" | "orderDeadline">,
  now: string
): string {
  if (slot.orderStatus === "closed") return "已停止";
  if (slot.orderStatus === "draft") return "未开放";
  return slot.orderDeadline !== null && Date.parse(slot.orderDeadline) > Date.parse(now)
    ? "预订中"
    : "已截止";
}

export function bookingDetailRefreshDelay(
  slots: Array<Pick<MealSlot, "orderStatus" | "orderDeadline">>,
  now: string
): number | null {
  const nowTime = Date.parse(now);
  const nextDeadline = slots.flatMap((slot) => slot.orderStatus === "open" && slot.orderDeadline !== null
    ? [Date.parse(slot.orderDeadline)]
    : []).filter((deadline) => deadline > nowTime).sort((left, right) => left - right)[0];
  return nextDeadline === undefined ? null : Math.min(nextDeadline - nowTime + 1, 2_147_483_647);
}

export function sortBookingBatchHistory(
  entries: BookingBatchListResponse["docs"]
): BookingBatchListResponse["docs"] {
  const rank: Record<BookingBatch["status"], number> = { open: 0, closed: 1, archived: 2 };
  return entries.map((entry, index) => ({ entry, index })).sort((left, right) =>
    rank[left.entry.doc.status] - rank[right.entry.doc.status] || left.index - right.index).map(({ entry }) => entry);
}

export function summarizeBookingBatch(slots: BookingBatchDetailResponse["slots"]): BookingBatchLiveSummary {
  const dates = [...new Set(slots.map(({ date }) => date))].sort();
  const prices = slots.flatMap(({ priceCents }) => priceCents === null ? [] : [priceCents]);
  const pricesComplete = prices.length === slots.length;
  const minimum = pricesComplete ? Math.min(...prices) : null;
  const allSamePrice = pricesComplete && new Set(prices).size === 1;
  return {
    dateText: dates.length === 1 ? dates[0]! : `${dates[0]} 至 ${dates.at(-1)}`,
    slotCountText: `${slots.length} 个餐次`,
    priceText: minimum === null ? "价格待确认" : `¥${(minimum / 100).toFixed(2).replace(/\.00$/, "")}/份${allSamePrice ? "" : "起"}`,
    deadlineLines: slots.map((slot) => `${slot.date} ${slot.occasion === "lunch" ? "午餐" : "晚餐"} ${
      slot.orderDeadline === null ? "未设置截止" : `${bookingDeadlineInputValue(slot.orderDeadline).slice(11)} 截止`}`)
  };
}

export function bookingBatchSharePayload(dataset: unknown): { title: string; path: string } {
  if (typeof dataset !== "object" || dataset === null) return BOOKING_SHARE_FALLBACK;
  const { title, path } = dataset as { title?: unknown; path?: unknown };
  return typeof title === "string" && title.trim() !== "" && typeof path === "string" &&
    path.startsWith("/pages/booking/index?batch=") ? { title, path } : BOOKING_SHARE_FALLBACK;
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

export function applyBulkBookingStatus(
  slots: MealSlot[],
  results: BulkMealSlotBookingStatusResult[]
): { slots: MealSlot[]; failedIds: Array<string | number>; failures: Record<string, string> } {
  const updated = new Map(results.flatMap((result) => result.status === "updated"
    ? [[String(result.id), result.doc] as const]
    : []));
  const failed = results.filter((result) => result.status === "failed");
  return {
    slots: slots.map((slot) => updated.get(String(slot.id)) ?? slot),
    failedIds: failed.map(({ id }) => id),
    failures: Object.fromEntries(failed.map(({ id, message }) => [String(id), message]))
  };
}

export function effectiveServiceClosure(
  closures: ServiceClosure[],
  date: string,
  occasion: MealSlot["occasion"]
): ServiceClosure | null {
  return closures.find((closure) => closure.date === date && closure.occasion === null) ??
    closures.find((closure) => closure.date === date && closure.occasion === occasion) ?? null;
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
