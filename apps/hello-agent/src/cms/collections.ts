import { operationsCollections, adminRoleField, adminAuditHook } from "../operations/collections";
import { isAdministrator } from "../operations/policy";
import { protectLastAdministrator, auditAdminDeletion } from "../operations/admin-access";
import { guardSafetyWrite } from "../operations/guards";
import { sensitiveReadAudit } from "../operations/audit";
import { ageCollections, guardAgeWrite } from "../age/collections";
import { privacyCollections, guardPrivacyWrite } from "../privacy/collections";
import {
  APIError,
  type Access,
  type CollectionConfig,
  type Field,
} from "payload";
import { agentCollections } from "./agent-collections";
import { collectionViews } from "./presentation";
import { MAX_STORED_IMAGE_BASE64_LENGTH } from "../domain/media-policy";
import type { OwnedCollection } from "./repository";

const admin: Access = ({ req }) => isAdministrator(req.user);
const ownerRead: Access = ({ req }) => {
  if (isAdministrator(req.user)) return true;
  const owner = req.context.helloOwner;
  return typeof owner === "string" ? { owner: { equals: owner } } : false;
};
const internalWrite: Access = ({ req }) =>
  typeof req.context.helloOwner === "string" && req.context.helloWrite === true;
const ownedFields: Field[] = [
  {
    name: "owner",
    label: "所属访客",
    type: "text",
    required: true,
    index: true,
  },
];
const owned = (
  slug: OwnedCollection,
  label: string,
  fields: Field[],
): CollectionConfig => ({
  slug,
  labels: { singular: label, plural: label },
  defaultSort: "-createdAt",
  admin: {
    ...collectionViews[slug],
    components: {
      beforeListTable: ["/src/cms/admin-cells#RecommendedColumns"],
    },
  },
  access: {
    read: ownerRead,
    create: internalWrite,
    update: internalWrite,
    delete: internalWrite,
  },
  hooks: { beforeChange: [guardPrivacyWrite, guardAgeWrite, guardSafetyWrite], afterRead: [sensitiveReadAudit] },
  fields: [...ownedFields, ...fields],
});

export const collections: CollectionConfig[] = [
  ...operationsCollections,
  ...agentCollections,
  ...privacyCollections,
  ...ageCollections,
  {
    slug: "platform-model-quotas",
    admin: { hidden: true },
    timestamps: false,
    lockDocuments: false,
    access: {
      read: () => false,
      create: () => false,
      update: () => false,
      delete: () => false,
    },
    fields: [
      { name: "day", type: "text", unique: true, required: true },
      { name: "reservedCalls", type: "number", required: true, min: 0 },
    ],
  },
  {
    slug: "admins",
    labels: { singular: "管理员", plural: "管理员" },
    auth: true,
    admin: {
      group: "系统管理",
      hidden: ({ user }) => !isAdministrator(user),
      useAsTitle: "email",
      defaultColumns: ["email", "createdAt", "updatedAt"],
      description:
        "用于登录此管理后台的管理员，不是聊天访客，也不是微信用户账号。",
    },
    hooks: {
      // Payload 首次注册会 overrideAccess；必须在仍会执行的钩子中守住初始化边界。
      beforeDelete: [auditAdminDeletion],
      beforeChange: [
        protectLastAdministrator,
        async ({ req, operation, data }) => {
          if (req.user?.collection === "admins") {
            if (!isAdministrator(req.user)) throw new APIError("账户与权限修改需要系统管理员", 403);
            return data;
          }
          if (operation !== "create") throw new APIError("账户与权限修改需要系统管理员", 403);
          const bootstrap =
            process.env.HELLO_ADMIN_BOOTSTRAP === "true" ||
            req.context.helloAdminBootstrap === true;
          if (
            !bootstrap ||
            (
              await req.payload.count({
                collection: "admins",
                overrideAccess: true,
                req,
              })
            ).totalDocs > 0
          ) {
            throw new APIError(
              "管理员注册未开放，请通过本地初始化命令创建首个管理员",
              403,
            );
          }
          data.role = "administrator";
          return data;
        },
      ],
      afterChange: [adminAuditHook],
    },
    access: {
      admin: ({ req }) => req.user?.collection === "admins",
      read: ({ req }) => isAdministrator(req.user) || (req.user?.collection === "admins" ? { id: { equals: req.user.id } } : false),
      update: admin,
      delete: admin,
      create: async ({ req }) => {
        if (isAdministrator(req.user)) return true;
        if (process.env.HELLO_ADMIN_BOOTSTRAP !== "true") return false;
        return (
          (
            await req.payload.count({
              collection: "admins",
              overrideAccess: true,
            })
          ).totalDocs === 0
        );
      },
    },
    fields: [adminRoleField],
  },
  {
    slug: "credentials",
    labels: { singular: "连接凭证", plural: "连接凭证" },
    admin: { hidden: true },
    access: {
      read: () => false,
      create: () => false,
      update: () => false,
      delete: () => false,
    },
    fields: [
      ...ownedFields,
      { name: "digest", type: "text", unique: true, required: true },
      { name: "wechatKey", type: "text", index: true },
      {
        name: "kind",
        type: "select",
        options: ["cookie", "bearer", "miniapp"],
        required: true,
      },
      { name: "expiresAt", type: "date", required: true },
    ],
  },
  owned("sessions", "祝福会话", [
    { name: "title", label: "名称", type: "text", required: true },
    {
      name: "memory",
      label: "对话记忆与压缩凭据",
      type: "json",
      typescriptSchema: [
        () => ({
          type: "object",
          tsType: 'import("./domain/context-policy").Memory | null',
        }),
      ],
      admin: {
        description:
          "保存摘要、已覆盖的轮次和最近一次压缩计数。原聊天记录仍在生成轮次中；广告凭据仅供本地开发联调，不代表经过广告服务端验签。",
      },
    },
  ]),
  owned("greetings", "生成轮次与吉祥话", [
    {
      name: "sessionId",
      label: "会话 ID",
      type: "number",
      required: true,
      index: true,
    },
    {
      name: "requestKey",
      label: "幂等请求标识",
      type: "text",
      unique: true,
      required: true,
    },
    { name: "fingerprint", label: "内容指纹", type: "text", required: true },
    {
      name: "mode",
      label: "使用方式",
      type: "select",
      options: [
        { label: "平台助手", value: "platform" },
        { label: "我的密钥", value: "byok" },
        { label: "自带 Agent", value: "external" },
      ],
      required: true,
    },
    {
      name: "status",
      label: "状态",
      type: "select",
      options: [
        { label: "执行中", value: "running" },
        { label: "已完成", value: "completed" },
        { label: "失败", value: "failed" },
      ],
      required: true,
    },
    {
      name: "input",
      label: "灵感输入",
      type: "json",
      required: true,
      // JSON 的存储类型沿用运行时 Zod 校验推导的契约，避免生成另一套手写字段。
      typescriptSchema: [
        () => ({
          type: "object",
          tsType: 'import("@cfp/hello-agent-contracts").Inspiration',
        }),
      ],
      admin: { components: { Cell: "/src/cms/admin-cells#InputCell" } },
    },
    {
      name: "greeting",
      label: "吉祥话",
      type: "textarea",
      admin: { components: { Cell: "/src/cms/admin-cells#GreetingCell" } },
    },
    { name: "association", label: "联想依据", type: "textarea" },
    { name: "approach", label: "回应视角", type: "text" },
    {
      name: "knowledgeEvidence",
      type: "ui",
      admin: {
        components: {
          Field: "/src/cms/knowledge-fields#TurnKnowledgeEvidence",
        },
      },
    },
    {
      name: "artifacts",
      label: "回应作品",
      type: "json",
      typescriptSchema: [
        () => ({
          type: "object",
          tsType: 'import("@cfp/hello-agent-protocol").Artifact[] | null',
        }),
      ],
    },
    { name: "imageGeneration", label: "图片生成任务", type: "json", admin: { readOnly: true }, typescriptSchema: [() => ({ type: "object", tsType: 'import("./images/service").ImageState | null' })] },
    { name: "model", label: "模型或外部声明", type: "text" },
    { name: "promptVersion", label: "提示词版本", type: "text" },
    { name: "error", label: "安全错误信息", type: "text" },
    { name: "durationMs", label: "耗时（毫秒）", type: "number" },
  ]),
  owned("adk-sessions", "ADK 会话", [
    {
      name: "key",
      label: "执行会话标识",
      type: "text",
      unique: true,
      required: true,
    },
    {
      name: "snapshot",
      label: "状态与事件",
      type: "json",
      required: true,
      // SDK 执行快照只由内部 SessionService 写入，复用 SDK 类型，不手写副本或强转读取结果。
      typescriptSchema: [
        () => ({ type: "object", tsType: 'import("@google/adk").Session' }),
      ],
      admin: { components: { Cell: "/src/cms/admin-cells#ExecutionCell" } },
    },
  ]),
  owned("session-locks", "会话执行锁", [
    {
      name: "sessionKey",
      label: "产品会话标识",
      type: "text",
      unique: true,
      required: true,
    },
    { name: "expiresAt", label: "失效时间", type: "date", required: true },
  ]),
  owned("media", "灵感图片", [
    { name: "generationKey", type: "text", unique: true, admin: { hidden: true } },
    { name: "generation", label: "生成来源", type: "json", admin: { readOnly: true }, typescriptSchema: [() => ({ type: "object", tsType: '{ turnId: number; provider: string; model: string; taskId: string } | null' })] },
    { name: "safetyReview", label: "图片审核", type: "json", admin: { readOnly: true }, typescriptSchema: [() => ({ type: "object", tsType: 'import("./operations/image-review").ImageReview | null' })] },
    {
      name: "mimeType",
      label: "图片与格式",
      type: "text",
      required: true,
      admin: { components: { Cell: "/src/cms/admin-cells#MediaCell" } },
    },
    {
      name: "base64",
      label: "历史图片内容（迁移后清空）",
      type: "textarea",
      // 不使用普通文本默认的 40,000 字符限制；仍受图片专属上限约束。
      maxLength: MAX_STORED_IMAGE_BASE64_LENGTH,
      admin: { hidden: true },
    },
    {
      name: "object",
      label: "OSS 存储引用",
      type: "json",
      typescriptSchema: [
        () => ({
          type: "object",
          tsType: 'import("./domain/media-policy").ImageReference | null',
        }),
      ],
      admin: {
        readOnly: true,
        description: "保存私有对象的位置、大小和校验值，不是公开下载地址。",
      },
    },
  ]),
];
