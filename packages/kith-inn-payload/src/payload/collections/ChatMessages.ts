import type { CollectionConfig } from "payload";
import { CHAT_ROLES } from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `chat_messages` — the「今天」main-conversation retention (PRD §5.5 / §7.1).
 * Carrier of the DISPLAYED conversation (not business memory, which is the
 * permanent orders/offerings). 2-day rolling window + 1000-hard-cap retention
 * policy is applied server-side at write time (M1); createdAt (Payload-built-in)
 * is the pagination/trim key, scoped by (seller, operator).
 */
export const ChatMessages: CollectionConfig = {
  slug: "chat_messages",
  admin: { useAsTitle: "content", group: "对话" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    { name: "operator", type: "relationship", relationTo: "operators", index: true },
    { name: "content", type: "textarea", required: true },
    { name: "role", type: "select", options: [...CHAT_ROLES], defaultValue: "user" },
    { name: "card", type: "json" },
    sellerField,
  ],
};
