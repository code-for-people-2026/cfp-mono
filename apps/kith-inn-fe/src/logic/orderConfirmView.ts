import type { ConfirmCustomerItem, OrderReconciliationRow } from "@cfp/kith-inn-shared";

const occasionZh = (occasion: ConfirmCustomerItem["occasion"]) => occasion === "lunch" ? "午餐" : "晚餐";

export const orderConfirmLine = (item: ConfirmCustomerItem) =>
  `${item.date} · ${item.customerName} · ${item.quantity}份${occasionZh(item.occasion)}`;

export const orderReconciliationConflictMessage = (data: unknown) => {
  const error = data as { error?: string; message?: string } | null;
  if (error?.error === "settled-order") return error.message ?? "本次修改涉及已标记到账或已送达订单，请单独处理";
  if (error?.error === "stale-preview") return error.message ?? "这张确认卡已过期，请重新说一遍";
  return "这张确认卡已过期，请重新说一遍";
};

export const orderReconciliationLine = (row: OrderReconciliationRow, operation?: "add" | "set") => {
  const label = { create: "新增", update: "更新", cancel: "取消", unchanged: "不变", add: "追加", set: "改量" }[row.kind];
  const isAdd = row.kind === "add" || (row.kind === "create" && operation === "add");
  const isSet = row.kind === "set" || (row.kind === "create" && operation === "set");
  const before = row.beforeQuantity ?? 0;
  const quantity = isAdd
    ? `当前${before}份 + ${row.changeQuantity ?? row.afterQuantity - before}份 → 共${row.afterQuantity}份`
    : isSet
      ? `当前${before}份 → 改成${row.afterQuantity}份`
      : row.kind === "update" || row.kind === "cancel"
        ? `${before} → ${row.afterQuantity}份`
        : `${row.afterQuantity}份`;
  return `${label} · ${row.date} ${occasionZh(row.occasion)} · ${row.customerName} · ${quantity}${row.affectsConfirmed ? " · 影响备餐/送餐/到账记录" : ""}`;
};
