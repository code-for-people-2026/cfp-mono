/**
 * Zero-zod pure helpers shared FE/BE (#89). Deliberately zod-free so FE can
 * `import` (value) these without dragging zod into the weapp bundle (the zod
 * schemas live in `schemas.ts`; types in `types.ts`).
 */
import type { Order } from "./types";

const SHANGHAI_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date (YYYY-MM-DD) in Asia/Shanghai (桃子's tz). Accepts a Date or a
 *  clock thunk, so be (deterministic tests pass `() => Date`) and fe (pass a
 *  Date / default = now) share one helper. */
export function todayShanghai(now: Date | (() => Date) = new Date()): string {
  const d = typeof now === "function" ? now() : now;
  return SHANGHAI_FMT.format(d);
}

/** Customer display name — `order.customer` is populated to a Customer at cms depth 1,
 *  else a bare id. (Mirror of be agent/services.ts + fe logic/ordersView.ts — collapsed here.) */
export function customerName(order: Order): string {
  const c = order.customer;
  return typeof c === "object" && c !== null ? c.displayName : `#${c}`;
}
