import { APIError, type CollectionConfig, type Field, type TextField, type NumberField } from "payload";
import { canAudit, canReview, internal, isAdministrator } from "./policy";
import { adminPermissionAudit } from "./audit";
import { options } from "./admin-presentation";
const text = (name: string, label: string, required = false): TextField => ({ name, label, type: "text", required });
const number = (name: string, label: string, required = false): NumberField => ({ name, label, type: "number", required });
const date = (name: string, label: string): Field => ({ name, label, type: "date", index: true });
const json = (name: string, label: string): Field => ({ name, label, type: "json" });
function collection(slug: string, label: string, fields: Field[], columns: string[], read: "review" | "audit" | "admin" | "private" = "review"): CollectionConfig {
  return {
    slug, lockDocuments: false, disableBulkEdit: true, labels: { singular: label, plural: label }, defaultSort: "-id",
    admin: { group: "内容安全运营", useAsTitle: columns[0], defaultColumns: columns,
      description: "通过本资源的操作区受理、复核、处置或追加版本；原始记录只读。", hidden: read === "private",
      components: read === "private" ? undefined : { beforeListTable: ["/src/operations/admin-components#OperationsListTools"] } },
    access: {
      read: ({ req }) => internal(req) || (read === "private" ? false : read === "admin" ? isAdministrator(req.user) : read === "audit" ? canAudit(req.user) : canReview(req.user)),
      create: ({ req }) => internal(req), update: ({ req }) => internal(req), delete: () => false,
    },
    hooks: {
      beforeChange: [({ req, data, operation }) => {
        if (!internal(req)) throw new APIError("请使用有权限的运营操作入口", 403);
        if (operation === "update" && !["safety-cases", "safety-evidence", "safety-enforcements", "safety-evaluations"].includes(slug))
          throw new APIError("此记录只允许追加新版本", 403);
        return data;
      }],
      beforeDelete: [() => { throw new APIError("安全记录不可直接删除；使用留存清理流程", 403); }],
    },
    fields: [
      ...(["safety-cases", "safety-rules", "safety-regressions", "safety-releases", "safety-evaluation-items", "safety-evaluations"].includes(slug)
        ? [{ name: "operationControls", type: "ui" as const, admin: { components: { Field: "/src/operations/admin-components#OperationsDocumentActions" }, disableListColumn: true } }] : []),
      ...fields,
    ],
  };
}
export const operationsCollections: CollectionConfig[] = [
  collection("safety-cases", "审核案件", [
    { ...text("receipt", "受理编号", true), unique: true }, text("owner", "所属设备身份", true),
    { name: "source", label: "来源", type: "select", options: options(["complaint", "appeal", "moderation", "image"]), required: true },
    { name: "status", label: "状态", type: "select", options: options(["pending", "in_progress", "review", "resolved"]), required: true, index: true },
    { name: "severity", label: "严重程度", type: "select", options: options(["urgent", "high", "normal"]), index: true, required: true },
    text("category", "风险类别", true), text("stage", "审核阶段", true),
    number("sessionId", "祝福会话"), number("turnId", "生成轮次"), number("mediaId", "灵感图片"),
    text("requestId", "请求标识"), number("parentId", "原案件"), number("assignedTo", "负责人账号 ID"),
    number("lastReviewer", "上次处置人"), { ...number("revision", "修订号", true), defaultValue: 0 },
    date("acceptBy", "受理期限"), date("resolveBy", "处置期限"), date("feedbackBy", "反馈期限"),
    date("acceptedAt", "已受理"), date("resolvedAt", "已处置"), date("feedbackAt", "已向本人提供结果"),
    text("ruleVersion", "规则版本"), text("lexiconVersion", "词库版本"), text("modelVersion", "模型版本"),
    text("decision", "自动审核决定"), text("action", "处置动作"), text("reason", "处置理由"),
    { name: "reply", label: "给本人的处理结果", type: "textarea", maxLength: 1000 },
    text("retentionBasis", "留存依据"), date("retainUntil", "证据保留至"),
    { name: "legalHold", label: "暂缓到期清理", type: "checkbox", defaultValue: false }, text("holdReason", "暂缓清理依据"),
  ], ["receipt", "status", "severity", "category", "assignedTo", "acceptBy", "resolveBy", "feedbackBy"]),
  collection("safety-evidence", "受限证据", [number("caseId", "案件", true), text("excerpt", "最小证据片段"), text("digest", "内容摘要哈希", true), number("originalLength", "原始字符数"), date("purgedAt", "已清理"), text("purgeReason", "清理依据")], ["id"], "private"),
  collection("safety-audit", "运营审计", [text("actor", "操作人", true), text("event", "操作", true), text("target", "对象", true), text("reason", "理由", true), json("metadata", "不含正文的变更信息")], ["event", "actor", "target", "createdAt"], "audit"),
  collection("safety-enforcements", "处置执行状态", [
    { ...text("key", "对象键", true), unique: true }, text("owner", "所属设备", true), text("targetType", "对象类型", true),
    number("targetId", "对象 ID"), number("sessionId", "祝福会话"), number("caseId", "来源案件", true),
    { name: "active", label: "生效", type: "checkbox", required: true }, text("reason", "依据", true),
  ], ["key"], "private"),
  collection("safety-settings", "运营安排版本", [
    number("acceptanceHours", "受理时限（小时）", true), number("resolutionHours", "处置时限（小时）", true), number("feedbackHours", "处置后反馈时限（小时）", true), number("evidenceDays", "证据留存（天）", true),
    text("staffing", "真实值班安排", true), text("retentionBasis", "留存依据", true), text("reason", "变更理由", true),
  ], ["id", "staffing", "createdAt"], "admin"),
  collection("safety-rules", "规则与词库版本", [
    { ...text("version", "版本", true), unique: true }, text("reason", "变更理由", true), text("mode", "覆盖范围", true),
    json("extraWords", "追加召回词"), json("ignoredWords", "忽略召回词"), text("lexiconVersion", "上游版本", true), text("lexiconHash", "上游校验", true), text("promptVersion", "审核提示词", true),
  ], ["version", "mode", "reason", "createdAt"], "admin"),
  collection("safety-releases", "规则发布与回退", [number("ruleId", "规则版本 ID", true), number("regressionId", "通过的回归 ID", true), text("reason", "发布或回退理由", true), text("actor", "发布人", true)], ["id", "ruleId", "reason", "createdAt"], "admin"),
  collection("safety-regressions", "规则效果回归", [number("ruleId", "规则版本 ID", true), text("state", "执行结果", true), json("results", "实际逐题结果"), text("actor", "执行人", true), text("suiteVersion", "题库版本", true)], ["id", "ruleId", "state", "createdAt"], "admin"),
  collection("safety-evaluation-items", "版本化评测题目", [text("suite", "题库及版本", true), text("key", "题号", true), text("category", "风险类别", true), text("input", "测试输入", true), text("expected", "人工判定标准", true), text("provenance", "来源与使用依据", true)], ["suite", "key", "category"], "admin"),
  collection("safety-evaluations", "应用评测与整改复测", [
    number("itemId", "题目 ID", true), number("parentId", "整改前运行"), text("remediation", "整改说明"),
    text("state", "实际运行状态", true), text("input", "实际应用输入", true), json("output", "实际应用输出"),
    text("owner", "隔离评测身份", true), number("turnId", "真实生成轮次"), text("modelVersion", "模型版本"), text("ruleVersion", "规则版本"),
    text("error", "安全错误"), text("judgment", "人工判定"), text("judgmentReason", "判定理由"), text("judge", "评阅人"), date("judgedAt", "评阅时间"),
  ], ["id", "itemId", "state", "judgment", "createdAt"], "admin"),
];
export const adminRoleField: Field = { name: "role", label: "运营权限", type: "select", required: true, defaultValue: "reviewer", options: [
  { label: "系统管理员", value: "administrator" }, { label: "审核运营员", value: "reviewer" }, { label: "审计员", value: "auditor" },
] };
export const adminAuditHook = adminPermissionAudit;
