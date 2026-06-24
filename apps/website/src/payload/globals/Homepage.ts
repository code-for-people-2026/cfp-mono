import type { GlobalConfig } from "payload";
import { isAdmin } from "../access/isAdmin";
import { cardsField, sectionHeaderFields } from "../fields/shared";
import { revalidateGlobal } from "../hooks/revalidate";

export const Homepage: GlobalConfig = {
  slug: "homepage",
  label: "首页",
  admin: { group: "官网内容" },
  versions: { drafts: true },
  access: { read: () => true, update: isAdmin },
  hooks: { afterChange: [revalidateGlobal("payload:homepage")] },
  fields: [
    {
      name: "hero",
      label: "首屏",
      type: "group",
      fields: [
        { name: "kicker", label: "上标签", type: "text", required: true },
        { name: "title", label: "大标题", type: "text", required: true },
        { name: "organizationLine", label: "组织说明", type: "text", required: true },
        { name: "manifestoLine", label: "标语", type: "text", required: true },
        { name: "body", label: "补充说明（可空）", type: "textarea" },
      ],
    },
    {
      name: "dialogueEntry",
      label: "对话入口",
      type: "group",
      fields: [
        { name: "prompt", label: "提示", type: "text", required: true },
        { name: "placeholder", label: "输入框占位", type: "text", required: true },
        { name: "submitLabel", label: "按钮文字", type: "text", required: true },
        { name: "note", label: "底部说明", type: "textarea", required: true },
      ],
    },
    {
      name: "dialogueSuggestions",
      label: "对话建议",
      type: "array",
      fields: [
        { name: "label", label: "按钮文字", type: "text", required: true },
        { name: "value", label: "发送的问题", type: "textarea", required: true },
      ],
    },
    cardsField("heroFlow", "三步流程"),
    {
      name: "identity",
      label: "我们是谁，服务谁",
      type: "group",
      fields: [...sectionHeaderFields(), cardsField("cards", "卡片")],
    },
    {
      name: "whyNow",
      label: "规则背后，是红利怎么分",
      type: "group",
      fields: [...sectionHeaderFields(), cardsField("points", "卡片")],
    },
    {
      name: "lifeScenes",
      label: "我们说的工友，不是一个行业",
      type: "group",
      fields: [
        ...sectionHeaderFields(),
        cardsField("scenes", "场景卡片", [
          {
            name: "tags",
            label: "标签",
            type: "array",
            fields: [{ name: "tag", label: "标签", type: "text", required: true }],
          },
        ]),
      ],
    },
    {
      name: "direction",
      label: "我们怎么判断方向",
      type: "group",
      fields: [...sectionHeaderFields(), cardsField("points", "卡片")],
    },
    {
      name: "selfRestraint",
      label: "我们如何约束自己",
      type: "group",
      fields: [...sectionHeaderFields(), cardsField("points", "卡片")],
    },
    {
      name: "continueReads",
      label: "继续阅读",
      type: "group",
      fields: [
        ...sectionHeaderFields(),
        {
          name: "items",
          label: "入口卡片",
          type: "array",
          fields: [
            { name: "label", label: "标题", type: "text", required: true },
            { name: "description", label: "说明", type: "textarea", required: true },
            {
              name: "target",
              label: "目标",
              type: "select",
              required: true,
              options: [
                { label: "数据平权宣言 (/manifesto)", value: "manifesto" },
                { label: "牛马能力剥夺矩阵 (/map)", value: "map" },
                { label: "牛马互助协议 (/license)", value: "license" },
              ],
            },
          ],
        },
      ],
    },
  ],
};
