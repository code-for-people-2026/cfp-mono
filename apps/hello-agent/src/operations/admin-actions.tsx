"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { operationLabels, recordURL } from "./admin-presentation";
import "./admin-actions.css";

type Row = { id: number; [key: string]: unknown };
type Field = { key: string; label: string; type?: "number" | "words" | "textarea"; options?: [string, string][]; optional?: boolean; min?: number; max?: number };
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
  const valueFor = (field: Field) => values[field.key] ?? field.options?.[0]?.[0] ?? "";
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
      number("feedbackHours", "处置后反馈时限（小时）", 1, 168), number("evidenceDays", "最小证据留存（天）", 1, 365),
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

export function CaseActions({ row, administrator, userId }: { row: Row; administrator: boolean; userId: number | string }) {
  const [evidence, setEvidence] = useState<Record<string, unknown>>();
  const own = row.assignedTo === userId;
  const actions: [string, string][] = [];
  if (row.status !== "resolved" && (!row.assignedTo || own || administrator)) actions.push(["claim", "领取并受理"]);
  if (own || administrator) actions.push(["review", "转交独立复核"]);
  if (own && ["in_progress", "review"].includes(String(row.status))) {
    actions.push(["dismiss", "无需限制，结案"]);
    if (row.turnId || row.mediaId) actions.push(["quarantine", "隔离已存内容并结案"], ["restore", "恢复原案件隔离的内容"]);
    if (administrator) actions.push(["restrict", "限制该身份生成"], ["unrestrict", "解除原案件生成限制"]);
  }
  if (own && row.status === "resolved") actions.push(["feedback", "向本人提供处理结果"]);
  if (administrator) actions.push(row.legalHold ? ["release_hold", "解除暂缓清理"] : ["hold", "基于具体依据暂缓证据清理"]);
  return <div>
    <ActionPanel title="按需查看最小证据" fields={[{ ...reason, max: 500 }]} button="查看证据并留痕" disabled={!own && !administrator} submit={async (body) => {
      setEvidence(undefined); setEvidence(await request(`cases/${row.id}/evidence`, body));
    }}><p>{!own && !administrator ? "请先领取案件，再按需查看证据。" : "访问须填写具体理由，访问记录会写入审计。"}</p></ActionPanel>
    {evidence && <div className="safety-evidence" role="status">{evidence.unavailable ? String(evidence.message) : <>
      <h3>最小证据片段</h3><pre>{String(evidence.excerpt || "无可用正文")}</pre>
      <small>原始字符数：{String(evidence.originalLength)} · SHA-256：{String(evidence.digest)}</small>
    </>}</div>}
    {actions.length > 0 && <ActionPanel title="案件处理" fields={[
      { key: "action", label: "处理动作", options: actions }, reason,
      { key: "reply", label: "向本人反馈的结果", type: "textarea", min: 5, max: 1000, optional: true },
      { key: "severity", label: "受理时更新严重程度", optional: true, options: [["", "保持当前严重程度"], ...["normal", "high", "urgent"].map((key): [string, string] => [key, operationLabels[key]])] },
    ]} button="执行案件处理" submit={async (body) => {
      await request(`cases/${row.id}/action`, { ...body, revision: row.revision });
      window.location.reload();
    }}><p>当前状态：{operationLabels[String(row.status)]}。处置与证据访问都沿用服务器权限校验；申诉和复核须由原处置人以外的人员完成。</p></ActionPanel>}
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
