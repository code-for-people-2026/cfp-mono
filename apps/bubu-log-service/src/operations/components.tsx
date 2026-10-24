"use client";
import { PrivacyOperationsPanel } from "../privacy/OperationsPanel";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./components.css";

type Row = Record<string, unknown>;
type Baby = { id: string; name: string; fullName?: string | null };
type Context = { user: { id: string | number; email: string; role: string; babyIds: string[]; active: boolean }; babies: Baby[]; membership: { configured: boolean }; accountAudit?: Row[] };
type EventSummary = { id: string; version: number; type?: string; startTime?: string; lifecycle: string; projection: string; attachmentIds: string[] };
type Job = { id: string; accountId: string; chatId: string; agentId: string; enabled: boolean; intervalMs: number; lastSuccessAt?: string; processedThrough?: string; nextRunAt?: string; heartbeatAt?: string; failure?: { code: string; at: string; attempts: number }; activeBatchId?: string; pendingMedia?: number; cursor?: Record<string, number>; backfills?: { id: string; state: string; range: { from: string; to: string } }[] };
type Pending = { id: string; kind?: string; eventId?: string; eventIds?: string[]; version?: number; eventVersion?: number; fields?: string[]; conflicts?: { code: string; message?: string }[]; duplicateCandidates?: string[]; sourceId?: string; media?: { index: number; state: string; reason: string }[]; state: string };
type ExpiryAction = "continue" | "pause";
type MembershipOverview = {
  babyId: string; version: number; configured: boolean; status: "free" | "scheduled" | "paused" | "expired"; label: string; message: string;
  startsAt: string | null; endsAt: string | null; entitlements: { chat: boolean; collection: boolean; history: true }; payment: { enabled: false };
  policy: { startsAt: string | null; endsAt: string | null; expiryPolicy: { chat: ExpiryAction; collection: ExpiryAction } | null; paused: boolean };
  changes: { version: number; action: string; reason: string; at: string; actorId: string }[];
};
type Overview = { baby: Baby; grants: { subjectId: string; state: string; permissions: string[]; source: string }[]; bindings: { groupId: string; agentId: string; active: boolean }[]; jobs: Job[]; pending: Pending[]; events: EventSummary[]; audit: Row[]; membership?: MembershipOverview };
type Command = Row & { type: string };
type ActionRequest = { babyId: string; reason: string; requestId: string; command: Command };
type ReadRequest = { babyId: string; reason: string; kind: string; id?: string; before?: unknown; after?: unknown };
type Choice = readonly [string, string];

const labels: Record<string, string> = {
  admin: "管理员", administrator: "管理员", operator: "运营", auditor: "审计只读", active: "有效", revoked: "已撤权", open: "待处理", resolved: "已解决", dismissed: "已关闭",
  candidate: "待补充候选", pending: "待同步", synced: "已同步", conflict: "冲突待核对", retracted: "已撤销", merged: "已合并", saved: "已保存", needs_information: "已保存，仍待补充", pending_projection: "写入待确认", completed: "已完成", queued: "排队中",
  "records:read": "查看记录", "records:write": "记录与更正", "media:read": "查看图片", "media:write": "上传图片", "baby:manage": "管理宝宝", "caregivers:manage": "管理照护授权",
  "ops.login": "运营登录", "ops.account.create": "创建运营账号", "ops.account.update": "修改运营账号", "ops.account.delete": "删除运营账号",
  BREASTFEED: "亲喂", BOTTLE: "瓶喂", PUMP: "吸奶", SLEEP: "睡眠", DIAPER: "尿布", HEAD_LIFT: "抬头", PASSIVE_EXERCISE: "被动操", GAS_EXERCISE: "排气操", BATH: "洗澡", OUTDOOR: "外出", EARLY_EDUCATION: "早教", ROLL_OVER: "翻身", PULL_TO_SIT: "拉坐", SUPPLEMENT: "补充剂", SPIT_UP: "吐奶",
};
const activityChoices: Choice[] = ["BREASTFEED", "BOTTLE", "PUMP", "SLEEP", "DIAPER", "HEAD_LIFT", "PASSIVE_EXERCISE", "GAS_EXERCISE", "BATH", "OUTDOOR", "EARLY_EDUCATION", "ROLL_OVER", "PULL_TO_SIT", "SUPPLEMENT", "SPIT_UP"].map(value => [value, labels[value]!]);
const permissions = ["records:read", "records:write", "media:read", "media:write", "baby:manage", "caregivers:manage"];
const label = (value: unknown) => typeof value === "string" ? labels[value] || value : value == null ? "—" : String(value);
const dateLabel = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
const requestId = () => `ops-${crypto.randomUUID()}`;
const object = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const safeResult = (value: unknown): unknown => Array.isArray(value) ? value.map(safeResult) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !/token|secret|password|credential|session|hash|authorization|inviteCode/i.test(key)).map(([key, item]) => [key, safeResult(item)])) : value;
const stringify = (value: unknown) => JSON.stringify(safeResult(value), null, 2);

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function responseJSON(response: Response): Promise<Row> {
  const data: unknown = await response.json().catch(() => ({}));
  const row = object(data);
  if (!response.ok) throw new RequestError(`${typeof row.code === "string" ? `${row.code} · ` : ""}${typeof row.error === "string" ? row.error : "请求未完成，请核对状态后重试"}`, response.status);
  return row;
}
function Field({ title, children, hint }: { title: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return <div className="bubu-ops__field"><label htmlFor={id}>{title}</label>{children(id)}{hint && <small>{hint}</small>}</div>;
}
function TextField({ title, value, onChange, hint, type = "text", min, max, placeholder }: { title: string; value: string; onChange: (value: string) => void; hint?: string; type?: string; min?: number; max?: number; placeholder?: string }) {
  return <Field title={title} hint={hint}>{id => <input id={id} type={type} value={value} onChange={event => onChange(event.target.value)} min={min} max={max} placeholder={placeholder} autoComplete="off" />}</Field>;
}
function Select({ title, value, onChange, options }: { title: string; value: string; onChange: (value: string) => void; options: Choice[] }) {
  return <Field title={title}>{id => <select id={id} value={value} onChange={event => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>}</Field>;
}
function Panel({ title, children, help, disabled = false }: { title: string; children: ReactNode; help?: string; disabled?: boolean }) {
  return <fieldset className="bubu-ops__panel" disabled={disabled}><legend>{title}</legend>{help && <p className="bubu-ops__muted">{help}</p>}{children}</fieldset>;
}
function Empty({ children = "暂无记录" }: { children?: ReactNode }) { return <p className="bubu-ops__muted">{children}</p>; }
function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <Empty />;
  return <div className="bubu-ops__table"><table><thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
function AccountAudit({ rows }: { rows: Row[] }) {
  const scope = (value: unknown) => Array.isArray(value) ? value.filter(id => typeof id === "string").join("、") || "无宝宝范围" : "未记录";
  return <Panel title="管理员账号审计" help="核对运营登录，以及账号的角色、启停和宝宝范围变更。点击顶部“刷新权限”更新这份记录。">
    <Table headers={["时间", "操作", "操作者", "目标账号 / 配置", "理由"]} rows={rows.map(row => {
      const target = object(row.target), previous = object(target.previous);
      return [dateLabel(String(row.at || row.createdAt || "")), label(row.action || row.kind), label(row.email || row.actorId || row.actor),
        <span key="account">{target.id == null ? "—" : `账号 ${String(target.id)}`}
          {target.role != null && <small>变更后：{label(target.role)} · {target.active === true ? "启用" : "停用"} · {scope(target.babyIds)}</small>}
          {previous.role != null && <small>变更前：{label(previous.role)} · {previous.active === true ? "启用" : "停用"} · {scope(previous.babyIds)}</small>}
        </span>, label(row.reason)];
    })} />
  </Panel>;
}

/** Mounted inside Payload Admin. Payload owns the form and the authentication cookie. */
export function OperationsTools() {
  const [context, setContext] = useState<Context>();
  const [babyId, setBabyId] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/ops/context", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(responseJSON).then(data => {
        if (controller.signal.aborted) return;
        const next = data as unknown as Context;
        setContext(next); setError(""); setBabyId(current => next.babies.some(baby => baby.id === current) ? current : next.babies[0]?.id || "");
      }).catch(cause => { if (!controller.signal.aborted) { setContext(undefined); setBabyId(""); setError(cause instanceof Error ? cause.message : "无法读取运营权限"); } });
    return () => controller.abort();
  }, [reload]);
  function denied() { setContext(undefined); setBabyId(""); setError("登录或宝宝授权已失效。请刷新权限，必要时重新登录。"); }
  return <section className="bubu-ops" aria-label="卜卜日记运营工作区" onKeyDown={event => {
    // Do not submit the surrounding Payload form when entering a field value.
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  }}>
    <div className="bubu-ops__header"><div><h2>卜卜日记 · 运营工作区</h2><p>按宝宝核对授权、采集和待补事项。敏感查看与操作均留下审计。</p></div>
      <button type="button" className="bubu-ops__secondary" onClick={() => { setContext(undefined); setReload(value => value + 1); }}>刷新权限</button></div>
    {error && <p role="alert" className="bubu-ops__error">{error} <a href="/admin/login">运营登录</a></p>}
    {!context && !error && <p role="status">正在核对运营身份…</p>}
    {context && <><div className="bubu-ops__toolbar"><p>{context.user.email} <span className="bubu-ops__badge">{label(context.user.role)}</span></p>
      <Select title="当前宝宝" value={babyId} onChange={setBabyId} options={context.babies.map(baby => [baby.id, `${baby.name} · ${baby.id}`])} /></div>
      {!context.babies.length && <Empty>尚未分配宝宝范围。请由管理员在运营账号中明确授权。</Empty>}
      {context.user.role === "administrator" && <PrivacyOperationsPanel key="account-privacy" />}
      {babyId && context.user.role !== "auditor" && <PrivacyOperationsPanel key={`privacy-${babyId}`} babyId={babyId} />}
      {babyId && <Workspace key={babyId} babyId={babyId} writable={context.user.role !== "auditor"} denied={denied} accountAudit={context.user.role === "administrator" ? context.accountAudit : undefined} />}
      {!babyId && context.user.role === "administrator" && context.accountAudit && <AccountAudit rows={context.accountAudit} />}
      <p className="bubu-ops__footer">服务权益按宝宝共享。{context.membership.configured ? "免费服务配置请在“服务权益”中核对。" : "暂时无法读取服务权益配置。"}微信支付保持关闭。</p>
    </>}
  </section>;
}

function Workspace({ babyId, writable, denied, accountAudit }: { babyId: string; writable: boolean; denied: () => void; accountAudit?: Row[] }) {
  const lifetime = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const [overview, setOverview] = useState<Overview>();
  const [section, setSection] = useState("pending");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<unknown>();
  const [sensitive, setSensitive] = useState<unknown>();
  const [oneTime, setOneTime] = useState<{ title: string; value: string }>();
  const [lastRequest, setLastRequest] = useState<ActionRequest>();
  const [retryAllowed, setRetryAllowed] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const imageRef = useRef("");
  const [selection, setSelection] = useState<{ eventId: string; version: number; pending?: Pending }>({ eventId: "", version: 1 });
  const [selectionRevision, setSelectionRevision] = useState(0);

  function clearImage() { if (imageRef.current) URL.revokeObjectURL(imageRef.current); imageRef.current = ""; setImageUrl(""); }
  async function refresh(signal = lifetime.current?.signal) {
    const data = await responseJSON(await fetch(`/api/ops/overview?babyId=${encodeURIComponent(babyId)}`, { credentials: "same-origin", cache: "no-store", signal }));
    if (!signal?.aborted) setOverview(data as unknown as Overview);
  }
  function handleError(cause: unknown) {
    if (lifetime.current?.signal.aborted) return;
    if (cause instanceof RequestError && [401, 403].includes(cause.status)) {
      setOverview(undefined); setSensitive(undefined); setReceipt(undefined); setOneTime(undefined); clearImage(); denied(); return;
    }
    setError(cause instanceof Error ? cause.message : "操作未完成，请查询原请求");
  }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void refresh(controller.signal).catch(cause => { if (!controller.signal.aborted) handleError(cause); });
    return () => { controller.abort(); if (imageRef.current) URL.revokeObjectURL(imageRef.current); };
    // A keyed workspace is destroyed on baby/authorization changes.
  }, []);
  const post = async (path: string, body: unknown) => responseJSON(await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store", signal: lifetime.current?.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  function auditReason() { const result = reason.trim(); if (result.length < 8) throw new Error("请填写至少 8 个字的具体核对或操作理由。"); return result; }
  async function task(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await action(); } catch (cause) { handleError(cause); }
    finally { busyRef.current = false; if (!lifetime.current?.signal.aborted) setBusy(false); }
  }
  async function send(command: Command, existing?: ActionRequest) {
    if (!writable) return;
    await task(async () => {
      const body = existing || { babyId, reason: auditReason(), requestId: requestId(), command };
      if (body.command.type === "collector") {
        const input = object(body.command.input);
        if (input.action === "backfill") body.command = { ...body.command, input: { ...input, requestId: body.requestId } };
      }
      setLastRequest(body); setRetryAllowed(true); setReceipt(undefined); setOneTime(undefined);
      const data = await post("/api/ops/action", body);
      if (lifetime.current?.signal.aborted) return;
      const result = object(data.receipt);
      if (typeof result.token === "string") setOneTime({ title: "采集凭证 · 仅本次可见", value: result.token });
      if (body.command.type === "invite" && typeof result.code === "string") setOneTime({ title: "一次性照护邀请", value: result.code });
      const { code: invitationCode, ...invitationReceipt } = result;
      setReceipt(safeResult(body.command.type === "invite" && typeof invitationCode === "string" ? invitationReceipt : data.receipt ?? data));
      setRetryAllowed(result.status === "pending_projection" || result.retryable === true);
      await refresh();
    });
  }
  async function read(input: Omit<ReadRequest, "babyId" | "reason">) {
    await task(async () => {
      setSensitive(undefined); clearImage();
      const body = { ...input, babyId, reason: auditReason() };
      if (input.kind === "attachment") {
        const response = await fetch("/api/ops/read", { method: "POST", credentials: "same-origin", cache: "no-store", signal: lifetime.current?.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) await responseJSON(response);
        const blob = await response.blob();
        if (lifetime.current?.signal.aborted) return;
        if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type)) throw new Error("服务器未返回可审阅的私有图片");
        const url = URL.createObjectURL(blob); imageRef.current = url; setImageUrl(url);
      } else {
        const data = await post("/api/ops/read", body);
        if (!lifetime.current?.signal.aborted) setSensitive(data);
      }
      await refresh();
    });
  }
  async function upload(file: File, uploadId: string): Promise<string | undefined> {
    let uploaded: string | undefined;
    if (!writable) return;
    await task(async () => {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("请选择 10 MiB 以内的 PNG、JPEG 或 WebP 图片");
      const data = await responseJSON(await fetch(`/api/ops/attachment?babyId=${encodeURIComponent(babyId)}&requestId=${encodeURIComponent(uploadId)}`, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: lifetime.current?.signal,
        headers: { "Content-Type": file.type, "X-Bubu-Reason": encodeURIComponent(auditReason()) }, body: file,
      }));
      const attachment = object(data.attachment ?? data.data ?? data);
      if (typeof attachment.id !== "string") throw new Error("上传回执缺少附件编号，请按原请求核对");
      if (lifetime.current?.signal.aborted) return;
      uploaded = attachment.id; setReceipt({ attachmentId: uploaded, requestId: uploadId, message: "图片已私有保存，尚未关联照护事件。" }); await refresh();
    });
    return uploaded;
  }
  function choose(eventId: string, pending?: Pending) {
    setSelection({ eventId, version: pending?.eventVersion || overview?.events.find(event => event.id === eventId)?.version || 1, pending });
    setSelectionRevision(value => value + 1);
    setSensitive(undefined); clearImage(); setSection("pending");
  }
  const actionsDisabled = busy || !writable;
  const newActionDisabled = actionsDisabled || retryAllowed;
  const tabs: Choice[] = [["pending", "记录与待补"], ["family", "宝宝与照护授权"], ["collector", "群绑定与采集"], ["membership", "服务权益"], ["history", "历史核对"], ["audit", "操作审计"]];
  return <>
    <div className="bubu-ops__reason"><Field title="本次核对或操作理由（至少 8 个字）" hint="请说明所处理的客服事项或授权依据；每次操作均保存这段理由。">{id => <textarea id={id} value={reason} maxLength={500} rows={2} onChange={event => setReason(event.target.value)} placeholder="例如：根据照护者反馈核对今天的瓶喂时间" />}</Field></div>
    {!writable && <p className="bubu-ops__notice">当前为审计只读角色，仅能核对范围内的进度和摘要；私有正文、图片和变更操作需运营角色。</p>}
    <nav className="bubu-ops__nav" aria-label="运营工作区栏目">{tabs.map(([key, title]) => <button key={key} type="button" aria-pressed={section === key} className={section === key ? "" : "bubu-ops__secondary"} onClick={() => { setSection(key); setSensitive(undefined); clearImage(); setOneTime(undefined); }}>{title}</button>)}
      <button type="button" className="bubu-ops__secondary" disabled={busy} onClick={() => void task(() => refresh())}>刷新状态</button></nav>
    {error && <p className="bubu-ops__error" role="alert">{error}</p>}
    {busy && <p role="status">正在向业务服务核对…</p>}
    {oneTime && <aside className="bubu-ops__once"><h3>{oneTime.title}</h3><p>请交给已授权的接收者或保存在受保护的配置中。关闭后不会在列表重新显示。</p>
      <Field title={oneTime.title}>{id => <input id={id} value={oneTime.value} readOnly type="password" autoComplete="off" onFocus={event => event.target.select()} />}</Field>
      <button type="button" onClick={() => void task(async () => { await navigator.clipboard.writeText(oneTime.value); setReceipt({ message: "已复制一次性凭证，请妥善交付。" }); })}>复制</button> <button type="button" className="bubu-ops__secondary" onClick={() => setOneTime(undefined)}>关闭并清除</button></aside>}
    {receipt !== undefined && <details className="bubu-ops__result" open><summary>业务回执{object(receipt).status ? ` · ${label(object(receipt).status)}` : ""}</summary><pre>{stringify(receipt)}</pre></details>}
    {lastRequest && <div className="bubu-ops__request"><span>最近请求：<code>{lastRequest.requestId}</code></span>
      {retryAllowed && <button type="button" disabled={actionsDisabled} onClick={() => void send(lastRequest.command, lastRequest)}>按原参数重试此请求</button>}
      {retryAllowed && <button type="button" className="bubu-ops__secondary" disabled={actionsDisabled} onClick={() => { setRetryAllowed(false); setError(""); }}>已核对状态，开始新的请求</button>}
      <small>{retryAllowed ? "响应未确认时请保留此请求号。重试沿用原参数；请勿重复新建同一操作。" : "回执已确认。需要更正时，核对当前版本后再提交新操作。"}</small></div>}
    {!overview && !error && <p role="status">正在读取宝宝的运营状态…</p>}
    {overview && <>
      <div hidden={section !== "membership"}><Membership membership={overview.membership} send={send} disabled={newActionDisabled} busy={busy} writable={writable} /></div>
      {section === "family" && <Family overview={overview} send={send} disabled={newActionDisabled} />}
      {section === "collector" && <Collector overview={overview} send={send} disabled={newActionDisabled} />}
      {section === "pending" && <>
        <Panel title={`待补充与冲突 · ${overview.pending.length}`} help="字段疑问和图片待补来自同一持久事项。明确不知道可保留未知；不要填 0 代替未知。">
          <Table headers={["事项", "待核对内容", "状态", "处理"]} rows={overview.pending.map(pending => [
            <span key="id">{pending.kind === "media" ? "图片待补" : "字段 / 冲突"}<small className="bubu-ops__id">{pending.id}</small></span>,
            pending.kind === "media" ? pending.media?.map(item => `${item.index + 1}. ${item.reason}`).join("；") || "图片未关联" : [pending.fields?.map(fieldTitle).join("、"), pending.conflicts?.map(item => item.message || "需要核对冲突").join("；"), pending.duplicateCandidates?.length ? "疑似重复，需核对双方" : ""].filter(Boolean).join("；"),
            label(pending.state), <button key="choose" type="button" onClick={() => choose(pending.eventId || pending.eventIds?.[0] || "", pending)}>选择处理</button>,
          ])} />
        </Panel>
        <Panel title="照护事件" help="列表仅提供核对摘要；查看事实、来源、修订或图片均需填写理由。时间显示为北京时间。">
          <Table headers={["事件", "发生时间", "版本 / 状态", "处理"]} rows={overview.events.map(event => [<span key="event">{label(event.type)}<small className="bubu-ops__id">{event.id}</small></span>, dateLabel(event.startTime), `v${event.version} · ${label(event.lifecycle)} · ${label(event.projection)}`, <button key="select" type="button" onClick={() => choose(event.id)}>选择核对</button>])} />
        </Panel>
        <Records key={`${selectionRevision}:${selection.eventId}:${selection.pending?.id || ""}`} selection={selection} events={overview.events} send={send} read={read} upload={upload} disabled={newActionDisabled} busy={busy || !writable} reselect={(eventId, pendingId) => choose(eventId, overview.pending.find(pending => pending.id === pendingId))} />
      </>}
      {section === "history" && <History read={read} busy={busy || !writable} />}
      {section === "audit" && <><Panel title="本宝宝操作审计" help="记录敏感读取与受控变更的操作者、时间、理由和结果。列表不披露会话、凭证或照护原文。">
        <Table headers={["时间", "操作", "操作者", "理由", "结果 / 请求"]} rows={overview.audit.map(row => [dateLabel(String(row.at || row.createdAt || "")), label(row.action || row.kind), label(row.email || row.operatorId || row.actorId || row.actor), label(row.reason), [row.status || row.outcome || row.result, row.requestId || object(row.target).requestId].filter(Boolean).map(label).join(" · ")])} />
      </Panel>{accountAudit && <AccountAudit rows={accountAudit} />}</>}
    </>}
    {sensitive !== undefined && <section className="bubu-ops__result" aria-label="已审计的核对资料"><div className="bubu-ops__header"><h3>核对资料 · 已记审计</h3><button type="button" className="bubu-ops__secondary" onClick={() => setSensitive(undefined)}>关闭资料</button></div><pre>{stringify(sensitive)}</pre></section>}
    {imageUrl && <section className="bubu-ops__result"><div className="bubu-ops__header"><h3>私有图片 · 已记审计</h3><button type="button" onClick={clearImage}>关闭图片</button></div><img className="bubu-ops__image" src={imageUrl} alt="当前宝宝授权范围内的待核对私有附件" /></section>}
  </>;
}

type Sender = (command: Command, existing?: ActionRequest) => Promise<void>;
type Reader = (input: Omit<ReadRequest, "babyId" | "reason">) => Promise<void>;

const expiryChoices: Choice[] = [["", "未配置到期策略"], ["continue", "到期后继续免费服务"], ["pause", "到期后暂停此服务"]];
const membershipActionLabels: Record<string, string> = { configure: "配置免费服务", extend: "延长免费服务", pause: "暂停服务", resume: "恢复服务" };
// Keep the operator's date inputs in a fixed timezone, independent of the browser's locale.
const membershipDateInput = (value: string | null) => value ? new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 19) : "";
const membershipDraft = (membership: MembershipOverview) => ({
  version: membership.version,
  startsAt: membershipDateInput(membership.policy.startsAt), endsAt: membershipDateInput(membership.policy.endsAt),
  chat: membership.policy.expiryPolicy?.chat || "", collection: membership.policy.expiryPolicy?.collection || "",
});
function Membership({ membership, send, disabled, busy, writable }: { membership?: MembershipOverview; send: Sender; disabled: boolean; busy: boolean; writable: boolean }) {
  if (!membership || !Number.isSafeInteger(membership.version)) return <Panel title="服务权益"><p role="status" className="bubu-ops__error">暂时无法读取服务状态。请刷新状态后再核对，不能据此确认服务已开放。</p></Panel>;
  return <MembershipEditor membership={membership} send={send} disabled={disabled} busy={busy} writable={writable} />;
}
function MembershipEditor({ membership, send, disabled, busy, writable }: { membership: MembershipOverview; send: Sender; disabled: boolean; busy: boolean; writable: boolean }) {
  // Refreshes update the visible server state but never replace an in-progress versioned draft.
  const [draft, setDraft] = useState(() => membershipDraft(membership));
  const [extension, setExtension] = useState("");
  const [error, setError] = useState("");
  const stale = draft.version !== membership.version;
  function reload() { setDraft(membershipDraft(membership)); setExtension(""); setError(""); }
  function timestamp(value: string): string | null {
    if (!value.trim()) return null;
    const date = new Date(`${value}+08:00`);
    if (!Number.isFinite(date.getTime())) throw new Error("请填写有效的北京时间。");
    return date.toISOString();
  }
  async function apply(action: "configure" | "extend" | "pause" | "resume") {
    setError("");
    if (disabled || stale) return;
    try {
      let input: Row = { action, expectedVersion: draft.version };
      if (action === "configure") {
        const startsAt = timestamp(draft.startsAt), endsAt = timestamp(draft.endsAt);
        if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error("免费截止时间必须晚于开始时间。");
        if (Boolean(draft.chat) !== Boolean(draft.collection)) throw new Error("请分别选择聊天与采集的到期策略，或将两项都设为未配置。");
        if (!endsAt && (draft.chat || draft.collection)) throw new Error("设置到期策略前，请先明确免费截止时间；未设截止时间时无需配置到期策略。");
        input = { ...input, startsAt, endsAt, expiryPolicy: draft.chat && draft.collection ? { chat: draft.chat, collection: draft.collection } : null };
      }
      if (action === "extend") {
        const endsAt = timestamp(extension);
        if (!endsAt) throw new Error("请明确填写延长后的截止时间。");
        if (!membership.policy.endsAt || Date.parse(endsAt) <= Date.parse(membership.policy.endsAt)) throw new Error("延长后的截止时间必须晚于当前已配置的截止时间。");
        input = { ...input, endsAt };
      }
      await send({ type: "membership", input });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "请核对免费服务配置后重试。"); }
  }
  const dates = <dl className="bubu-ops__membership-summary">
    <div><dt>免费开始时间</dt><dd>{membership.startsAt ? dateLabel(membership.startsAt) : "未配置"}</dd></div>
    <div><dt>免费截止时间</dt><dd>{membership.endsAt ? dateLabel(membership.endsAt) : "未配置，不自动停服"}</dd></div>
    <div><dt>内置聊天</dt><dd>{membership.entitlements.chat ? "可用" : "暂停"}</dd></div>
    <div><dt>群记录采集</dt><dd>{membership.entitlements.collection ? "可用" : "暂停"}</dd></div>
    <div><dt>历史查看与导出</dt><dd>保留，仍按宝宝授权访问</dd></div>
    <div><dt>微信支付</dt><dd>关闭</dd></div>
  </dl>;
  return <>
    <Panel title="当前服务权益" help="同一个宝宝的所有授权照护者共享服务状态。这里显示服务端当前判断；时间均为北京时间。">
      <p><strong>{membership.label}</strong><span className="bubu-ops__badge">当前 v{membership.version}</span></p><p>{membership.message}</p>
      {dates}
      <p className="bubu-ops__muted">{membership.policy.expiryPolicy ? `已配置到期策略：聊天${membership.policy.expiryPolicy.chat === "pause" ? "暂停" : "继续"}，采集${membership.policy.expiryPolicy.collection === "pause" ? "暂停" : "继续"}。` : "未配置到期策略，截止时间本身不会触发自动停服。"}暂停或到期不会删除历史记录。</p>
    </Panel>
    {writable && <>
      <div className="bubu-ops__notice"><div className="bubu-ops__header"><p>正在编辑 v{draft.version} · 服务端当前 v{membership.version}</p><button type="button" className="bubu-ops__secondary" disabled={busy} onClick={reload}>重新载入当前配置</button></div>
        <small>重新载入会清空尚未提交的修改。刷新状态不会替换本页草稿；每次提交使用草稿版本和上方填写的操作理由。</small>
        {stale && <p role="status">配置已发生变化。请先核对当前状态，再重新载入配置；旧草稿不会覆盖新版本。</p>}
      </div>
      {error && <p className="bubu-ops__error" role="alert">{error}</p>}
      <Panel title="免费时间与到期策略" disabled={disabled || stale} help="留空表示未配置，不补默认期限。保存时间或到期策略不会解除人工暂停。">
        <div className="bubu-ops__grid">
          <Field title="免费开始时间（北京时间，可留空）">{id => <input id={id} type="datetime-local" step="1" value={draft.startsAt} onChange={event => setDraft(current => ({ ...current, startsAt: event.target.value }))} />}</Field>
          <Field title="免费截止时间（北京时间，可留空）">{id => <input id={id} type="datetime-local" step="1" value={draft.endsAt} onChange={event => setDraft(current => ({ ...current, endsAt: event.target.value }))} />}</Field>
          <Select title="到期后的内置聊天" value={draft.chat} onChange={chat => setDraft(current => ({ ...current, chat }))} options={expiryChoices} />
          <Select title="到期后的群记录采集" value={draft.collection} onChange={collection => setDraft(current => ({ ...current, collection }))} options={expiryChoices} />
        </div>
        <p className="bubu-ops__muted">到期策略须分别明确选择。两项都保持未配置时，不会因截止时间自动停服。</p>
        <button type="button" onClick={() => void apply("configure")}>保存免费服务配置</button>
      </Panel>
      <Panel title="延长免费服务" disabled={disabled || stale || !membership.policy.endsAt} help={membership.policy.endsAt ? "仅延后已配置的截止时间，保留到期策略和人工暂停状态。" : "当前未配置截止时间，无需延期。如需明确起止时间，请使用上方配置。"}>
        <Field title="延长后的截止时间（北京时间）">{id => <input id={id} type="datetime-local" step="1" value={extension} onChange={event => setExtension(event.target.value)} />}</Field>
        <button type="button" disabled={!extension} onClick={() => void apply("extend")}>延长免费截止时间</button>
      </Panel>
      <Panel title="暂停与恢复" disabled={disabled || stale} help="暂停会同时停止内置聊天与群记录采集，保留历史和已提交记录。恢复只解除人工暂停，仍按开始时间与已配置的到期策略判断可用性。">
        <div className="bubu-ops__buttons"><button type="button" className="bubu-ops__secondary" disabled={membership.policy.paused} onClick={() => void apply("pause")}>暂停聊天与采集</button><button type="button" disabled={!membership.policy.paused} onClick={() => void apply("resume")}>解除人工暂停</button></div>
      </Panel>
    </>}
    <Panel title="服务权益变更记录" help="每次变更保留版本、操作者和原因；审计只读角色可查看这些记录。">
      <Table headers={["版本", "时间", "动作", "操作者", "原因"]} rows={membership.changes.map(change => [`v${change.version}`, dateLabel(change.at), membershipActionLabels[change.action] || change.action, change.actorId, change.reason])} />
    </Panel>
  </>;
}
function Family({ overview, send, disabled }: { overview: Overview; send: Sender; disabled: boolean }) {
  const [name, setName] = useState(overview.baby.name);
  const [fullName, setFullName] = useState(overview.baby.fullName || "");
  const [inviteAccess, setInviteAccess] = useState("read");
  const [subjectId, setSubjectId] = useState("");
  const [state, setState] = useState("active");
  const [granted, setGranted] = useState<string[]>(["records:read", "media:read"]);
  return <>
    <Panel title="宝宝资料" disabled={disabled}><div className="bubu-ops__grid"><TextField title="昵称" value={name} onChange={setName} /><TextField title="姓名（可留空）" value={fullName} onChange={setFullName} /></div><button type="button" disabled={!name.trim()} onClick={() => void send({ type: "baby", name: name.trim(), fullName: fullName.trim() || null })}>保存宝宝资料</button></Panel>
    <Panel title="照护授权"><Table headers={["照护身份", "授权", "状态", "来源", "操作"]} rows={overview.grants.map(grant => [grant.subjectId, grant.permissions.map(label).join("、"), label(grant.state), grant.source, <button key="select" type="button" disabled={disabled} onClick={() => { setSubjectId(grant.subjectId); setState(grant.state); setGranted(grant.permissions); }}>调整授权</button>])} /></Panel>
    <div className="bubu-ops__columns"><Panel title="创建一次性照护邀请" disabled={disabled} help="加入群聊不会自动获得照护授权。接收者须通过本人身份接受邀请。"><Select title="邀请范围" value={inviteAccess} onChange={setInviteAccess} options={[["read", "仅查看记录与图片"], ["write", "查看、记录与上传图片"]]} /><button type="button" onClick={() => void send({ type: "invite", access: inviteAccess })}>签发一次性邀请</button></Panel>
      <Panel title="调整现有照护身份" disabled={disabled} help="撤权立即生效；只勾选本次确实授权的能力。"><TextField title="照护身份编号" value={subjectId} onChange={setSubjectId} /><Select title="授权状态" value={state} onChange={setState} options={[["active", "有效"], ["revoked", "撤销授权"]]} />
        <div className="bubu-ops__checks">{permissions.map(permission => <label key={permission}><input type="checkbox" checked={granted.includes(permission)} disabled={state === "revoked"} onChange={event => setGranted(current => event.target.checked ? [...current, permission] : current.filter(value => value !== permission))} />{label(permission)}</label>)}</div>
        <button type="button" disabled={!subjectId.trim()} onClick={() => void send({ type: "grant", subjectId: subjectId.trim(), state, permissions: state === "revoked" ? [] : granted })}>保存照护授权</button></Panel></div>
  </>;
}

function Collector({ overview, send, disabled }: { overview: Overview; send: Sender; disabled: boolean }) {
  const [groupId, setGroupId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [active, setActive] = useState("false");
  const [accountId, setAccountId] = useState("");
  const [chatId, setChatId] = useState("");
  const [jobAgent, setJobAgent] = useState("");
  const [enabled, setEnabled] = useState("false");
  const [interval, setInterval] = useState("60");
  const [jobId, setJobId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  function chooseJob(job: Job) { setJobId(job.id); setAccountId(job.accountId); setChatId(job.chatId); setJobAgent(job.agentId); setEnabled(String(job.enabled)); setInterval(String(job.intervalMs / 1000)); }
  return <>
    <Panel title="已绑定的群与服务身份" help="平台运营先手工建群，再登记明确的宝宝、群与 Agent。此处不会自动建群或读取未授权群。">
      <Table headers={["群编号", "Agent", "状态", "操作"]} rows={overview.bindings.map(binding => [binding.groupId, binding.agentId, binding.active ? "开通" : "暂停", <button key="choose" type="button" disabled={disabled} onClick={() => { setGroupId(binding.groupId); setAgentId(binding.agentId); setActive(String(binding.active)); }}>选择绑定</button>])} />
    </Panel>
    <Panel title="群绑定、开通与暂停" disabled={disabled}><div className="bubu-ops__grid"><TextField title="群编号" value={groupId} onChange={setGroupId} hint="wechat:账号编号:群编号" /><TextField title="Agent 编号" value={agentId} onChange={setAgentId} /><Select title="绑定状态" value={active} onChange={setActive} options={[["false", "暂停"], ["true", "开通"]]} /></div>
      <div className="bubu-ops__buttons"><button type="button" disabled={!groupId.trim() || !agentId.trim()} onClick={() => void send({ type: "binding", groupId: groupId.trim(), agentId: agentId.trim(), active: active === "true" })}>保存群绑定</button>
        <button type="button" className="bubu-ops__secondary" disabled={!groupId.trim() || !agentId.trim() || active !== "true"} onClick={() => void send({ type: "credential", groupId: groupId.trim(), agentId: agentId.trim() })}>签发此群采集凭证</button></div>
      <p className="bubu-ops__muted">凭证仅授予上方宝宝、群和 Agent 的采集范围，并仅在签发回执显示一次。</p>
    </Panel>
    <Panel title="采集作业状态" help="最后成功时间与处理至消息时间分别显示。待补图片不会被描述为采集完整。">
      <Table headers={["作业", "启停 / 间隔", "最后成功 / 处理至", "积压 / 图片", "下次尝试 / 失败", "操作"]} rows={overview.jobs.map(job => [<span key="id">{job.id}<small className="bubu-ops__id">{job.accountId} / {job.chatId}</small></span>, `${job.enabled ? "启用" : "暂停"} · ${job.intervalMs / 1000}秒`, <span key="time">{dateLabel(job.lastSuccessAt)}<br />{dateLabel(job.processedThrough)}</span>, <span key="pending">{job.activeBatchId ? `正在处理 ${job.activeBatchId}` : "无活动批次"}<br />待补图片 {job.pendingMedia || 0}<br />待补采 {job.backfills?.filter(value => value.state === "queued").length || 0}</span>, <span key="failure">{dateLabel(job.nextRunAt)}<br />{job.failure ? `${job.failure.code} · ${job.failure.attempts} 次 · ${dateLabel(job.failure.at)}` : "无失败"}</span>, <button key="choose" type="button" disabled={disabled} onClick={() => chooseJob(job)}>选择作业</button>])} />
      {overview.jobs.map(job => <details key={job.id}><summary>{job.id} · 水位与补采范围</summary><p>心跳：{dateLabel(job.heartbeatAt)}</p><pre>{JSON.stringify({ cursor: job.cursor, backfills: job.backfills }, null, 2)}</pre></details>)}
    </Panel>
    <Panel title="配置采集作业" disabled={disabled} help="这里只控制已部署采集 runner 的调度。首次保存默认暂停，开通需明确选择启用。"><div className="bubu-ops__grid"><TextField title="来源账号编号" value={accountId} onChange={setAccountId} /><TextField title="来源群编号" value={chatId} onChange={setChatId} /><TextField title="采集 Agent 编号" value={jobAgent} onChange={setJobAgent} /><Select title="调度状态" value={enabled} onChange={setEnabled} options={[["false", "暂停"], ["true", "启用"]]} /><TextField title="采集间隔（秒）" value={interval} onChange={setInterval} type="number" min={10} max={86400} /></div>
      <button type="button" disabled={!accountId.trim() || !chatId.trim() || !jobAgent.trim() || !Number.isFinite(Number(interval)) || Number(interval) < 10 || Number(interval) > 86400} onClick={() => void send({ type: "collector", input: { action: "configure", accountId: accountId.trim(), chatId: chatId.trim(), agentId: jobAgent.trim(), enabled: enabled === "true", intervalMs: Number(interval) * 1000 } })}>保存采集配置</button>
    </Panel>
    <Panel title="重试与受控补采" disabled={disabled} help="不会手改正常水位。补采按独立范围和请求号执行；重复已记录来源不会生成另一条照护事实。"><Select title="目标作业" value={jobId} onChange={setJobId} options={[["", "请选择作业"], ...overview.jobs.map((job): Choice => [job.id, job.id])]} /><button type="button" disabled={!jobId} onClick={() => void send({ type: "collector", input: { action: "retry", jobId } })}>提前重试此作业</button>
      <div className="bubu-ops__grid"><TextField title="补采开始（含时区）" value={from} onChange={setFrom} placeholder="2026-10-23T00:00:00+08:00" /><TextField title="补采结束（含时区）" value={to} onChange={setTo} placeholder="2026-10-24T00:00:00+08:00" /></div>
      <button type="button" disabled={!jobId || !Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) > Date.parse(to)} onClick={() => void send({ type: "collector", input: { action: "backfill", jobId, range: { from, to } } })}>提交范围补采</button>
    </Panel>
  </>;
}

type FactField = { key: string; title: string; kind?: "number" | "time"; choices?: Choice[] };
const factFields: FactField[] = [
  { key: "type", title: "活动类型", choices: activityChoices }, { key: "startTime", title: "发生时间", kind: "time" }, { key: "endTime", title: "结束时间", kind: "time" }, { key: "durationMinutes", title: "时长（分钟）", kind: "number" },
  { key: "milkAmount", title: "实际喝入 / 泵出量（ml）", kind: "number" }, { key: "preparedMilkAmount", title: "泡好奶量（ml）", kind: "number" }, { key: "remainingMilkAmount", title: "剩余奶量（ml）", kind: "number" },
  { key: "milkSource", title: "奶来源", choices: [["BREAST_MILK", "母乳"], ["FORMULA", "奶粉"]] }, { key: "sameBottle", title: "是否同一瓶", choices: [["true", "是"], ["false", "否"]] },
  { key: "burpSuccess", title: "拍嗝成功", choices: [["true", "是"], ["false", "否"]] }, { key: "breastFirmness", title: "乳房软硬", choices: [["SOFT", "软"], ["ELASTIC", "有弹性"], ["HARD", "硬"]] },
  { key: "hasPoop", title: "有便", choices: [["true", "是"], ["false", "否"]] }, { key: "hasPee", title: "有尿", choices: [["true", "是"], ["false", "否"]] }, { key: "poopColor", title: "便便颜色", choices: [["YELLOW", "黄"], ["GREEN", "绿"], ["BROWN", "棕"], ["BLACK", "黑"], ["WHITE", "白"], ["RED", "红"]] },
  { key: "peeAmount", title: "尿量", choices: [["SMALL", "少"], ["MEDIUM", "中"], ["LARGE", "多"]] }, { key: "count", title: "明确次数", kind: "number" }, { key: "supplementType", title: "补充剂类型", choices: [["AD", "AD"], ["D3", "D3"], ["PROBIOTICS", "益生菌"], ["PREBIOTICS", "益生元"]] },
  { key: "spitUpType", title: "吐奶类型", choices: [["NORMAL", "普通"], ["PROJECTILE", "喷射"]] }, { key: "notes", title: "备注" },
];
const fieldTitle = (field: string) => factFields.find(item => item.key === field)?.title || (field === "poopPhotoUrl" ? "照片" : "其他待核对信息");
type Correction = { key: string; state: string; value: string };
const initialCorrection = (): Correction => ({ key: "", state: "known", value: "" });
const recordActions: Choice[] = [["bubu_update_event", "补充 / 更正事实"], ["bubu_answer_pending", "回答选中的待补事项"], ["bubu_retract_event", "撤销误记"], ["bubu_restore_event", "恢复已撤销记录"], ["bubu_undo_event", "撤销最新修订"], ["bubu_attach_images", "设置完整附件列表"], ["bubu_resolve_media", "处理选中的待补图片"], ["bubu_resolve_duplicate", "核对疑似重复"], ["bubu_confirm_overlap", "确认真实时间重叠"], ["bubu_accept_legacy", "接受旧库当前事实"]];
function Records({ selection, events, send, read, upload, disabled, busy, reselect }: {
  selection: { eventId: string; version: number; pending?: Pending }; events: EventSummary[]; send: Sender; read: Reader;
  upload: (file: File, requestId: string) => Promise<string | undefined>; disabled: boolean; busy: boolean;
  reselect: (eventId: string, pendingId?: string) => void;
}) {
  const [eventId, setEventId] = useState(selection.eventId);
  const [version, setVersion] = useState(String(selection.version));
  const [tool, setTool] = useState(selection.pending ? selection.pending.kind === "media" ? "bubu_resolve_media" : "bubu_answer_pending" : "bubu_update_event");
  const [sourceId, setSourceId] = useState(selection.pending?.sourceId || "");
  const [attachmentId, setAttachmentId] = useState(events.find(event => event.id === selection.eventId)?.attachmentIds[0] || "");
  const [attachmentIds, setAttachmentIds] = useState(events.find(event => event.id === selection.eventId)?.attachmentIds.join("\n") || "");
  const [corrections, setCorrections] = useState<Correction[]>([initialCorrection()]);
  const [progress, setProgress] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [resolution, setResolution] = useState("distinct");
  const [targetEventId, setTargetEventId] = useState("");
  const [targetVersion, setTargetVersion] = useState("");
  const [overlapIds, setOverlapIds] = useState("");
  const [overlapReason, setOverlapReason] = useState("");
  const [mediaResolution, setMediaResolution] = useState("unknown");
  const [mediaIndex, setMediaIndex] = useState(String(selection.pending?.media?.[0]?.index || 0));
  const [file, setFile] = useState<File>();
  const [uploadId, setUploadId] = useState("");
  const [recoveryId, setRecoveryId] = useState("");
  const [localError, setLocalError] = useState("");
  const currentVersion = events.find(event => event.id === eventId)?.version;
  const splitIds = (input: string) => input.split(/[\n,]/).map(value => value.trim()).filter(Boolean);
  function correction(index: number, value: Partial<Correction>) { setCorrections(rows => rows.map((row, position) => index === position ? { ...row, ...value } : row)); }
  function patch() {
    const facts: Row = {}, states: Row = {};
    for (const row of corrections.filter(item => item.key)) {
      if (row.key in states) throw new Error("同一字段只能提交一次，请合并重复字段。");
      states[row.key] = row.state;
      if (row.state !== "known") continue;
      if (!row.value.trim()) throw new Error("已知字段必须填写明确值；未知请改选对应状态。");
      const field = factFields.find(item => item.key === row.key)!;
      if (field.kind === "number") {
        const value = Number(row.value); if (!Number.isFinite(value) || value < 0) throw new Error("数量或时长必须是大于等于 0 的数字。"); facts[row.key] = value;
      } else if (["sameBottle", "burpSuccess", "hasPoop", "hasPee"].includes(row.key)) facts[row.key] = row.value === "true";
      else facts[row.key] = row.value.trim();
    }
    if (!Object.keys(states).length && !progress) throw new Error("请选择需要更正的字段或进展状态。");
    return { facts, states, ...(progress ? { progress } : {}) };
  }
  async function apply() {
    setLocalError("");
    try {
      if (!eventId.trim() || !Number.isInteger(Number(version)) || Number(version) < 1) throw new Error("请选择事件，并填写当前版本。");
      let args: Row = { eventId: eventId.trim(), expectedVersion: Number(version) };
      if (tool === "bubu_update_event") args.patch = patch();
      if (tool === "bubu_answer_pending") {
        const pending = selection.pending;
        if (!pending || pending.kind === "media" || pending.eventId !== eventId || !pending.version) throw new Error("请从待补列表选择当前事件的字段事项。");
        args = { questionId: pending.id, questionVersion: pending.version, eventVersion: Number(version), patch: patch() };
      }
      if (tool === "bubu_undo_event") { if (!revisionId.trim()) throw new Error("请先查看修订，填写最新修订编号。"); args.revisionId = revisionId.trim(); }
      if (tool === "bubu_attach_images") args.attachmentIds = splitIds(attachmentIds);
      if (tool === "bubu_resolve_duplicate") { args.resolution = resolution; if (resolution === "same") { if (!targetEventId.trim() || Number(targetVersion) < 1) throw new Error("请填写目标事件及其当前版本。"); args.targetEventId = targetEventId.trim(); args.targetVersion = Number(targetVersion); } }
      if (tool === "bubu_confirm_overlap") { if (!splitIds(overlapIds).length || !overlapReason.trim()) throw new Error("请填写核对过的重叠事件和确认依据。"); args.conflictingEventIds = splitIds(overlapIds); args.reason = overlapReason.trim(); }
      if (tool === "bubu_resolve_media") {
        if (selection.pending?.kind !== "media") throw new Error("请从待补列表选择图片事项。");
        args.pendingId = selection.pending.id; args.mediaIndex = Number(mediaIndex); args.resolution = mediaResolution;
        if (mediaResolution === "provided") { if (!attachmentId.trim()) throw new Error("请填写已上传且已关联到该事件的附件编号。"); args.attachmentId = attachmentId.trim(); }
      }
      await send({ type: "record", tool, arguments: args });
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "请核对输入"); }
  }
  return <>
    <Panel title="按需核对事实与来源" disabled={busy}><div className="bubu-ops__grid"><TextField title="事件编号" value={eventId} onChange={setEventId} /><TextField title="当前事件版本" value={version} onChange={setVersion} type="number" min={1} /></div>
      {currentVersion !== undefined && currentVersion !== Number(version) && <div className="bubu-ops__notice"><p>此事件已有版本 v{currentVersion}，当前编辑仍基于 v{version}。请重新核对事实；刷新不会替换本次编辑所依据的版本。</p><button type="button" className="bubu-ops__secondary" onClick={() => reselect(eventId, selection.pending?.id)}>重新选择最新版本并清空编辑</button></div>}
      <div className="bubu-ops__buttons"><button type="button" disabled={!eventId.trim()} onClick={() => void read({ kind: "event", id: eventId.trim() })}>查看事实与来源</button><button type="button" className="bubu-ops__secondary" disabled={!eventId.trim()} onClick={() => void read({ kind: "revisions", id: eventId.trim() })}>查看修订记录</button></div>
      <div className="bubu-ops__grid"><TextField title="原始来源编号" value={sourceId} onChange={setSourceId} /><TextField title="私有附件编号" value={attachmentId} onChange={setAttachmentId} /></div>
      {!!events.find(event => event.id === eventId)?.attachmentIds.length && <Select title="已关联的私有附件" value={attachmentId} onChange={setAttachmentId} options={[["", "请选择图片"], ...(events.find(event => event.id === eventId)?.attachmentIds || []).map((id, index): Choice => [id, `图片 ${index + 1} · ${id}`])]} />}
      <div className="bubu-ops__buttons"><button type="button" className="bubu-ops__secondary" disabled={!sourceId.trim()} onClick={() => void read({ kind: "source", id: sourceId.trim() })}>按理由读取来源</button><button type="button" className="bubu-ops__secondary" disabled={!attachmentId.trim()} onClick={() => void read({ kind: "attachment", id: attachmentId.trim() })}>审阅私有图片</button></div>
    </Panel>
    <Panel title="客服协助处理" disabled={disabled} help="先核对照护者提供的事实和当前版本。所有修改均调用统一录入工具；版本冲突必须重新核对，不能盲目覆盖。">
      {selection.pending && <p>选中事项：<code>{selection.pending.id}</code>{selection.pending.version ? ` · 问题版本 ${selection.pending.version}` : ""}</p>}
      <Select title="处理动作" value={tool} onChange={setTool} options={recordActions} />
      {["bubu_update_event", "bubu_answer_pending"].includes(tool) && <>
        {corrections.map((row, index) => <div className="bubu-ops__correction" key={index}><Select title={`更正字段 ${index + 1}`} value={row.key} onChange={key => correction(index, { key, value: "" })} options={[["", "请选择字段"], ...factFields.map((field): Choice => [field.key, field.title])]} />
          <Select title="字段状态" value={row.state} onChange={state => correction(index, { state })} options={[["known", "已知"], ["pending", "仍待补充"], ["unknown", "照护者明确不知道"], ["not_yet", "尚未发生"], ["not_applicable", "不适用"]]} />
          {row.state === "known" && (factFields.find(field => field.key === row.key)?.choices ? <Select title="明确值" value={row.value} onChange={value => correction(index, { value })} options={[["", "请选择明确值"], ...factFields.find(field => field.key === row.key)!.choices!]} /> : <TextField title="明确值" value={row.value} onChange={value => correction(index, { value })} type={factFields.find(field => field.key === row.key)?.kind === "number" ? "number" : "text"} hint={factFields.find(field => field.key === row.key)?.kind === "time" ? "填写含时区的时间，例如 2026-10-23T10:20:00+08:00" : undefined} />)}
          <button type="button" className="bubu-ops__secondary" onClick={() => setCorrections(rows => rows.filter((_, position) => index !== position))}>移除此字段</button></div>)}
        <button type="button" className="bubu-ops__secondary" onClick={() => setCorrections(rows => [...rows, initialCorrection()])}>再补一个字段</button>
        <Select title="事件进展" value={progress} onChange={setProgress} options={[["", "保持原状态"], ["ongoing", "仍在进行"], ["ended", "已结束"], ["unknown", "明确不知道"]]} />
      </>}
      {tool === "bubu_undo_event" && <TextField title="最新修订编号" value={revisionId} onChange={setRevisionId} />}
      {tool === "bubu_attach_images" && <Field title="完整附件编号列表（每行一个）" hint="此列表替换事件的完整附件列表，留空表示移除全部图片；保留已有图片时必须包含其编号。">{id => <textarea id={id} rows={4} value={attachmentIds} onChange={event => setAttachmentIds(event.target.value)} />}</Field>}
      {tool === "bubu_resolve_duplicate" && <><Select title="核对结果" value={resolution} onChange={setResolution} options={[["distinct", "不同事情，分别计数"], ["same", "同一件事，合并到目标事件"]]} />{resolution === "same" && <div className="bubu-ops__grid"><TextField title="保留的目标事件编号" value={targetEventId} onChange={setTargetEventId} /><TextField title="目标事件当前版本" value={targetVersion} onChange={setTargetVersion} type="number" min={1} /></div>}</>}
      {tool === "bubu_confirm_overlap" && <><TextField title="已核对的重叠事件编号（逗号分隔）" value={overlapIds} onChange={setOverlapIds} /><TextField title="确认确实重叠的依据" value={overlapReason} onChange={setOverlapReason} /></>}
      {tool === "bubu_resolve_media" && <><Select title="图片事项结论" value={mediaResolution} onChange={setMediaResolution} options={[["unknown", "明确无法提供 / 不知道，停止催问"], ["provided", "已上传并关联了替代图片"]]} /><TextField title="图片序号（从 0 开始）" value={mediaIndex} onChange={setMediaIndex} type="number" min={0} max={9} /><p className="bubu-ops__muted">选择已提供前，请先上传图片、设置完整附件列表，并按新回执版本操作。附件编号使用上方私有附件字段。</p></>}
      {["bubu_retract_event", "bubu_restore_event", "bubu_accept_legacy"].includes(tool) && <p className="bubu-ops__notice">{tool === "bubu_retract_event" ? "提交后此事件从有效事实中撤销，来源和修订保留。" : tool === "bubu_restore_event" ? "恢复仍需通过重复与字段规则核对。" : "接受旧业务库当前事实，并保留冲突处理审计；这不是迁移历史数据。"}</p>}
      {localError && <p role="alert" className="bubu-ops__error">{localError}</p>}<button type="button" disabled={!eventId.trim()} onClick={() => void apply()}>提交所选处理</button>
    </Panel>
    <Panel title="私有图片上传" disabled={disabled} help="上传与关联分开确认。图片保存在当前宝宝私有范围内；不会在后台列表生成公开地址。"><Field title="选择图片（PNG、JPEG 或 WebP，最多 10 MiB）">{id => <input id={id} type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { setFile(event.target.files?.[0]); setUploadId(requestId()); }} />}</Field>
      {uploadId && <small>上传请求：<code>{uploadId}</code></small>}<button type="button" disabled={!file} onClick={() => { if (file) void upload(file, uploadId).then(id => { if (id) { setAttachmentId(id); setAttachmentIds(current => [...new Set([...splitIds(current), id])].join("\n")); } }); }}>上传此宝宝的私有图片</button></Panel>
    <Panel title="查询或恢复录入请求" disabled={disabled} help="网络中断不代表保存失败。填写原录入请求号，由服务查询并恢复尚未完成的原操作。"><TextField title="原录入请求号" value={recoveryId} onChange={setRecoveryId} /><button type="button" disabled={recoveryId.trim().length < 8} onClick={() => void send({ type: "record", tool: "bubu_get_request", arguments: { requestId: recoveryId.trim(), retry: true } })}>查询并恢复原请求</button></Panel>
  </>;
}

function History({ read, busy }: { read: Reader; busy: boolean }) {
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [error, setError] = useState("");
  async function load(file: File | undefined, target: (value: string) => void) {
    setError("");
    if (!file) return;
    if (file.size > 400 * 1024) { setError("每份核对文件请控制在 400 KiB 内；更大导出使用仓库历史核对脚本。"); return; }
    try { const text = await file.text(); JSON.parse(text); target(text); } catch { setError("请选择有效的 JSON 导出文件。"); }
  }
  async function audit() {
    setError("");
    try { await read({ kind: "history", before: JSON.parse(before), ...(after.trim() ? { after: JSON.parse(after) } : {}) }); }
    catch { setError("请核对 JSON 格式。导出需包含 activities，可选 dailyStats。"); }
  }
  return <Panel title="历史导出核对" disabled={busy} help="比较当前宝宝的离线导出、原字段和统计语义。只核对提供的文件，不写入记录，不证明线上迁移完成或照片原件可读。">
    <div className="bubu-ops__columns"><div><Field title="核对前导出 JSON">{id => <input id={id} type="file" accept="application/json,.json" onChange={event => void load(event.target.files?.[0], setBefore)} />}</Field><Field title="核对前内容">{id => <textarea id={id} rows={8} value={before} onChange={event => setBefore(event.target.value)} placeholder={'{"activities":[],"dailyStats":[]}'} />}</Field></div>
      <div><Field title="核对后导出 JSON（可选）">{id => <input id={id} type="file" accept="application/json,.json" onChange={event => void load(event.target.files?.[0], setAfter)} />}</Field><Field title="核对后内容（留空为单份映射核对）">{id => <textarea id={id} rows={8} value={after} onChange={event => setAfter(event.target.value)} />}</Field></div></div>
    {error && <p className="bubu-ops__error" role="alert">{error}</p>}<button type="button" disabled={!before.trim()} onClick={() => void audit()}>生成核对报告</button>
  </Panel>;
}
