import type { Fulfillment, MenuPlan, Order } from "@cfp/kith-inn-shared";

/**
 * 送餐/缺口派生（PRD §6.3 + §7.5「派生不落表」）——纯函数，数据由调用方传入（cms 读
 * 后内存计算）。源头防错（分拣装篮）+ 收尾防漏（缺口对账）+ 最近一餐聚焦 + 今天还差什么。
 */

// ── 按楼栋分拣（源头防错）──────────────────────────────────────────────

export type BuildingGroup = { building: string; count: number; fulfillments: Fulfillment[] };

/** 按楼栋汇总（如 3A×2、26B×1），照这张分拣装篮——在打包环节就把错误挡住。按份数降序。 */
export function packingSort(fulfillments: Fulfillment[]): BuildingGroup[] {
  const byBuilding = new Map<string, Fulfillment[]>();
  for (const f of fulfillments) {
    const b = f.addrBuilding?.trim() || "（无楼栋）";
    const arr = byBuilding.get(b) ?? [];
    arr.push(f);
    byBuilding.set(b, arr);
  }
  return [...byBuilding.entries()]
    .map(([building, fs]) => ({ building, count: fs.length, fulfillments: fs }))
    .sort((a, b) => b.count - a.count || a.building.localeCompare(b.building));
}

// ── 缺口对账（收尾防漏）────────────────────────────────────────────────

export type BuildingGap = { building: string; pending: number };

/** 缺口：status∈{pending,handed-off}（未送达且未取消——self/onsite 无行、canceled 终态不计）。
 *  按楼栋列，提示"这趟 N 栋，26B 还没送"。 */
export function gapReport(fulfillments: Fulfillment[]): { gaps: BuildingGap[]; totalPending: number } {
  const open = fulfillments.filter((f) => f.status === "pending" || f.status === "handed-off");
  const byBuilding = new Map<string, number>();
  for (const f of open) {
    const b = f.addrBuilding?.trim() || "（无楼栋）";
    byBuilding.set(b, (byBuilding.get(b) ?? 0) + 1);
  }
  const gaps = [...byBuilding.entries()]
    .map(([building, pending]) => ({ building, pending }))
    .sort((a, b) => b.pending - a.pending || a.building.localeCompare(b.building));
  return { gaps, totalPending: open.length };
}

// ── 最近一餐聚焦（PRD §5.5）────────────────────────────────────────────

export type MealFocus = { day: "today" | "tomorrow"; meals: Array<"lunch" | "dinner"> };

/** 按时刻确定性聚焦最近一餐（小时，Asia/Shanghai）：上午→今天午餐；下午→今天晚餐；
 *  傍晚（≥17）→明天午+晚。纯函数（hour 传入，可测）。 */
export function nearestMeal(hour: number): MealFocus {
  if (hour < 12) return { day: "today", meals: ["lunch"] };
  if (hour < 17) return { day: "today", meals: ["dinner"] };
  return { day: "tomorrow", meals: ["lunch", "dinner"] };
}

// ── 今天还差什么（§4.1 getTodayGaps）───────────────────────────────────

export type TodayGaps = {
  unconfirmedOrders: number;
  pendingDeliveries: number;
  unpaidOrders: number;
  unpublishedMenus: number;
};

/** 跨表"今天还差什么"：草稿未确认 / 未送履约 / 未付 / 菜单未发。纯函数（数据传入）。 */
export function todayGaps(input: { orders: Order[]; fulfillments: Fulfillment[]; menuPlans: MenuPlan[] }): TodayGaps {
  return {
    unconfirmedOrders: input.orders.filter((o) => o.status === "draft").length,
    pendingDeliveries: input.fulfillments.filter((f) => f.status === "pending" || f.status === "handed-off").length,
    unpaidOrders: input.orders.filter((o) => o.paymentStatus === "unpaid").length,
    unpublishedMenus: input.menuPlans.filter((m) => m.status === "draft").length,
  };
}
