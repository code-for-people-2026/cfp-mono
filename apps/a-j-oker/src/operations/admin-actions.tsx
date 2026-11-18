"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { caseOperationLabel, operationLabels, recordURL } from "./admin-presentation";
import "./admin-actions.css";

type Row = { id: number; [key: string]: unknown };
type Field = { key: string; label: string; type?: "number" | "words" | "textarea"; options?: [string, string][]; optional?: boolean; initial?: string; min?: number; max?: number };
const reason: Field = { key: "reason", label: "具体理由（至少 8 个字）", type: "textarea", min: 8, max: 1000 };
const number = (key: string, label: string, min = 1, max?: number): Field => ({ key, label, type: "number", min, max });

async function request(path: string, body: Record<string, unknown>): Promise<Row> {
  const response = await fetch(`/api/operations/${path}`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "操作失败，请刷新后重试");
  return result;
}

// Payload owns the surrounding form. These controls must never nest a form or
// submit the resource's generic PATCH endpoint, whose permissions stay read-only.
function ActionPanel({ title, fields, button, submit, children, disabled = false }: {
  title: string; fields: Field[]; button: string; submit: (data: Record<string, unknown>) => Promise<void>;
  children?: ReactNode; disabled?: boolean;
}) {
  const prefix = useId();
  const root = useRef<HTMLFieldSetElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const valueFor = (field: Field) => values[field.key] ?? field.options?.[0]?.[0] ?? field.initial ?? "";
  async function send() {
    if (!root.current || busy || disabled) return;
    for (const control of root.current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")) {
      if (!control.reportValidity()) return;
    }
    const body: Record<string, unknown> = {};
    for (const field of fields) {
      const value = valueFor(field).trim();
      if (!value && field.optional) continue;
      body[field.key] = field.type === "number" ? Number(value) : field.type === "words" ? value.split(/\n|,/).map((word) => word.trim()).filter(Boolean) : value;
    }
    setBusy(true); setError("");
    try { await submit(body); } catch (error) { setError(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }
  return <fieldset className="safety-actions" ref={root} disabled={busy || disabled} onKeyDown={(event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  }}>
    <legend>{title}</legend>{children}
    <div className="safety-actions__fields">{fields.map((field) => {
      const id = `${prefix}-${field.key}`;
      const common = { id, value: valueFor(field), required: !field.optional, onChange: (event: { target: { value: string } }) => setValues({ ...values, [field.key]: event.target.value }) };
      return <div key={field.key}><label htmlFor={id}>{field.label}{field.optional ? "（可选）" : ""}</label>
        {field.options ? <select {...common}>{field.options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          : field.type === "textarea" || field.type === "words" ? <textarea {...common} minLength={field.min} maxLength={field.max} rows={3} />
          : <input {...common} type={field.type === "number" ? "number" : "text"} min={field.min} max={field.max} step={field.type === "number" ? 1 : undefined} />}
      </div>;
    })}</div>
    <button type="button" onClick={() => void send()} disabled={busy || disabled}>{busy ? "执行中…" : button}</button>
    {error && <p role="alert" className="safety-actions__error">{error}</p>}
  </fieldset>;
}

export function CreateOperation({ kind, admin }: { kind: "rules" | "settings" | "items"; admin: string }) {
  const configs = {
    rules: { title: "新增规则版本", slug: "safety-rules", fields: [
      { key: "version", label: "新版本号" },
      { key: "mode", label: "文本审核覆盖", options: [["all", "全量语境复核"], ["keywords", "关键词召回（存在漏检区间）"]] },
      { key: "extraWords", label: "追加召回词，每行一个", type: "words", optional: true },
      { key: "ignoredWords", label: "忽略召回词，每行一个", type: "words", optional: true }, reason,
    ] },
    settings: { title: "新增运营安排版本", slug: "safety-settings", fields: [
      number("acceptanceHours", "受理时限（小时）", 1, 168), number("resolutionHours", "处置时限（小时）", 1, 720),
      number("feedbackHours", "处置后反馈时限（小时）", 1, 168), { ...number("evidenceDays", "证据留存天数（1—30）", 1, 30), initial: "30" },
      { key: "staffing", label: "已落实的值班安排", type: "textarea", min: 5, max: 500 },
      { key: "retentionBasis", label: "留存用途与具体依据", type: "textarea", min: 10, max: 1000 }, reason,
    ] },
    items: { title: "新增评测题目版本", slug: "safety-evaluation-items", fields: [
      { key: "suite", label: "题库与版本" }, { key: "key", label: "题号" }, { key: "category", label: "风险类别" },
      { key: "input", label: "测试输入（使用合成材料）", type: "textarea", max: 4000 },
      { key: "expected", label: "人工判定标准", type: "textarea", min: 5, max: 1000 },
      { key: "provenance", label: "来源、许可与使用依据", type: "textarea", min: 5, max: 500 },
    ] },
  } satisfies Record<string, { title: string; slug: string; fields: Field[] }>;
  const config = configs[kind];
  return <details className="safety-create"><summary>{config.title}</summary>
    <ActionPanel title={config.title} fields={config.fields} button="保存新版本" submit={async (body) => {
      const result = await request(kind, kind === "rules" ? { extraWords: [], ignoredWords: [], ...body } : body);
      window.location.assign(recordURL(config.slug, result.id, admin));
    }}><p>保存会追加记录并留下审计，已有版本保持原状。</p></ActionPanel>
  </details>;
}

export function CaseActions({ row, administrator, appealReviewer = false, userId, admin }: { row: Row; administrator: boolean; appealReviewer?: boolean; userId: number | string; admin: string }) {
  const [emergency, setEmergency] = useState<Row>();
  const [evidence, setEvidence] = useState<Record<string, unknown>>();
  const own = row.assignedTo === userId;
  const ageReview = row.stage === "age_review";
  const ownResolved = appealReviewer && row.status === "resolved" && row.lastReviewer != null && String(row.lastReviewer) === String(userId);
  const appealEligible = !appealReviewer || row.parentId != null || row.status === "review" || ownResolved;
  const ageAppeal = appealReviewer && (row.parentId != null || row.lastReviewer != null);
  const actions: [string, string][] = [];
  if (administrator && row.retentionPurgedAt && row.retentionReviewNeeded) actions.push(["review_purged_restriction", "新建独立生效限制复核"]);
  if (!row.retentionPurgedAt && row.status !== "resolved" && appealEligible && (!row.assignedTo || own || administrator)) actions.push(["claim", "领取并受理"]);
  if (!row.retentionPurgedAt && appealEligible && (!appealReviewer || row.status !== "resolved" || row.parentId != null) && (own || administrator)) actions.push(["review", "转交独立复核"]);
  if (!row.retentionPurgedAt && own && appealEligible && ["in_progress", "review"].includes(String(row.status))) {
    if (ageReview && (administrator || ageAppeal)) {
      actions.push(["permit_age_reverification", "批准发起一次新的本人核验"], ["maintain_age_restriction", "维持年龄限制"], ["restore_age_access", "直接解除年龄限制"]);
    } else if (!ageReview && row.source === "moderation" && ["input", "output"].includes(String(row.stage)) && !row.mediaId)
      actions.push(["reject", "拒绝未生成请求并结案"]);
    if (!ageReview) {
      actions.push(["dismiss", "无需限制，结案"]);
      if (row.turnId || row.mediaId) actions.push(["quarantine", "隔离已存内容并结案"], ["restore", "恢复原案件隔离的内容"]);
      actions.push(...(administrator
        ? [["restrict", "限制该身份生成"], ["unrestrict", "解除原案件生成限制"]] as [string, string][]
        : appealReviewer && appealEligible ? [["unrestrict", "解除原案件生成限制"]] as [string, string][] : []));
    }
  }
  if (!row.retentionPurgedAt && own && appealEligible && row.status === "resolved") actions.push(["feedback", "向本人提供处理结果"]);
  if (administrator && !row.retentionPurgedAt) {
    actions.push(["extend_retention", "指定或延长有限留存期限"]);
    if (row.retentionReviewNeeded && row.retainUntil) actions.push(["activate_retention", "确认历史迁移期限并启动到期清理"]);
    actions.push(row.legalHold ? ["release_hold", "解除暂缓清理"] : ["hold", "基于具体依据暂缓证据清理"]);
  }
  return <div>
    {!row.retentionPurgedAt && row.severity === "urgent" && row.status !== "resolved" && <ActionPanel title="紧急人工联络" fields={[{ ...reason, max: 500 }, { key: "result", label: "操作", options: [["read", "读取有效授权的紧急联系人"], ["contacted", "登记：已人工联系"], ["unreachable", "登记：人工联系未接通"]] }]} button="执行并记入审计" disabled={!own && !administrator} submit={async (body) => {
      setEmergency(undefined); setEmergency(await request(`cases/${row.id}/emergency-contact`, body));
    }}><p>孙逢负责人工处置。不提供自动拨号；飞书通知只有完成配置及实际收件确认后才启用。消息发送成功不代表人工已读或受理，须本人查看队列并实际联络。只在必要的紧急处置中使用联系人资料。</p></ActionPanel>}
    {emergency && <div role="status"><p>{String(emergency.notice)}</p>{emergency.contact ? <p>{String((emergency.contact as { name: string }).name)} · {String((emergency.contact as { phone: string }).phone)}</p> : <p>未展示联系人资料。</p>}</div>}
    <ActionPanel title="按需查看最小证据" fields={[{ ...reason, max: 500 }]} button="查看证据并留痕" disabled={(appealReviewer && !appealEligible) || (!own && !administrator)} submit={async (body) => {
      setEvidence(undefined); setEvidence(await request(`cases/${row.id}/evidence`, body));
    }}><p>{appealReviewer ? (appealEligible ? "独立申诉复核员只能访问申诉或待复核案件的必要证据。" : "该案件不是申诉或待复核案件，独立申诉复核员不能领取或查看证据。") : !own && !administrator ? "请先领取案件，再按需查看证据。" : "访问须填写具体理由，访问记录会写入审计。"}</p></ActionPanel>
    {evidence && <div className="safety-evidence" role="status">{evidence.unavailable ? String(evidence.message) : <>
      {evidence.provenance && <><h3>证据来源说明</h3><p>{String(evidence.provenance)}</p></>}
      {evidence.conversation ? <>
        <h3>触发对话快照（按时间顺序）</h3>
        <ol>{((evidence.conversation as { messages?: { role: string; text: string; trigger?: boolean; truncated?: boolean; turnId?: number; timestamp?: string }[] }).messages || []).map((message, index) =>
          <li key={index} className={message.trigger ? "safety-evidence__trigger" : undefined}><strong>{message.role === "user" ? "用户" : "助手"}{message.trigger ? "（触发消息）" : ""}</strong>{(message.turnId || message.timestamp) && <small>{message.turnId ? `轮次 #${message.turnId}` : ""}{message.turnId && message.timestamp ? " · " : ""}{message.timestamp || ""}</small>}<pre>{message.text}{message.truncated ? "\n[此消息已截断]" : ""}</pre></li>)}</ol>
        {(() => { const truncation = (evidence.conversation as { truncation?: { omittedTurns?: number; anyTextTruncated?: boolean } }).truncation; return truncation && (truncation.omittedTurns || truncation.anyTextTruncated) ? <p>快照有界：更早的 {truncation.omittedTurns || 0} 个已完成轮次未纳入；过长文本会在对应消息中明确标注截断。</p> : null; })()}
      </> : <><h3>原始证据片段</h3><p>{String(evidence.excerpt || "未保存证据片段")}</p><p>{String(evidence.transcriptUnavailable || "此证据不包含对话快照。")}</p></>}
      <small>原始字符数：{String(evidence.originalLength)} · SHA-256：{String(evidence.digest)}</small>
    </>}</div>}
    {actions.length > 0 && <ActionPanel title="案件处理" fields={[
      { key: "action", label: "处理动作", options: actions }, reason,
      { key: "reply", label: "向本人反馈的结果", type: "textarea", min: 5, max: 1000, ...(ageReview ? {} : { optional: true }) },
      { key: "retainUntil", label: "留存至（指定/延长时必填，ISO 时间）", optional: true },
      { key: "holdReviewAt", label: "法律留存复核日（暂缓时必填，ISO 时间）", optional: true },
      { key: "severity", label: "受理时更新严重程度", optional: true, options: [["", "保持当前严重程度"], ...["normal", "high", "urgent"].map((key): [string, string] => [key, operationLabels[key]])] },
    ]} button="执行案件处理" submit={async (body) => {
      const result = await request(`cases/${row.id}/action`, { ...body, revision: row.revision });
      if (body.action === "review_purged_restriction" && result.id !== row.id) window.location.assign(recordURL("safety-cases", result.id, admin));
      else window.location.reload();
    }}><p>当前状态：{operationLabels[String(row.status)]}。来源：{caseOperationLabel(String(row.source), String(row.stage))}。{row.retentionPurgedAt ? row.retentionReviewNeeded ? "案件自由文本与证据已清理，但限制仍生效；管理员可新建独立复核案件，旧案不会重新写入自由文本。" : "案件自由文本与证据已清理；如需后续处置，必须新建独立案件。" : row.retentionReviewNeeded ? "本案件已明确标记为历史留存迁移待复核；有期限时须确认后才启动到期清理。" : ""}{row.legalHold ? ` 法律留存复核日：${String(row.holdReviewAt || "未设置（须立即补充）")}。` : ` 证据期限：${String(row.retainUntil || "待复核")}。`}{appealReviewer ? (appealEligible ? "独立申诉复核员可处理已有父案、待复核案件或本人刚完成的复核；年龄动作只限已有人工决定的年龄复核（包括申诉）。" : "独立申诉复核员只能处理已有父案、待复核案件或本人刚完成的复核；不能作出首次决定、新增生成限制或管理账号、规则、留存。") : ageReview ? " 年龄复核可选择允许本人重新核验、维持限制，或由系统管理员直接解除年龄限制。首次年龄决定仍仅限系统管理员；独立申诉复核员只能处理已有人工决定的年龄复核（包括申诉）。直接解除会记录人工核验来源，不冒充供应商结果，也不解除内容限制；必须填写理由和给本人的结果。" : "处置与证据访问都沿用服务器权限校验；申诉和复核须由原处置人以外的人员完成。"}</p></ActionPanel>}
  </div>;
}

export function RuleActions({ id, regressions, admin }: { id: number; regressions: Row[]; admin: string }) {
  return <>
    <ActionPanel title="执行本版本效果回归" fields={[]} button="实际执行回归" submit={async () => {
      const row = await request(`rules/${id}/regress`, {});
      window.location.assign(recordURL("safety-regressions", row.id, admin));
    }}><p>使用实际审核模型，可能产生费用；12 个小样本检查不代表正式语义安全合格。</p></ActionPanel>
    <ActionPanel title="发布或回退到本版本" fields={[
      { key: "regressionId", label: "本版本最近 7 天通过的回归", options: regressions.map((r) => [String(r.id), `#${r.id} · ${r.createdAt}`]) }, reason,
    ]} disabled={regressions.length === 0} button="发布此版本" submit={async (body) => {
      const row = await request(`rules/${id}/release`, { ...body, regressionId: Number(body.regressionId) });
      window.location.assign(recordURL("safety-releases", row.id, admin));
    }}><p>{regressions.length ? "发布与回退均须填写理由，并通过当前词库与提示词版本检查。" : "尚无本版本最近 7 天通过的回归，不能发布或回退。"}</p></ActionPanel>
  </>;
}

export function RunEvaluation({ itemId, parentId, admin }: { itemId: number; parentId?: number; admin: string }) {
  return <ActionPanel title={parentId ? "追加整改复测" : "运行此评测题目"} fields={parentId ? [{ key: "remediation", label: "整改说明（至少 8 个字）", type: "textarea", min: 8, max: 1000 }] : []} button={parentId ? "运行整改复测" : "运行真实应用输入输出"} submit={async (body) => {
    const row = await request(`items/${itemId}/run`, { ...body, ...(parentId ? { parentId } : {}) });
    window.location.assign(recordURL("safety-evaluations", row.id, admin));
  }}><p>使用配置的真实模型，可能产生费用；运行结果保存后仍需人工评阅。</p></ActionPanel>;
}

export function JudgeEvaluation({ row }: { row: Row }) {
  if (row.judgment !== "pending") return <p>人工判定已保存。需要调整结论时，请填写整改说明并追加复测。</p>;
  const options: [string, string][] = [["inconclusive", "证据不足"]];
  if (["completed", "blocked"].includes(String(row.state))) options.push(["fail", "失败，需整改"], ["pass", "本项符合判定标准"]);
  return <ActionPanel title="人工评阅本次运行" fields={[{ key: "judgment", label: "人工判定", options }, reason]} button="保存人工判定" submit={async (body) => {
    await request(`evaluations/${row.id}/judge`, body); window.location.reload();
  }}><p>只有已完成运行或被审核阻断的结果可以判断通过或失败。未执行成功只能记为证据不足。</p></ActionPanel>;
}
