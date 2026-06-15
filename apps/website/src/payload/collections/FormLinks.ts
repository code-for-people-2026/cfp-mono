import type { CollectionConfig } from "payload";
import { isAdmin } from "../access/isAdmin";

export const FormLinks: CollectionConfig = {
  slug: "form-links",
  admin: {
    useAsTitle: "label",
    group: "官网内容",
    defaultColumns: ["label", "purpose", "url", "updatedAt"],
  },
  access: {
    read: () => true,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: "label",
      label: "入口文案",
      type: "text",
      required: true,
    },
    {
      name: "purpose",
      label: "入口类型",
      type: "select",
      required: true,
      options: [
        { label: "一起做事", value: "collaborate" },
        { label: "真实需求", value: "need" },
        { label: "提出批评", value: "critique" },
      ],
    },
    {
      name: "url",
      label: "腾讯表单链接",
      type: "text",
      required: true,
    },
  ],
};

