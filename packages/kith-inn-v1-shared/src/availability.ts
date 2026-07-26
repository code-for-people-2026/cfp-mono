import type { MealSlot, MealSlotTarget, ServiceClosure } from "./types";

export type CustomerMealSlotPresentation = "hidden" | "bookable" | "deadline-passed" | "stopped";

export function customerMealSlotPresentation(
  slot: Pick<MealSlot, "orderStatus" | "orderDeadline">,
  now: string
): CustomerMealSlotPresentation {
  if (slot.orderStatus === "closed") return "stopped";
  if (slot.orderStatus !== "open" || slot.orderDeadline === null) return "hidden";
  return Date.parse(slot.orderDeadline) > Date.parse(now) ? "bookable" : "deadline-passed";
}

export function serviceClosureForTarget(
  closures: ServiceClosure[],
  target: MealSlotTarget
): ServiceClosure | null {
  const matchingDate = closures.filter(({ date }) => date === target.date);
  return matchingDate.find(({ occasion }) => occasion === null) ??
    matchingDate.find(({ occasion }) => occasion === target.occasion) ?? null;
}
