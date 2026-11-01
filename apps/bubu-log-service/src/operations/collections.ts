import { sql } from "@payloadcms/db-sqlite";
import { APIError, type CollectionConfig, type Payload, type PayloadRequest } from "payload";
import { opsAdmin, readOpsUser } from "./access";
import { appendOpsAudit } from "./audit";
import { operationSummary, safeDocument } from "./redaction";

const bootstrapContext = Symbol("bubu-ops-local-bootstrap");
const deny = () => false;
const labels: Record<string, string> = { "care-events": "照护事件", "care-operations": "录入回执", "care-revisions": "修订记录", "care-questions": "待补充事项", "care-source-links": "来源关联", "care-attachments": "私有附件", "care-batches": "采集批次", "care-sync": "采集进度", "care-messages": "采集消息" };

export const operationsCollections: CollectionConfig[] = [
  {
    // The pre-ops generated auth tables are retained during upgrades but never become an ops login.
    slug: "users", auth: true, admin: { hidden: true },
    access: { admin: deny, create: deny, read: deny, update: deny, delete: deny }, fields: [],
    hooks: { beforeOperation: [({ operation }) => { if (["login", "refresh", "forgotPassword", "resetPassword", "unlock"].includes(operation)) throw new APIError("此账号入口已关闭。", 403); }], beforeLogin: [() => { throw new APIError("请使用运营账号登录。", 403); }], beforeChange: [() => { throw new APIError("此账号入口已关闭。", 403); }] },
  },
  {
    slug: "ops-requests", admin: { hidden: true }, timestamps: true,
    access: { read: deny, create: deny, update: deny, delete: deny },
    fields: [{ name: "id", type: "text" }, { name: "key", type: "text", required: true, unique: true }, { name: "babyId", type: "text", required: true, index: true }, { name: "value", type: "json", required: true }],
  },
  {
  slug: "ops-users", labels: { singular: "运营账号", plural: "运营账号" },
  auth: { tokenExpiration: 8 * 3600, maxLoginAttempts: 5, lockTime: 15 * 60_000, cookies: { sameSite: "Strict" }, useAPIKey: false, removeTokenFromResponses: true },
  admin: { useAsTitle: "email", group: "运营管理", defaultColumns: ["email", "role", "active", "babyIds"] },
  access: {
    admin: async ({ req }) => { try { await readOpsUser(req.payload, req.user, req); return true; } catch { return false; } },
    create: ({ req }) => opsAdmin(req.payload, req.user, req),
    read: async ({ req }) => { try { const user = await readOpsUser(req.payload, req.user, req); return user.role === "administrator" ? true : { id: { equals: user.id } }; } catch { return false; } },
    update: ({ req }) => opsAdmin(req.payload, req.user, req), delete: ({ req }) => opsAdmin(req.payload, req.user, req),
  },
  fields: [
    { name: "role", label: "角色", type: "select", required: true, defaultValue: "auditor", options: [{ label: "管理员", value: "administrator" }, { label: "运营", value: "operator" }, { label: "审阅", value: "auditor" }] },
    { name: "active", label: "启用", type: "checkbox", defaultValue: true, required: true },
    { name: "babyIds", label: "明确授权的宝宝 ID", type: "text", hasMany: true, admin: { description: "所有角色（包括管理员）只能访问这里列出的宝宝。空列表不授予任何家庭数据权限。" } },
  ],
  hooks: {
    beforeOperation: [({ operation }) => {
      if (operation === "forgotPassword" || operation === "resetPassword") throw new APIError("请联系管理员在运营账号页面重设密码。", 403);
    }],
    afterOperation: [({ operation, result }) => {
      if (operation === "login" || operation === "refresh") return { ...result, user: safeDocument(result.user) };
      return result;
    }],
    beforeChange: [async ({ data, req, operation, originalDoc }) => {
      const bootstrap = req.context[bootstrapContext as unknown as string] === true;
      // Payload's /first-register bypasses collection create access: this hook is mandatory.
      if (!bootstrap && !await opsAdmin(req.payload, req.user, req)) throw new APIError("运营账号只能由管理员创建或修改。", 403);
      if (bootstrap && (operation !== "create" || (await req.payload.count({ collection: "ops-users", overrideAccess: true, req })).totalDocs !== 0)) throw new APIError("初始化只能创建首位管理员。", 409);
      if (data.babyIds) {
        if (!Array.isArray(data.babyIds) || data.babyIds.some((id: unknown) => typeof id !== "string" || !id.trim() || id.trim().length > 200)) throw new APIError("宝宝范围必须是有效 ID 列表。", 400);
        data.babyIds = [...new Set(data.babyIds.map((id: string) => id.trim()))];
      }
      if (originalDoc?.role === "administrator" && originalDoc.active === true && (data.role && data.role !== "administrator" || data.active === false)) await preventLastAdmin(req, originalDoc.id);
      return data;
    }],
    beforeDelete: [async ({ id, req }) => {
      if (!await opsAdmin(req.payload, req.user, req)) throw new APIError("只有管理员可删除运营账号。", 403);
      const doc = await req.payload.findByID({ collection: "ops-users", id, overrideAccess: true, req });
      if (doc.role === "administrator" && doc.active === true) await preventLastAdmin(req, id);
    }],
    beforeLogin: [({ user }) => { if (user.active !== true) throw new APIError("此运营账号已停用。", 403); return user; }],
    afterLogin: [async ({ user, req }) => { await appendOpsAudit(req.payload, { actorId: user.id, action: "ops.login", reason: "运营登录" }, req); return user; }],
    afterRead: [({ doc, overrideAccess }) => overrideAccess ? doc : safeDocument(doc)],
    afterChange: [async ({ doc, req, operation, previousDoc }) => { await appendOpsAudit(req.payload, { actorId: req.user?.id || doc.id, action: `ops.account.${operation}`, reason: "管理员账号配置", target: { id: doc.id, role: doc.role, active: doc.active, babyIds: doc.babyIds, previous: previousDoc ? { role: previousDoc.role, active: previousDoc.active, babyIds: previousDoc.babyIds } : undefined } }, req); return doc; }],
    afterDelete: [async ({ id, req, doc }) => { await appendOpsAudit(req.payload, { actorId: req.user?.id || id, action: "ops.account.delete", reason: "管理员删除账号", target: { id } }, req); return doc; }],
  },
}];
async function preventLastAdmin(req: PayloadRequest, id: number | string): Promise<void> {
  const others = await req.payload.count({ collection: "ops-users", where: { and: [{ role: { equals: "administrator" } }, { active: { equals: true } }, { id: { not_equals: id } }] }, overrideAccess: true, req });
  if (!others.totalDocs) throw new APIError("不能删除、停用或降权最后一位管理员。", 409);
}
/** Database triggers also cover two concurrent admin requests after their beforeChange checks. */
export async function installOpsConstraints(payload: Payload): Promise<void> {
  const db = payload.db as unknown as { drizzle: { run: (query: ReturnType<typeof sql>) => Promise<unknown> } };
  await db.drizzle.run(sql`CREATE TRIGGER IF NOT EXISTS ops_keep_last_admin_update BEFORE UPDATE ON ops_users WHEN OLD.role = 'administrator' AND OLD.active = 1 AND (NEW.role != 'administrator' OR NEW.active != 1) AND (SELECT count(*) FROM ops_users WHERE role = 'administrator' AND active = 1 AND id != OLD.id) = 0 BEGIN SELECT RAISE(ABORT, 'LAST_OPS_ADMIN'); END;`);
  await db.drizzle.run(sql`CREATE TRIGGER IF NOT EXISTS ops_keep_last_admin_delete BEFORE DELETE ON ops_users WHEN OLD.role = 'administrator' AND OLD.active = 1 AND (SELECT count(*) FROM ops_users WHERE role = 'administrator' AND active = 1 AND id != OLD.id) = 0 BEGIN SELECT RAISE(ABORT, 'LAST_OPS_ADMIN'); END;`);
}
export async function bootstrapOpsAdmin(payload: Payload, input: { email: string; password: string; babyIds: string[] }) {
  if (input.password.length < 14) throw new Error("初始管理员密码至少 14 位。");
  return payload.create({ collection: "ops-users", data: { ...input, role: "administrator", active: true }, overrideAccess: true, context: { [bootstrapContext]: true } });
}
/** Facts remain API-write-protected. Native Admin exposes a scoped projection of the same row. */
export function decorateCollections(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((collection): CollectionConfig => {
    if (collection.slug === "ops-users") return collection;
    if (!labels[collection.slug]) return { ...collection, admin: { ...collection.admin, hidden: true } };
    return {
      ...collection,
      labels: { singular: labels[collection.slug]!, plural: labels[collection.slug]! },
      admin: { ...collection.admin, group: "照护核对", useAsTitle: "id", defaultColumns: ["id", "babyId", "updatedAt"], description: "只读核对。更正、补充或撤销请使用运营操作中的统一 MCP。" },
      access: { create: deny, update: deny, delete: deny, read: async ({ req }) => { try { const user = await readOpsUser(req.payload, req.user, req); return user.babyIds.length ? { babyId: { in: user.babyIds } } : false; } catch { return false; } } },
      fields: [
        ...collection.fields.map(field => {
          if (field.type === "json" && field.name === "value") return { ...field, admin: { ...field.admin, hidden: true }, access: { ...field.access, read: deny } };
          if (field.type === "text" && field.name === "key") return { ...field, admin: { ...field.admin, hidden: true }, access: { ...field.access, read: deny } };
          return field;
        }),
        { name: "details", label: "只读摘要", type: "json", virtual: true, admin: { readOnly: true } },
      ],
      hooks: {
        ...collection.hooks,
        beforeRead: [...collection.hooks?.beforeRead || [], ({ doc, overrideAccess }) => overrideAccess ? doc : { ...doc, details: operationSummary(doc.value || {}) }],
        afterRead: [...collection.hooks?.afterRead || [], ({ doc, overrideAccess }) => {
          if (overrideAccess) return doc;
          const result = safeDocument(doc); delete result.key; delete result.value; return result;
        }],
        afterOperation: [...collection.hooks?.afterOperation || [], async ({ operation, result, req, overrideAccess }) => {
          if (overrideAccess || (operation !== "find" && operation !== "findByID")) return result;
          const user = await readOpsUser(req.payload, req.user, req);
          const docs = operation === "find" ? result.docs : result ? [result] : [];
          const groups = new Map<string, Array<string | number>>();
          for (const doc of docs) groups.set(String(doc.babyId), [...groups.get(String(doc.babyId)) || [], doc.id]);
          // One sequential audit per baby avoids independent writes in parallel afterRead hooks.
          for (const [babyId, ids] of groups) await appendOpsAudit(req.payload, { actorId: user.id, babyId, action: "ops.metadata.read", reason: "Payload 原生元数据核对", target: { collection: collection.slug, ids } }, req);
          return result;
        }],
      },
    };
  });
}
