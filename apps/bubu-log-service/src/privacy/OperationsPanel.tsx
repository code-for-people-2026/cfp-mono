"use client";
import { useState } from "react";
interface Queue { maintenance?: { at: string; failed?: boolean; report?: { deferredTasks?: number } } | null; requests: { id: string; message: string; status: string; reply?: string; updatedAt: string }[]; signals: { id: string; source: string; category: string; sentAt: string; observedAt: string; status: string }[]; jobs: { id: string; kind: string; status: string; errorCode?: string }[] }
/** Privacy requests stay in Payload; opening the page alone never reveals private content. */
export function PrivacyOperationsPanel({ babyId }: { babyId?: string }) {
  const [reason, setReason] = useState(""), [reply, setReply] = useState(""), [error, setError] = useState("");
  const [data, setData] = useState<Queue>(), [busy, setBusy] = useState(false);
  async function execute(action: string, id?: string, expectedUpdatedAt?: string) {
    if (busy) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/ops/privacy", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason, ...(babyId ? { babyId } : {}), ...(id ? { id, reply, expectedUpdatedAt } : {}) }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "请求未完成");
      setData(value); setReply("");
    } catch (failure) { setData(undefined); setError(failure instanceof Error ? failure.message : "请求未完成"); }
    finally { setBusy(false); }
  }
  return <section className="bubu-ops__panel"><h3>{babyId ? "家庭隐私请求与安全提示" : "账号隐私请求与删除任务"}</h3><p>仅按职责查看必要内容。安全提示不是诊断，也不表示有人持续监护或已经联系到家庭。</p><label>查看或处理理由<input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></label><button type="button" disabled={busy || reason.trim().length < 4} onClick={() => void execute("read")}>读取队列</button>{error && <p role="alert">{error}</p>}{data && <>{!babyId && <p role={data.maintenance?.failed || data.maintenance?.report?.deferredTasks ? "alert" : undefined}>保留清理：{data.maintenance ? `${data.maintenance.at} · ${data.maintenance.failed ? "维护失败，需要排查" : `未完成任务 ${data.maintenance.report?.deferredTasks || 0} 个，需核对保存结果`}` : "尚无维护记录"}</p>}<label>回复或处理说明<textarea value={reply} onChange={event => setReply(event.target.value)} maxLength={2000} /></label>{data.requests.map(request => <article key={request.id}><p>{request.message}</p><p>{request.status} · {request.reply}</p><button type="button" disabled={busy || !reply.trim()} onClick={() => void execute("reply", request.id, request.updatedAt)}>提交回复</button></article>)}{data.signals.map(signal => <article key={signal.id}><p>{signal.category === "breathing" ? "呼吸相关危险描述" : "意识相关危险描述"} · {signal.source === "group" ? "定时群采集" : "内置聊天"} · {signal.status}</p><p>原消息：{signal.sentAt}；发现：{signal.observedAt}。核实当前情况，不把延迟消息当作实时事件。</p><button type="button" disabled={busy || !reply.trim()} onClick={() => void execute("review-safety", signal.id)}>记录核对结果</button></article>)}{data.jobs.map(job => <p key={job.id}>{job.kind} · {job.status} {job.errorCode}</p>)}{!babyId && <button type="button" disabled={busy} onClick={() => void execute("retry-deletions")}>重试已经确认的删除任务</button>}</>}</section>;
}
