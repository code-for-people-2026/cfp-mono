import type { MealSlot, Occasion } from "@cfp/kith-inn-v1-shared";
import { describe, expect, it } from "vitest";
import {
  buildMenuWeek,
  businessDate,
  editableTargets,
  formatWeekRange,
  initialWeekStart,
  missingTargets,
  nextOpenDeadline,
  shiftWeekStart,
  weekCta
} from "./menuWeek";

const item = (id: number) => ({
  offeringId: id,
  nameSnapshot: `菜品${id}`,
  mainIngredientSnapshot: null,
  categorySnapshot: (id === 5 ? "soup" : id < 3 ? "meat" : "veg") as "meat" | "veg" | "soup"
});

const slot = (
  id: number,
  date: string,
  occasion: Occasion,
  orderStatus: MealSlot["orderStatus"] = "draft",
  orderDeadline: string | null = null
): MealSlot => ({
  id,
  sellerId: 7,
  date,
  occasion,
  menuItems: [1, 2, 3, 4, 5].map(item),
  orderStatus,
  orderDeadline,
  priceCents: null,
  generatedAt: "2026-07-01T00:00:00.000Z"
});

const completeWeek = (status: MealSlot["orderStatus"] = "draft") =>
  ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"]
    .flatMap((date, day) => [
      slot(day * 2 + 1, date, "lunch", status),
      slot(day * 2 + 2, date, "dinner", status)
    ]);

describe("Shanghai work-week calendar", () => {
  it("uses Shanghai dates rather than the device timezone", () => {
    expect(businessDate(new Date("2026-07-23T15:59:59.999Z"))).toBe("2026-07-23");
    expect(businessDate(new Date("2026-07-23T16:00:00.000Z"))).toBe("2026-07-24");
  });

  it.each([
    ["2026-07-20T01:00:00.000Z", "2026-07-20"],
    ["2026-07-23T01:00:00.000Z", "2026-07-20"],
    ["2026-07-24T01:00:00.000Z", "2026-07-27"],
    ["2026-07-25T01:00:00.000Z", "2026-07-27"],
    ["2026-07-26T01:00:00.000Z", "2026-07-27"]
  ])("chooses the planning week for %s", (now, expected) => {
    expect(initialWeekStart(new Date(now))).toBe(expected);
  });

  it("builds five weekdays across months and resets selection when switching weeks", () => {
    const current = buildMenuWeek("2026-08-31", [], new Date("2026-09-01T01:00:00.000Z"));
    expect(current.days.map(({ date, weekday }) => [date, weekday])).toEqual([
      ["2026-08-31", "周一"],
      ["2026-09-01", "周二"],
      ["2026-09-02", "周三"],
      ["2026-09-03", "周四"],
      ["2026-09-04", "周五"]
    ]);
    expect(current.selectedDate).toBe("2026-09-01");
    expect(formatWeekRange(current.start)).toBe("8月31日－9月4日");
    expect(formatWeekRange("2026-07-20")).toBe("7月20日－24日");

    const previous = buildMenuWeek(
      shiftWeekStart(current.start, -1),
      [],
      new Date("2026-09-01T01:00:00.000Z"),
      current.selectedDate
    );
    expect(previous.start).toBe("2026-08-24");
    expect(previous.end).toBe("2026-08-28");
    expect(previous.selectedDate).toBe("2026-08-24");

    const future = buildMenuWeek("2026-09-07", [], new Date("2026-09-01T01:00:00.000Z"));
    expect(future.selectedDate).toBe("2026-09-07");
    expect(formatWeekRange("2026-12-28")).toBe("2026年12月28日－2027年1月1日");
  });

  it("keeps an explicit date only when it belongs to the displayed week", () => {
    const now = new Date("2026-07-22T01:00:00.000Z");
    expect(buildMenuWeek("2026-07-20", [], now).selectedDate).toBe("2026-07-22");
    expect(buildMenuWeek("2026-07-20", [], now, "2026-07-24").selectedDate).toBe("2026-07-24");
    expect(buildMenuWeek("2026-07-20", [], now, "2026-07-27").selectedDate).toBe("2026-07-22");
  });
});

describe("menu-week view model", () => {
  const now = new Date("2026-07-20T02:00:00.000Z");

  it("derives positions, display states, editability and independent day signals", () => {
    const week = buildMenuWeek("2026-07-20", [
      slot(5, "2026-07-22", "dinner", "draft", "2026-07-20T03:00:00.000Z"),
      slot(1, "2026-07-20", "lunch", "open", "2026-07-20T03:00:00.000Z"),
      slot(4, "2026-07-22", "lunch", "draft", "2026-07-20T02:00:00.000Z"),
      slot(2, "2026-07-21", "lunch", "draft", "2026-07-20T01:59:59.000Z"),
      slot(6, "2026-07-23", "lunch", "open", "2026-07-20T02:00:00.000Z"),
      slot(7, "2026-07-24", "lunch", "closed")
    ], now);

    expect(week.days[0]).toMatchObject({
      menuCompletion: "partial",
      bookingSignals: { hasOpen: true, hasDeadlinePassed: false, hasClosed: false },
      lunch: { status: "open", statusLabel: "预订中", editable: false },
      dinner: { status: "missing", statusLabel: "未排菜单", editable: false }
    });
    expect(week.days[1]?.lunch).toMatchObject({ status: "needs-config", statusLabel: "待设置", editable: true });
    expect(week.days[1]?.bookingSignals.hasDeadlinePassed).toBe(false);
    expect(week.days[2]).toMatchObject({
      menuCompletion: "complete",
      lunch: { status: "needs-config", statusLabel: "待设置", editable: true },
      dinner: { status: "ready-to-open", statusLabel: "待开放", editable: true }
    });
    expect(week.days[3]).toMatchObject({
      bookingSignals: { hasOpen: false, hasDeadlinePassed: true, hasClosed: false },
      lunch: { status: "deadline-passed", statusLabel: "已截止", editable: false }
    });
    expect(week.days[4]).toMatchObject({
      bookingSignals: { hasOpen: false, hasDeadlinePassed: false, hasClosed: true },
      lunch: { status: "closed", statusLabel: "已关闭", editable: false }
    });
  });

  it("returns stable missing and editable generation targets for unordered slots", () => {
    const week = buildMenuWeek("2026-07-20", [
      slot(2, "2026-07-20", "dinner", "open", "2026-07-20T03:00:00.000Z"),
      slot(3, "2026-07-21", "lunch", "draft"),
      slot(1, "2026-07-20", "lunch", "draft")
    ], now);
    expect(editableTargets(week)).toEqual([
      { date: "2026-07-20", occasion: "lunch" },
      { date: "2026-07-21", occasion: "lunch" }
    ]);
    expect(missingTargets(week).slice(0, 3)).toEqual([
      { date: "2026-07-21", occasion: "dinner" },
      { date: "2026-07-22", occasion: "lunch" },
      { date: "2026-07-22", occasion: "dinner" }
    ]);
    expect(missingTargets(week)).toHaveLength(7);
  });

  it("selects the dynamic primary CTA without letting booking state hide gaps", () => {
    expect(weekCta(buildMenuWeek("2026-07-20", [], now))).toEqual({
      kind: "generate-week",
      label: "生成本周午晚餐"
    });
    expect(weekCta(buildMenuWeek("2026-07-20", [
      slot(1, "2026-07-20", "lunch", "open", "2026-07-20T03:00:00.000Z")
    ], now))).toEqual({ kind: "fill-week", label: "补齐本周菜单" });
    expect(weekCta(buildMenuWeek("2026-07-20", completeWeek(), now))).toEqual({
      kind: "configure",
      label: "下一步：设置截止时间与开放预订"
    });
    expect(weekCta(buildMenuWeek("2026-07-20", completeWeek("closed"), now))).toEqual({
      kind: "view-bookings",
      label: "查看预订与分享"
    });
  });

  it("finds only the next future deadline of an open slot", () => {
    const week = buildMenuWeek("2026-07-20", [
      slot(1, "2026-07-20", "lunch", "open", "2026-07-20T03:00:00.000Z"),
      slot(2, "2026-07-20", "dinner", "open", "2026-07-20T02:30:00.000Z"),
      slot(3, "2026-07-21", "lunch", "open", "2026-07-20T01:00:00.000Z"),
      slot(4, "2026-07-21", "dinner", "draft", "2026-07-20T02:10:00.000Z")
    ], now);
    expect(nextOpenDeadline(week, now)).toBe(Date.parse("2026-07-20T02:30:00.000Z"));
    expect(nextOpenDeadline(buildMenuWeek("2026-07-20", [], now), now)).toBeNull();
  });
});
