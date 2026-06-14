import type { CollectionConfig } from "payload";

export const MiniappDemoEntries: CollectionConfig = {
  slug: "miniapp-demo-entries",
  admin: {
    useAsTitle: "title",
    group: "小程序"
  },
  access: {
    read: () => true,
    create: () => true
  },
  fields: [
    {
      name: "title",
      label: "标题",
      type: "text",
      required: true
    },
    {
      name: "note",
      label: "备注",
      type: "textarea"
    }
  ]
};

