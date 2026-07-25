import type { MealSlot, MealSlotTarget, Occasion } from "@cfp/kith-inn-v1-shared";

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五"] as const;
const OCCASIONS: Occasion[] = ["lunch", "dinner"];
const STATUS_LABELS = {
  missing: "未排菜单",
  "needs-config": "待设置",
  "ready-to-open": "待开放",
  open: "预订中",
  "deadline-passed": "已截止",
  closed: "已关闭"
} as const;

export type MealDisplayStatus =
  | "missing"
  | "needs-config"
  | "ready-to-open"
  | "open"
  | "deadline-passed"
  | "closed";

export type MealPosition = {
  date: string;
  occasion: Occasion;
  slot: MealSlot | null;
  status: MealDisplayStatus;
  statusLabel: (typeof STATUS_LABELS)[MealDisplayStatus];
  editable: boolean;
};

export type WorkDay = {
  date: string;
  weekday: (typeof WEEKDAYS)[number];
  lunch: MealPosition;
  dinner: MealPosition;
  menuCompletion: "empty" | "partial" | "complete";
  bookingSignals: {
    hasOpen: boolean;
    hasDeadlinePassed: boolean;
    hasClosed: boolean;
  };
};

export type WorkWeek = {
  start: string;
  end: string;
  days: WorkDay[];
  selectedDate: string;
};

export type WeekCta = {
  kind: "generate-week" | "fill-week" | "configure" | "view-bookings";
  label: string;
};

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: string, amount: number): string {
  return new Date(parseDate(value).getTime() + amount * DAY_MS).toISOString().slice(0, 10);
}

function mondayOf(value: string): string {
  const date = parseDate(value);
  return addDays(value, -((date.getUTCDay() + 6) % 7));
}

function targetKey(date: string, occasion: Occasion): string {
  return `${date}:${occasion}`;
}

function deadlinePassed(slot: MealSlot, now: Date): boolean {
  return slot.orderDeadline !== null && Date.parse(slot.orderDeadline) <= now.getTime();
}

function position(date: string, occasion: Occasion, slot: MealSlot | undefined, now: Date): MealPosition {
  if (!slot) {
    return { date, occasion, slot: null, status: "missing", statusLabel: STATUS_LABELS.missing, editable: false };
  }
  if (slot.orderStatus === "closed") {
    return { date, occasion, slot, status: "closed", statusLabel: STATUS_LABELS.closed, editable: false };
  }
  if (slot.orderStatus === "open") {
    const status = deadlinePassed(slot, now) ? "deadline-passed" : "open";
    return { date, occasion, slot, status, statusLabel: STATUS_LABELS[status], editable: false };
  }
  const status = slot.orderDeadline === null || deadlinePassed(slot, now) ? "needs-config" : "ready-to-open";
  return {
    date,
    occasion,
    slot,
    status,
    statusLabel: STATUS_LABELS[status],
    editable: true
  };
}

function defaultSelectedDate(start: string, now: Date): string {
  const today = businessDate(now);
  const dayIndex = (parseDate(today).getUTCDay() + 6) % 7;
  return mondayOf(today) === start && dayIndex < 5 ? today : start;
}

export function businessDate(now: Date): string {
  return new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function initialWeekStart(now: Date): string {
  const today = businessDate(now);
  const dayIndex = (parseDate(today).getUTCDay() + 6) % 7;
  return addDays(mondayOf(today), dayIndex >= 4 ? 7 : 0);
}

export function shiftWeekStart(start: string, amount: number): string {
  return addDays(start, amount * 7);
}

export function formatWeekRange(start: string): string {
  const end = addDays(start, 4);
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  if (startYear !== endYear) {
    return `${startYear}年${startMonth}月${startDay}日－${endYear}年${endMonth}月${endDay}日`;
  }
  if (startMonth !== endMonth) return `${startMonth}月${startDay}日－${endMonth}月${endDay}日`;
  return `${startMonth}月${startDay}日－${endDay}日`;
}

export function buildMenuWeek(
  start: string,
  slots: MealSlot[],
  now: Date,
  selectedDate?: string
): WorkWeek {
  const slotByTarget = new Map(slots.map((slot) => [targetKey(slot.date, slot.occasion), slot]));
  const days = WEEKDAYS.map((weekday, index): WorkDay => {
    const date = addDays(start, index);
    const lunch = position(date, "lunch", slotByTarget.get(targetKey(date, "lunch")), now);
    const dinner = position(date, "dinner", slotByTarget.get(targetKey(date, "dinner")), now);
    const existingCount = Number(lunch.slot !== null) + Number(dinner.slot !== null);
    const positions = [lunch, dinner];
    return {
      date,
      weekday,
      lunch,
      dinner,
      menuCompletion: existingCount === 0 ? "empty" : existingCount === 1 ? "partial" : "complete",
      bookingSignals: {
        hasOpen: positions.some(({ status }) => status === "open"),
        hasDeadlinePassed: positions.some(({ status }) => status === "deadline-passed"),
        hasClosed: positions.some(({ status }) => status === "closed")
      }
    };
  });
  const dates = new Set(days.map(({ date }) => date));
  return {
    start,
    end: addDays(start, 4),
    days,
    selectedDate: selectedDate && dates.has(selectedDate) ? selectedDate : defaultSelectedDate(start, now)
  };
}

function targetsMatching(week: WorkWeek, matches: (position: MealPosition) => boolean): MealSlotTarget[] {
  return week.days.flatMap((day) => OCCASIONS
    .map((occasion) => day[occasion])
    .filter(matches)
    .map(({ date, occasion }) => ({ date, occasion })));
}

export function missingTargets(week: WorkWeek): MealSlotTarget[] {
  return targetsMatching(week, ({ slot }) => slot === null);
}

export function editableTargets(week: WorkWeek): MealSlotTarget[] {
  return targetsMatching(week, ({ editable }) => editable);
}

export function weekCta(week: WorkWeek): WeekCta {
  const missingCount = missingTargets(week).length;
  if (missingCount === 10) return { kind: "generate-week", label: "生成本周午晚餐" };
  if (missingCount > 0) return { kind: "fill-week", label: "补齐本周菜单" };
  if (editableTargets(week).length > 0) {
    return { kind: "configure", label: "下一步：设置截止时间与开放预订" };
  }
  return { kind: "view-bookings", label: "查看预订与分享" };
}

export function nextOpenDeadline(week: WorkWeek, now: Date): number | null {
  const future = week.days.flatMap(({ lunch, dinner }) => [lunch, dinner])
    .flatMap(({ slot }) => slot?.orderStatus === "open" && slot.orderDeadline ? [Date.parse(slot.orderDeadline)] : [])
    .filter((deadline) => deadline > now.getTime());
  return future.length > 0 ? Math.min(...future) : null;
}
