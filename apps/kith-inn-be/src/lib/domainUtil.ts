import type { Order } from "@cfp/kith-inn-shared";

const SHANGHAI_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayShanghai(now: Date | (() => Date) = new Date()): string {
  return SHANGHAI_FMT.format(typeof now === "function" ? now() : now);
}

export function customerName(order: Order): string {
  const c = order.customer;
  return typeof c === "object" && c !== null ? c.displayName : `#${c}`;
}
