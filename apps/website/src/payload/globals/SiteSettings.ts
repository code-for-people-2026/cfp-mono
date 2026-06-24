import type { GlobalConfig } from "payload";
import { isAdmin } from "../access/isAdmin";
import { revalidateGlobal } from "../hooks/revalidate";

export const SiteSettings: GlobalConfig = {
  slug: "site-settings",
  label: "站点设置",
  admin: { group: "官网内容" },
  versions: { drafts: true },
  access: { read: () => true, update: isAdmin },
  hooks: { afterChange: [revalidateGlobal("payload:site-settings")] },
  fields: [
    { name: "shareTitle", label: "分享标题 (OG/SEO)", type: "text", required: true },
    { name: "shareDescription", label: "分享描述 (OG/SEO)", type: "textarea", required: true },
    {
      name: "directionMapUrl",
      label: "牛马能力剥夺矩阵链接 (站内 /map)",
      type: "text",
      required: true,
    },
    { name: "githubUrl", label: "GitHub 地址", type: "text", required: true },
    {
      name: "brand",
      label: "品牌",
      type: "group",
      fields: [
        { name: "wordmark", label: "字标", type: "text", required: true },
        { name: "tagline", label: "副标", type: "text", required: true },
        { name: "logoPath", label: "Logo 路径 (/public 下)", type: "text", required: true },
        { name: "logoAlt", label: "Logo alt", type: "text", required: true },
      ],
    },
    {
      name: "headerNav",
      label: "顶栏导航",
      type: "array",
      fields: [
        { name: "label", label: "文字", type: "text", required: true },
        { name: "href", label: "链接", type: "text", required: true },
      ],
    },
  ],
};
