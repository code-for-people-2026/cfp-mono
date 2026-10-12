import { APIError, type Access, type CollectionConfig } from "payload";
import { PSYCHOLOGY_APPROACHES } from "../agent/psychology";
import { encryptKnowledgeSecret } from "./secret";

const admin: Access = ({ req }) => req.user?.collection === "admins";
const access = { read: admin, create: admin, update: admin, delete: admin };

export const agentCollections: CollectionConfig[] = [
  {
    slug: "agent-configs",
    labels: { singular: "Agent 配置", plural: "Agent 配置" },
    access,
    admin: {
      group: "助手管理",
      useAsTitle: "name",
      defaultColumns: ["name", "key", "enabled", "updatedAt"],
      description:
        "一个心理流派对应一个 subagent；主 Agent 选择专家并整合回复。保存后下一轮对话生效。停用流派不会删除已有聊天。",
    },
    hooks: {
      beforeChange: [
        ({ data, originalDoc, operation }) => {
          if (
            operation === "update" &&
            originalDoc &&
            data.key &&
            data.key !== originalDoc.key
          )
            throw new APIError("流派标识创建后不能修改", 400);
          if ((data.key ?? originalDoc?.key) === "coordinator") {
            if (data.enabled === false)
              throw new APIError("主 Agent 不能停用", 400);
            if (data.knowledgeBases?.length)
              throw new APIError("请将知识库绑定到负责该流派的 subagent", 400);
          }
          return data;
        },
      ],
      beforeDelete: [
        async ({ id, req }) => {
          const doc = await req.payload.findByID({
            collection: "agent-configs",
            id,
            depth: 0,
            req,
          });
          if (doc.key === "coordinator")
            throw new APIError("主 Agent 不能删除", 400);
        },
      ],
    },
    fields: [
      {
        name: "name",
        label: "名称",
        type: "text",
        required: true,
        maxLength: 80,
      },
      {
        name: "key",
        label: "职责 / 心理流派",
        type: "select",
        unique: true,
        required: true,
        options: [
          { label: "主 Agent（协调者）", value: "coordinator" },
          ...Object.entries(PSYCHOLOGY_APPROACHES).map(([value, spec]) => ({
            label: spec.label,
            value,
          })),
        ],
        admin: {
          description:
            "每个流派只允许一个 Agent，创建后不能更改。新增流派需先扩展应用的回应协议。",
        },
      },
      {
        name: "enabled",
        label: "启用",
        type: "checkbox",
        defaultValue: true,
        required: true,
      },
      {
        name: "prompt",
        label: "提示词",
        type: "textarea",
        required: true,
        maxLength: 20000,
        admin: {
          rows: 22,
          description:
            "可调整语气、方法和表单指导。系统仍固定执行权限、危机回应和工具约束。修改不会覆盖历史轮次。",
        },
      },
      {
        name: "knowledgeBases",
        label: "知识库",
        type: "relationship",
        relationTo: "knowledge-bases",
        hasMany: true,
        maxRows: 2,
        admin: {
          condition: (data) => data?.key !== "coordinator",
          description:
            "最多绑定两个。仅咨询这个 subagent 时读取，停用的知识库不会参与。",
        },
      },
    ],
  },
  {
    slug: "knowledge-bases",
    labels: { singular: "知识库", plural: "知识库" },
    access,
    admin: {
      group: "助手管理",
      useAsTitle: "name",
      defaultColumns: ["name", "provider", "enabled", "updatedAt"],
      description:
        "支持直接维护参考资料，或连接 ima。ima 仅接收方法关键词用于搜索，不上传整段聊天或图片；返回片段供专家参考，不作为系统指令。",
    },
    hooks: {
      beforeChange: [
        ({ data, req }) => {
          // The virtual input is never persisted. API callers cannot supply ciphertext.
          delete data.encryptedApiKey;
          if (data.clearApiKey === true) data.encryptedApiKey = null;
          if (typeof data.apiKey === "string" && data.apiKey.trim()) {
            data.encryptedApiKey = encryptKnowledgeSecret(
              data.apiKey.trim(),
              req.payload.secret,
            );
          }
          return data;
        },
      ],
      afterRead: [
        ({ doc, context }) => {
          doc.hasApiKey = Boolean(doc.encryptedApiKey);
          if (context.helloKnowledgeSecrets !== true)
            delete doc.encryptedApiKey;
          delete doc.apiKey;
          delete doc.clearApiKey;
          return doc;
        },
      ],
    },
    fields: [
      {
        name: "name",
        label: "名称",
        type: "text",
        required: true,
        maxLength: 80,
      },
      {
        name: "enabled",
        label: "启用",
        type: "checkbox",
        defaultValue: true,
        required: true,
      },
      {
        name: "provider",
        label: "来源",
        type: "select",
        options: [
          { label: "后台参考资料", value: "inline" },
          { label: "腾讯 ima 知识库", value: "ima" },
        ],
        defaultValue: "inline",
        required: true,
      },
      {
        name: "content",
        label: "参考资料",
        type: "textarea",
        maxLength: 6000,
        admin: {
          rows: 15,
          condition: (data) => data?.provider === "inline",
          description:
            "填写可引用的方法、注意事项和来源。最多 6000 字；随咨询提供给关联的 subagent。",
        },
      },
      {
        type: "collapsible",
        label: "ima 连接设置",
        admin: { condition: (data) => data?.provider === "ima" },
        fields: [
          {
            name: "knowledgeBaseId",
            label: "ima 知识库 ID",
            type: "text",
            maxLength: 256,
            admin: {
              description:
                "填写 ima 中这个知识库的 ID。凭证需有该知识库的读取权限。",
            },
          },
          {
            name: "clientId",
            label: "Client ID",
            type: "text",
            maxLength: 256,
            admin: {
              description:
                "在 ima 的 OpenAPI 配置页（ima.qq.com/agent-interface）获取。",
            },
          },
          {
            name: "apiKey",
            label: "更新 API Key",
            type: "text",
            virtual: true,
            maxLength: 2048,
            admin: {
              readOnly: false,
              autoComplete: "off",
              description: "保存时加密。保存后不回显；留空保留已有密钥。",
            },
          },
          {
            name: "hasApiKey",
            label: "已保存 API Key",
            type: "checkbox",
            virtual: true,
            admin: { readOnly: true },
          },
          {
            name: "clearApiKey",
            label: "清除已有 API Key",
            type: "checkbox",
            virtual: true,
            admin: { readOnly: false },
          },
        ],
      },
      {
        name: "connectionTest",
        type: "ui",
        admin: {
          components: {
            Field: "/src/cms/knowledge-fields#KnowledgeConnectionTest",
          },
        },
      },
      { name: "encryptedApiKey", type: "text", admin: { hidden: true } },
    ],
  },
];
