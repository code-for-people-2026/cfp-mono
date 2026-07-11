import type { ConfirmCustomerItem } from "@cfp/kith-inn-shared";

const occasionZh = (occasion: ConfirmCustomerItem["occasion"]) => occasion === "lunch" ? "午餐" : "晚餐";

export const orderConfirmLine = (item: ConfirmCustomerItem) =>
  `${item.date} · ${item.customerName} · ${item.quantity}份${occasionZh(item.occasion)}`;
