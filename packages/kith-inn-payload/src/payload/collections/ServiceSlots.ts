import type { CollectionConfig } from "payload";
import { OCCASIONS, SERVICE_SLOT_GRANULARITIES, SERVICE_SLOT_STATUSES } from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `service_slots` — time bucket (PRD §7.1): which day · which meal/time-slot.
 * Double duty: universal time bucket (all businesses) + meal/menu anchor
 * (meal businesses, via menu-planning). "确认订单" upserts it → open (M1).
 *
 * M0 ships the schema stub only — the §3.2 unique constraint
 * `(seller, date, occasion)` is hand-written in the CMS migration. Future
 * time-slot businesses can add a separate `(seller, date, startAt, endAt)`
 * unique index when that path is implemented.
 */
export const ServiceSlots: CollectionConfig = {
  slug: "service_slots",
  admin: { useAsTitle: "date", group: "排期" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    { name: "date", type: "date", required: true, index: true },
    {
      name: "granularity",
      type: "select",
      options: [...SERVICE_SLOT_GRANULARITIES],
      required: true,
    },
    { name: "occasion", type: "select", options: [...OCCASIONS] },
    { name: "startAt", type: "date" },
    { name: "endAt", type: "date" },
    {
      name: "status",
      type: "select",
      options: [...SERVICE_SLOT_STATUSES],
      defaultValue: "draft",
    },
    sellerField,
  ],
};
