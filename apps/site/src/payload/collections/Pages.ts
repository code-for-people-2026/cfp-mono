import type { CollectionConfig } from "payload";

export const Pages: CollectionConfig = {
  slug: "pages",
  admin: {
    useAsTitle: "title",
    group: "官网"
  },
  access: {
    read: () => true
  },
  fields: [
    {
      name: "title",
      label: "标题",
      type: "text",
      required: true
    },
    {
      name: "slug",
      label: "Slug",
      type: "text",
      required: true,
      unique: true
    },
    {
      name: "summary",
      label: "摘要",
      type: "textarea"
    }
  ]
};

