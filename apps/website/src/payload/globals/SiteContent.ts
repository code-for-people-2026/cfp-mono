import type { GlobalConfig } from "payload";
import { isAdmin } from "../access/isAdmin";
import { cardsField, sectionHeaderFields } from "../fields/shared";
import { revalidateGlobal } from "../hooks/revalidate";

// Single global holding all site copy (homepage / footer / settings / chat / ui strings),
// replacing five separate globals. Lists are `json` (jsonb) columns — not `array` child
// tables — so this whole global is one table (issue #72). Unnamed `tabs` are UI grouping
// only; every field is a column on the single site-content row. Drafts are off (every
// save publishes + revalidates).
export const SiteContent: GlobalConfig = {
  slug: "site-content",
  label: "站点内容",
  admin: { group: "官网内容" },
  access: { read: () => true, update: isAdmin },
  hooks: { afterChange: [revalidateGlobal("payload:site-content")] },
  fields: [
    {
      type: "tabs",
      tabs: [
        {
          label: "首页",
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
              type: "json",
              defaultValue: [],
              admin: { description: 'JSON 数组，每项 { "label": "按钮文字", "value": "发送的问题" }' },
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
                {
                  name: "scenes",
                  label: "场景卡片",
                  type: "json",
                  defaultValue: [],
                  admin: {
                    description:
                      'JSON 数组，每项 { "title": "...", "body": "...", "tags": ["..."] }',
                  },
                },
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
                  type: "json",
                  defaultValue: [],
                  admin: {
                    description:
                      'JSON 数组，每项 { "label": "标题", "description": "说明", "target": "manifesto | map | license" }',
                  },
                },
              ],
            },
          ],
        },
        {
          label: "页脚",
          fields: [
            { name: "description", label: "页脚简介", type: "textarea", required: true },
            { name: "linksHeading", label: "「网站链接」标题", type: "text", required: true },
            {
              name: "footerLinks",
              label: "网站链接",
              type: "json",
              defaultValue: [],
              admin: { description: 'JSON 数组，每项 { "label": "文字", "href": "链接" }' },
            },
            { name: "channelsHeading", label: "「公开渠道」标题", type: "text", required: true },
            {
              name: "channels",
              label: "社交渠道",
              type: "json",
              defaultValue: [],
              admin: {
                description:
                  'JSON 数组，每项 { "label": "名称", "iconKey": "douyin | kuaishou | bilibili", "status": "状态文字", "description": "说明", "qrPath"?: "二维码路径", "qrAlt"?: "二维码 alt" }',
              },
            },
            { name: "githubLabel", label: "GitHub 文字", type: "text", required: true },
            {
              name: "beian",
              label: "ICP备案信息",
              type: "text",
              defaultValue: "粤ICP备2026098322号-1",
            },
            { name: "copyright", label: "版权", type: "text", required: true },
          ],
        },
        {
          label: "站点设置",
          fields: [
            { name: "shareTitle", label: "分享标题 (OG/SEO)", type: "text", required: true },
            { name: "shareDescription", label: "分享描述 (OG/SEO)", type: "textarea", required: true },
            {
              name: "directionMapUrl",
              label: "牛马能力剥夺矩阵链接 (站内 /wam)",
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
              type: "json",
              defaultValue: [],
              admin: { description: 'JSON 数组，每项 { "label": "文字", "href": "链接" }' },
            },
          ],
        },
        {
          label: "对话页",
          fields: [
            { name: "chatHeading", label: "空状态标题", type: "text", required: true },
            { name: "chatIntro", label: "空状态引导语", type: "textarea", required: true },
          ],
        },
        {
          label: "通用文案",
          fields: [
            { name: "backToHome", label: "回到首页", type: "text", required: true },
            { name: "sendLabel", label: "发送（无障碍标签）", type: "text", required: true },
            { name: "chatRestart", label: "重新开始", type: "text", required: true },
            { name: "chatLoading", label: "等待回答提示", type: "text", required: true },
            { name: "chatDisclaimer", label: "AI 免责说明", type: "text", required: true },
            { name: "chatAssistantName", label: "助手称呼", type: "text", required: true },
            { name: "chatUserName", label: "用户称呼", type: "text", required: true },
            { name: "chatPlaceholder", label: "对话输入框占位", type: "text", required: true },
            { name: "chatResetConfirm", label: "清空确认提示", type: "text", required: true },
          ],
        },
      ],
    },
  ],
};
