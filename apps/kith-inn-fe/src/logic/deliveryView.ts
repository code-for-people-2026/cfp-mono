// FE-local mirror of GET /delivery (be: routes/delivery.ts → packingSort + gapReport).
// ponytail: duplicate the shapes here (be-local types live in domain/delivery/derivations.ts)
// rather than touch be in an FE-only PR; consolidate into @cfp/kith-inn-shared later (see menuView).

type FulfillmentStatus = "pending" | "handed-off" | "done" | "canceled";

type Fulfillment = {
  id: string | number;
  orderItem: string | number;
  serviceDate: string;
  occasion?: string;
  mode: string;
  status: FulfillmentStatus;
  addrBuilding?: string;
  addrUnit?: string;
  assignee?: string;
  timeWindow?: string;
};

export type BuildingGroup = { building: string; count: number; fulfillments: Fulfillment[] };

export type DeliveryView = {
  sort: BuildingGroup[];
  gaps: { gaps: Array<{ building: string; pending: number }>; totalPending: number };
};

/** Done vs total for a building + percent (0–100) for the progress bar. */
export function buildingProgress(group: BuildingGroup): { done: number; total: number; percent: number } {
  const total = group.fulfillments.length;
  const done = group.fulfillments.filter((f) => f.status === "done").length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Chinese label for a fulfillment status. */
export function fulfillmentStatusLabel(status: string): string {
  switch (status) {
    case "done":
      return "完成";
    case "handed-off":
      return "已交接";
    case "canceled":
      return "已取消";
    default:
      return "待送";
  }
}
