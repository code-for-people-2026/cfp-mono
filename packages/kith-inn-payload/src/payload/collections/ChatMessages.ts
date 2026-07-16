import type { CollectionConfig } from "payload";
import { CHAT_ROLES } from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `chat_messages` —「今天」主对话的展示历史（PRD §5.5 / §7.1）。它不是业务记忆；
 * 订单、菜单和履约才是长期业务事实。当前只提供最近一页读取；稳定游标分页与按
 * (seller, operator) 容量有界留存由 #160 实现，不再采用固定两天窗口。
 */
export const ChatMessages: CollectionConfig = {
  slug: "chat_messages",
  admin: { useAsTitle: "content", group: "对话" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    { name: "operator", type: "relationship", relationTo: "operators", required: true, index: true },
    { name: "content", type: "textarea", required: true },
    { name: "role", type: "select", options: [...CHAT_ROLES], defaultValue: "user" },
    { name: "card", type: "json" },
    sellerField,
  ],
};
