import type { MenuPlan, MenuSlot, Offering } from "@cfp/kith-inn-shared";
import { toMenuDish } from "./core";

const DAY_MS = 86_400_000;
const calendarTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const calendarDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/** 自动换菜只读目标相关范围：近 7 日与目标自然周的并集。 */
export function swapHistoryRange(targetDate: string): { from: string; to: string } {
  const target = calendarTime(targetDate);
  const monday = target - ((new Date(target).getUTCDay() + 6) % 7) * DAY_MS;
  return {
    from: calendarDate(Math.min(target - 7 * DAY_MS, monday)),
    to: calendarDate(monday + 6 * DAY_MS),
  };
}

/** CMS depth:1 plans → 评分历史；当前 plan 必须按身份排除。 */
export function swapHistoryFromPlans(plans: MenuPlan[], currentPlanId: string | number): MenuSlot[] {
  return plans
    .filter((plan) => String(plan.id) !== String(currentPlanId))
    .map((plan) => {
      const slot = plan.slot as { date: string; occasion: "lunch" | "dinner" };
      return {
        day: slot.date.split("T")[0]!,
        occasion: slot.occasion,
        dishes: (plan.offerings as Offering[]).map(toMenuDish),
      };
    });
}
