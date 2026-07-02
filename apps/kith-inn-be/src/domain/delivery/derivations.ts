import type { Fulfillment, MenuPlan, Order } from "@cfp/kith-inn-shared";

/**
 * 送餐/缺口派生（PRD §6.3 + §7.5「派生不落表」）——纯函数，数据由调用方传入（cms 读
 * 后内存计算）。源头防错（分拣装篮）+ 收尾防漏（缺口对账）+ 最近一餐聚焦 + 今天还差什么。
 */

// ── 按地址分拣（源头防错）──────────────────────────────────────────────

/**
 * Resolve a fulfillment's delivery address — the address lives on the ORDER
 * (frozen snapshot), not on the fulfillment. The cms fulfillments route
 * populates `orderItem → order` (depth 2) so this reads `f.orderItem.order.address`.
 */
function orderAddress(f: Fulfillment): string {
  const oi = f.orderItem;
  if (oi && typeof oi === "object") {
    const o = oi.order;
    if (o && typeof o === "object" && typeof o.address === "string") return o.address.trim();
  }
  return "";
}

export type AddressGroup = { address: string; count: number; fulfillments: Fulfillment[] };

/** 按地址汇总（如 3e23a×2、26B×1），照这张分拣装篮——在打包环节就把错误挡住。按份数降序。 */
export function packingSort(fulfillments: Fulfillment[]): AddressGroup[] {
  const byAddress = new Map<string, Fulfillment[]>();
  for (const f of fulfillments) {
    const a = orderAddress(f) || "（无地址）";
    const arr = byAddress.get(a) ?? [];
    arr.push(f);
    byAddress.set(a, arr);
  }
  return [...byAddress.entries()]
    .map(([address, fs]) => ({ address, count: fs.length, fulfillments: fs }))
    .sort((a, b) => b.count - a.count || a.address.localeCompare(b.address));
}

// ── 缺口对账（收尾防漏）────────────────────────────────────────────────

export type AddressGap = { address: string; pending: number };

/** 缺口：status∈{pending,handed-off}（未送达且未取消——self/onsite 无行、canceled 终态不计）。
 *  按地址列，提示"这趟 N 个地址，26B 还没送"。 */
export function gapReport(fulfillments: Fulfillment[]): { gaps: AddressGap[]; totalPending: number } {
  const open = fulfillments.filter((f) => f.status === "pending" || f.status === "handed-off");
  const byAddress = new Map<string, number>();
  for (const f of open) {
    const a = orderAddress(f) || "（无地址）";
    byAddress.set(a, (byAddress.get(a) ?? 0) + 1);
  }
  const gaps = [...byAddress.entries()]
    .map(([address, pending]) => ({ address, pending }))
    .sort((a, b) => b.pending - a.pending || a.address.localeCompare(b.address));
  return { gaps, totalPending: open.length };
}

/**
 * Open fulfillments (pending/handed-off) whose order address contains the fragment
 * — shared by the agent's mark_delivered tool and the delivery tab's 「送达」 button.
 * Blank fragment → [] (guards against "".includes marking *everything* done).
 */
export function fulfillmentsMatchingAddress(fulfillments: Fulfillment[], address: string): Fulfillment[] {
  const a = address.trim();
  if (!a) return [];
  return fulfillments.filter((f) => orderAddress(f).includes(a) && (f.status === "pending" || f.status === "handed-off"));
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

/** 跨表"今天还差什么"：草稿未确认 / 未送履约 / 未付 / 菜单未发。纯函数（数据传入）。
 *  未付口径只算 **confirmed** 单（draft 默认 unpaid 但未成单、canceled 已作废，§7.1）。 */
export function todayGaps(input: { orders: Order[]; fulfillments: Fulfillment[]; menuPlans: MenuPlan[] }): TodayGaps {
  return {
    unconfirmedOrders: input.orders.filter((o) => o.status === "draft").length,
    pendingDeliveries: input.fulfillments.filter((f) => f.status === "pending" || f.status === "handed-off").length,
    unpaidOrders: input.orders.filter((o) => o.status === "confirmed" && o.paymentStatus === "unpaid").length,
    unpublishedMenus: input.menuPlans.filter((m) => m.status === "draft").length,
  };
}
