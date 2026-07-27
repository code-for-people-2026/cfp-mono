import type { MealSlot, MealSlotTarget, ServiceClosure } from "./types";

export type CustomerMealSlotPresentation =
  | "hidden"
  | "bookable"
  | "deadline-passed"
  | "stopped"
  | "service-closed";

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

export function customerMealSlotPresentationForTarget(
  sellerId: MealSlot["sellerId"],
  target: MealSlotTarget,
  slot: Pick<MealSlot, "orderStatus" | "orderDeadline"> | null,
  closures: ServiceClosure[],
  now: string
): CustomerMealSlotPresentation {
  const sellerClosures = closures.filter((closure) => String(closure.sellerId) === String(sellerId));
  if (serviceClosureForTarget(sellerClosures, target) !== null) return "service-closed";
  return slot === null ? "hidden" : customerMealSlotPresentation(slot, now);
}
