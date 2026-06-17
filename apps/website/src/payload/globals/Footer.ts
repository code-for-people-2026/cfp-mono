import type { GlobalConfig } from "payload";
import { isAdmin } from "../access/isAdmin";
import { revalidateGlobal } from "../hooks/revalidate";

export const Footer: GlobalConfig = {
  slug: "footer",
  label: "页脚",
  admin: { group: "官网内容" },
  versions: { drafts: true },
  access: { read: () => true, update: isAdmin },
  hooks: { afterChange: [revalidateGlobal("payload:footer")] },
  fields: [
    { name: "description", label: "页脚简介", type: "textarea", required: true },
    { name: "linksHeading", label: "「网站链接」标题", type: "text", required: true },
    {
      name: "footerLinks",
      label: "网站链接",
      type: "array",
      fields: [
        { name: "label", label: "文字", type: "text", required: true },
        { name: "href", label: "链接", type: "text", required: true },
      ],
    },
    { name: "channelsHeading", label: "「公开渠道」标题", type: "text", required: true },
    {
      name: "channels",
      label: "社交渠道",
      type: "array",
      fields: [
        { name: "label", label: "名称", type: "text", required: true },
        {
          name: "iconKey",
          label: "图标",
          type: "select",
          required: true,
          options: [
            { label: "抖音", value: "douyin" },
            { label: "快手", value: "kuaishou" },
            { label: "B站", value: "bilibili" },
          ],
        },
        { name: "status", label: "状态文字", type: "text", required: true },
        { name: "description", label: "说明", type: "textarea", required: true },
        { name: "qrPath", label: "二维码路径（留空显示「待补充」）", type: "text" },
        { name: "qrAlt", label: "二维码 alt", type: "text" },
      ],
    },
    { name: "githubLabel", label: "GitHub 文字", type: "text", required: true },
    {
      name: "beian",
      label: "备案信息（留空则不显示，备案后填）",
      type: "text",
    },
    { name: "copyright", label: "版权", type: "text", required: true },
  ],
};
