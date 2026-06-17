import type { CollectionConfig } from "payload";
import { isAdmin } from "../access/isAdmin";
import { paragraphsField, sectionsField } from "../fields/shared";
import { revalidateDocument } from "../hooks/revalidate";

// 数据平权宣言 / 牛马互助协议 / 牛马能力剥夺矩阵 — each rendered by the DocumentPage component.
export const SiteDocuments: CollectionConfig = {
  slug: "site-documents",
  admin: {
    useAsTitle: "title",
    group: "官网内容",
    defaultColumns: ["title", "slug", "_status", "updatedAt"],
  },
  versions: { drafts: true },
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
        { label: "牛马能力剥夺矩阵 (/map)", value: "map" },
      ],
    },
    { name: "eyebrow", label: "眉标", type: "text", required: true },
    { name: "title", label: "标题", type: "text", required: true },
    { name: "summary", label: "摘要", type: "textarea", required: true },
    { name: "meta", label: "版本/元信息", type: "text" },
    { name: "source", label: "来源备注", type: "text" },
    paragraphsField("guide", "先读这一段（导读）"),
    sectionsField("sections", "导读正文分节"),
    { name: "closing", label: "结语", type: "textarea" },
    { name: "fullTitle", label: "全文标题", type: "text" },
    sectionsField("fullSections", "原文分节"),
  ],
};
