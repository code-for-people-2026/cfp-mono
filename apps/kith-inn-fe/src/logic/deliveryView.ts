// FE view helpers for GET /delivery. Types come from @cfp/kith-inn-shared (#89 PR B);
// only presentation logic lives here.
import type { AddressGroup } from "@cfp/kith-inn-shared";

export type { AddressGroup, DeliveryView, Fulfillment } from "@cfp/kith-inn-shared";

/** Done vs total for an address group + percent (0–100) for the progress bar. */
export function buildingProgress(group: AddressGroup): { done: number; total: number; percent: number } {
  const total = group.fulfillments.length;
  const done = group.fulfillments.filter((f) => f.status === "done").length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Chinese label for a fulfillment status. */
export function fulfillmentStatusLabel(status: string): string {
  switch (status) {
    case "done":
      return "完成";
    case "canceled":
      return "已取消";
    default:
      return "待送";
  }
}
