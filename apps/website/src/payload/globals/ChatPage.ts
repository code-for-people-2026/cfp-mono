import type { GlobalConfig } from "payload";
import { isAdmin } from "../access/isAdmin";
import { revalidateGlobal } from "../hooks/revalidate";

export const ChatPage: GlobalConfig = {
  slug: "chat-page",
  label: "对话页",
  admin: { group: "官网内容" },
  versions: { drafts: true },
  access: { read: () => true, update: isAdmin },
  hooks: { afterChange: [revalidateGlobal("payload:chat-page")] },
  fields: [
    { name: "heading", label: "空状态标题", type: "text", required: true },
    { name: "intro", label: "空状态引导语", type: "textarea", required: true },
  ],
};
