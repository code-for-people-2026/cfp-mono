import type { CollectionConfig } from "payload";
import { isAdmin } from "../access/isAdmin";

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
  fields: [
    {
      name: "title",
      label: "标题",
      type: "text",
      required: true,
    },
    {
      name: "slug",
      label: "路径标识",
      type: "text",
      required: true,
      unique: true,
    },
    {
      name: "summary",
      label: "摘要",
      type: "textarea",
      required: true,
    },
    {
      name: "body",
      label: "正文",
      type: "textarea",
      required: true,
    },
  ],
};

