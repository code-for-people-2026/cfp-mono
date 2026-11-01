import { Button, Text, View } from "@tarojs/components";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { SafetyNotice } from "./contracts";
import "./privacy.css";

/** Only mounted after the current person and baby's privacy gate succeeds. */
export function SafetyNotices({ babyId, revision }: { babyId: string; revision: number }) {
  const [notices, setNotices] = useState<SafetyNotice[]>([]), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; setNotices([]); setError("");
    void api.safetyNotices(babyId).then(rows => { if (active) setNotices(rows); }).catch(() => { if (active) setError("安全提示暂时读取失败"); });
    return () => { active = false; };
  }, [babyId, revision, refresh]);
  if (error) return <View className="safety-notices"><Text>{error}</Text><Button className="text-button" onClick={() => setRefresh(value => value + 1)}>重试提示</Button><Text className="muted">定时采集不是实时监护；紧急情况请立即寻求现场帮助。</Text></View>;
  if (!notices.length) return null;
  return <View className="safety-notices" role="alert"><Text className="section-title">有照护描述需要核实</Text>{notices.slice(0, 3).map(notice => <View key={notice.id} className="privacy-request">
    <Text className="muted">{notice.source === "group" ? "来自延迟群采集" : "系统安全提示"}</Text>
    <Text selectable>{notice.message}</Text>
    <Button className="text-button" disabled={busy || undefined} onClick={() => { setBusy(true); void api.acknowledgeSafety(babyId, notice.id).then(() => setNotices(rows => rows.filter(row => row.id !== notice.id))).catch(() => setError("确认未保存，请重试")).finally(() => setBusy(false)); }}>我已阅读，会向现场照护者核实</Button>
  </View>)}{notices.length > 3 && <Text className="muted">另有 {notices.length - 3} 条待阅读提示，阅读后继续显示。</Text>}</View>;
}
