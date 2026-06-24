import type { CollectionConfig } from "payload";
import { isAdmin } from "../access/isAdmin";

// category 用 kebab-case（big-meat / small-meat / vegetable），与 @cfp/menu-core 的
// DishSlot（camelCase: bigMeat / smallMeat / vegetable）是两套命名，
// 取数据时经 menu-core 的 RECIPE_CATEGORY_TO_SLOT 映射到槽位，别直接当键用。
export const Recipes: CollectionConfig = {
  slug: "recipes",
  labels: {
    singular: "菜谱",
    plural: "菜谱库",
  },
  admin: {
    useAsTitle: "name",
    group: "社区做饭",
    defaultColumns: ["name", "category", "active", "updatedAt"],
  },
  access: {
    // 小程序匿名读取菜品；写入需要登录后台。
    read: () => true,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: "name",
      label: "菜名",
      type: "text",
      required: true,
      index: true,
    },
    {
      name: "category",
      label: "分类",
      type: "select",
      required: true,
      index: true,
      options: [
        { label: "大荤", value: "big-meat" },
        { label: "小荤", value: "small-meat" },
        { label: "素菜", value: "vegetable" },
      ],
      defaultValue: "vegetable",
    },
    {
      name: "active",
      label: "启用",
      type: "checkbox",
      defaultValue: true,
      admin: {
        description: "取消勾选可临时把菜品移出生成池，无需删除。",
      },
    },
  ],
};
