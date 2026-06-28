import type { CollectionConfig } from "payload";
import { isAdmin } from "../access/isAdmin";
import { sectionsField, stringsField } from "../fields/shared";
import { revalidateDocument } from "../hooks/revalidate";

// 数据平权宣言 / 牛马互助协议 — each rendered by the DocumentPage component.
// Drafts are off (every save publishes + revalidates the per-slug tag). guide/sections/
// fullSections are `json` columns, not `array` child tables (issue #72).
export const SiteDocuments: CollectionConfig = {
  slug: "site-documents",
  admin: {
    useAsTitle: "title",
    group: "官网内容",
    defaultColumns: ["title", "slug", "updatedAt"],
  },
  access: {
    read: () => true,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    afterChange: [revalidateDocument],
  },
  fields: [
    {
      name: "slug",
      label: "页面",
      type: "select",
      required: true,
      unique: true,
      options: [
        { label: "数据平权宣言 (/manifesto)", value: "manifesto" },
        { label: "牛马互助协议 (/license)", value: "license" },
      ],
    },
    { name: "eyebrow", label: "眉标", type: "text", required: true },
    { name: "title", label: "标题", type: "text", required: true },
    { name: "summary", label: "摘要", type: "textarea", required: true },
    { name: "meta", label: "版本/元信息", type: "text" },
    { name: "source", label: "来源备注", type: "text" },
    stringsField("guide", "先读这一段（导读）"),
    sectionsField("sections", "导读正文分节"),
    { name: "closing", label: "结语", type: "textarea" },
    { name: "fullTitle", label: "全文标题", type: "text" },
    sectionsField("fullSections", "原文分节"),
  ],
};
