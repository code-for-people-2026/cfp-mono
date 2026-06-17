import type { GlobalConfig } from "payload";
import { isAdmin } from "../access/isAdmin";
import { revalidateGlobal } from "../hooks/revalidate";

// Functional micro-copy rendered on the client (chat controls, doc-page back link, etc.).
export const UiStrings: GlobalConfig = {
  slug: "ui-strings",
  label: "通用文案",
  admin: { group: "官网内容" },
  versions: { drafts: true },
  access: { read: () => true, update: isAdmin },
  hooks: { afterChange: [revalidateGlobal("payload:ui-strings")] },
  fields: [
    { name: "backToHome", label: "回到首页", type: "text", required: true },
    { name: "sendLabel", label: "发送（无障碍标签）", type: "text", required: true },
    { name: "chatRestart", label: "重新开始", type: "text", required: true },
    { name: "chatLoading", label: "等待回答提示", type: "text", required: true },
    { name: "chatDisclaimer", label: "AI 免责说明", type: "text", required: true },
    { name: "chatAssistantName", label: "助手称呼", type: "text", required: true },
    { name: "chatUserName", label: "用户称呼", type: "text", required: true },
    { name: "chatPlaceholder", label: "对话输入框占位", type: "text", required: true },
    { name: "chatResetConfirm", label: "清空确认提示", type: "text", required: true },
  ],
};
