import type { CollectionConfig } from "payload";
import { ORDER_SOURCES, ORDER_STATUSES, PAYMENT_STATUSES } from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `orders` — one ordering intent, one person, one day (PRD §7.1). Day-granular:
 * no meal/qty/price/delivery here (those live on order_items + fulfillments).
 *
 * M0 ships the schema stub. The §3.3 write-side state machine (draft=纯记录 →
 * 确认物化开 slot + 建 fulfillments → 取消作废) and the `totalCents` recompute
 * hook are M1. The §3.2 `(seller, idempotencyKey)` partial-unique + compound
 * indexes land with the migrations PR.
 */
export const Orders: CollectionConfig = {
  slug: "orders",
  admin: { useAsTitle: "date", group: "订单" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    {
      name: "customer",
      type: "relationship",
      relationTo: "customers",
      required: true,
      index: true,
    },
    { name: "date", type: "date", required: true, index: true },
    {
      name: "status",
      type: "select",
      options: [...ORDER_STATUSES],
      defaultValue: "draft",
      index: true,
    },
    { name: "source", type: "select", options: [...ORDER_SOURCES], defaultValue: "manual" },
    { name: "placedAt", type: "date" },
    { name: "note", type: "textarea" },
    { name: "totalCents", type: "number", admin: { readOnly: true } },
    /** Frozen delivery-address snapshot (自由文本，下单时从 customer.address 快照；不可改). */
    { name: "address", type: "text", index: true },
    {
      name: "paymentStatus",
      type: "select",
      options: [...PAYMENT_STATUSES],
      defaultValue: "unpaid",
      index: true,
    },
    { name: "paymentMethod", type: "text" },
    { name: "paidAt", type: "date" },
    { name: "idempotencyKey", type: "text", index: true },
    { name: "createdBy", type: "relationship", relationTo: "operators" },
    sellerField,
  ],
};
