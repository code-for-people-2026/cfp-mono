import type { ConfirmCustomerItem, OrderReconciliationRow } from "@cfp/kith-inn-shared";

const occasionZh = (occasion: ConfirmCustomerItem["occasion"]) => occasion === "lunch" ? "午餐" : "晚餐";

export const orderConfirmLine = (item: ConfirmCustomerItem) =>
  `${item.date} · ${item.customerName} · ${item.quantity}份${occasionZh(item.occasion)}`;

export const orderReconciliationConflictMessage = (data: unknown) => {
  const error = data as { error?: string; message?: string } | null;
  return error?.error === "settled-order"
    ? error.message ?? "接龙涉及已付款或已送达订单，请单独处理"
    : "这张确认卡已过期，请重新说一遍";
};

export const orderReconciliationLine = (row: OrderReconciliationRow) => {
  const label = { create: "新增", update: "更新", cancel: "取消", unchanged: "不变", add: "追加", set: "改量" }[row.kind];
  const quantity = row.kind === "update" || row.kind === "cancel" || row.kind === "add" || row.kind === "set"
    ? `${row.beforeQuantity ?? 0} → ${row.afterQuantity}份`
    : `${row.afterQuantity}份`;
  return `${label} · ${row.date} ${occasionZh(row.occasion)} · ${row.customerName} · ${quantity}${row.affectsConfirmed ? " · 影响备餐/送餐/收款" : ""}`;
};
