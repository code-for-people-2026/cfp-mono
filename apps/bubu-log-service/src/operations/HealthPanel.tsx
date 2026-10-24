"use client";
import { useEffect, useState } from "react";
import type { HealthCheck, OperationsHealthReport } from "./health";

const labels = { ok: "正常", warning: "待处理", critical: "异常", unconfigured: "未配置" };
export function HealthResult({ check }: { check: HealthCheck }) {
  return <p role={check.level === "critical" ? "alert" : undefined} className={check.level === "critical" ? "bubu-ops__error" : undefined}>
    <strong>{check.label} · {labels[check.level]}</strong>：{check.message}
    {check.at && <small>最近结果：{new Date(check.at).toLocaleString("zh-CN")}</small>}
  </p>;
}
export function OperationsHealthPanel({ denied }: { denied: () => void }) {
  const [report, setReport] = useState<OperationsHealthReport>(), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); let running = false;
    const refresh = async () => {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        const response = await fetch("/api/ops/health", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if ([401, 403].includes(response.status)) { denied(); return; }
        if (!response.ok) throw new Error("Health unavailable");
        const value = await response.json() as OperationsHealthReport;
        if (!controller.signal.aborted) { setReport(value); setError(""); }
      } catch { if (!controller.signal.aborted) { setReport(undefined); setError("无法更新运行状态，请核对后台服务。"); } }
      finally { running = false; }
    };
    void refresh(); const timer = setInterval(() => { void refresh(); }, 60_000);
    return () => { controller.abort(); clearInterval(timer); };
    // The administrator panel is destroyed on identity/role refresh.
  }, []);
  return <fieldset className="bubu-ops__panel"><legend>运行与数据保护</legend>
    <p className="bubu-ops__muted">每分钟刷新。异常显示在后台，尚未连接外部通知渠道。</p>
    {error && <p role="alert" className="bubu-ops__error">{error}</p>}
    {!report && !error && <p>正在读取运行状态…</p>}
    {report?.checks.map(check => <HealthResult key={check.id} check={check} />)}
  </fieldset>;
}
