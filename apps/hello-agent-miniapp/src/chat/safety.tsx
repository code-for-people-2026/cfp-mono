import { useEffect, useRef, useState } from "react";
import { Text, Textarea, View } from "@tarojs/components";
import { useRouter } from "@tarojs/taro";
import * as api from "./api";
import { PageButton, SettingsPage } from "./settings-page";
import "./safety.css";

import type { SafetyReceipt } from "@cfp/hello-agent-contracts";
const states: Record<string, string> = { pending: "待受理", in_progress: "处理中", review: "复核中", resolved: "已处置" };
const categories = [["other", "其他问题"], ["harassment", "侮辱或骚扰"], ["privacy", "隐私与数据"], ["fraud", "诈骗或违法"], ["violence", "暴力内容"], ["self_harm", "自伤相关不当回应"], ["sexual", "色情内容"], ["hate", "歧视与仇恨"]];
export function HelpPage() {
  const params = useRouter().params;
  const turnId = Number(params.turnId) > 0 ? Number(params.turnId) : undefined;
  const [contact, setContact] = useState("");
  const [rows, setRows] = useState<SafetyReceipt[]>([]), [description, setDescription] = useState(""), [category, setCategory] = useState(params.category === "privacy" ? "privacy" : "other");
  const [parentReceipt, setParent] = useState<string>(), [error, setError] = useState(""), [notice, setNotice] = useState(""), [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false), refreshInFlight = useRef(false);
  async function refresh() {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true; setRefreshing(true); setError("");
    try {
      const policy = await api.getLegal(); setContact(policy.contact);
      await api.establishIdentity();
      const result = await api.getSafety(); setRows(result.cases); setLoaded(true);
      setNotice(result.configuration.configured ? `预计 ${result.configuration.acceptanceHours} 小时内受理、${result.configuration.resolutionHours} 小时内处置，处置后 ${result.configuration.feedbackHours} 小时内提供结果。` : "人工值班与处理时限尚待运营配置；提交后可获取受理编号，不代表已有人受理。");
    } catch (e) { setError(e instanceof Error ? e.message : "记录读取失败，请点击右上角刷新"); }
    finally { refreshInFlight.current = false; setRefreshing(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function send() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setSuccess("");
    try {
      const receipt = await api.submitSafety({ kind: parentReceipt ? "appeal" : "complaint", category, description: description.trim(), ...(parentReceipt ? { parentReceipt } : turnId ? { turnId } : {}) });
      setSuccess(`已提交，受理编号：${receipt.receipt}。处理结果会显示在下方记录中。`); setDescription(""); setParent(undefined);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "提交未完成，请重试"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <SettingsPage title="帮助与反馈" onRefresh={() => void refresh()} refreshing={refreshing || busy} scrollIntoView={parentReceipt ? "help-form" : ""}>
    <Text className="page-intro">遇到问题，或对回应有疑问，都可以在这里告诉我们。</Text>
    {success && <Text className="page-result" selectable>{success}</Text>}
    {error && <Text className="page-result page-error">{error}</Text>}
    <View id="help-form" className="page-card page-card-padded">
      <Text className="page-heading">{parentReceipt ? "申请复核" : turnId ? "反馈这条回应" : "提交反馈"}</Text>
      {parentReceipt && <Text className="page-caption">关联受理编号：{parentReceipt}</Text>}
      {turnId && !parentReceipt && <Text className="page-caption">已关联回应 #{turnId}</Text>}
      <Text className="help-field-label">问题类型</Text>
      <View className="help-categories">{categories.map(([key, title]) => <PageButton key={key} className={`help-category ${category === key ? "selected" : ""}`} aria-pressed={category === key} disabled={busy} onClick={() => setCategory(key)}>{title}</PageButton>)}</View>
      <View className="help-field-heading"><Text className="help-field-label">问题描述</Text><Text className="help-count">{description.length} / 1200</Text></View>
      <Textarea className="help-description" maxlength={1200} value={description} disabled={busy} onInput={(e) => setDescription(e.detail.value)} placeholder={category === "privacy" ? "说明你的查阅、更正、补充或隐私问题（至少 5 字）" : "说说发生了什么，以及希望我们如何帮助你（至少 5 字）"} />
      <Text className="help-form-note">请勿填写密码、密钥、完整证件号或恢复码。</Text>
      <PageButton className="page-primary" disabled={busy || description.trim().length < 5} onClick={() => void send()}>{busy ? "正在提交…" : parentReceipt ? "提交申诉" : "提交反馈"}</PageButton>
      {parentReceipt && <PageButton className="page-link help-cancel" disabled={busy} onClick={() => setParent(undefined)}>取消申诉，改为新反馈</PageButton>}
    </View>
    <View className="help-records-heading"><Text>我的受理记录</Text><Text className="help-records-count">{rows.length > 0 ? `${rows.length} 条` : ""}</Text></View>
    <View className="page-card">
      {!rows.length && <View className="page-empty">{refreshing && !loaded ? "正在读取记录…" : !loaded ? "暂未读取到记录，点击右上角刷新重试" : "还没有反馈记录\n提交后，可在这里查看处理进度"}</View>}
      {rows.map((row) => <View key={row.receipt} className="help-receipt">
        <View className="help-receipt-heading"><Text>{row.kind === "appeal" ? "申诉复核" : row.kind === "complaint" ? "问题反馈" : "自动审核事项"}</Text><Text className={`help-status help-status-${row.status}`}>{states[row.status] || row.status}</Text></View>
        <Text className="help-receipt-id" selectable>受理编号 {row.receipt}</Text>
        <Text className="help-reply">{row.reply || "尚无处理结果，请稍后刷新查看。"}</Text>
        {row.canAppeal && <PageButton className="page-link" disabled={busy} onClick={() => { setParent(row.receipt); setDescription(""); setSuccess(""); }}>申请复核 ›</PageButton>}
      </View>)}
    </View>
    <View className="page-card page-card-padded"><Text className="page-heading">联系渠道</Text><Text className="page-copy" selectable>{contact || "暂未获取联系渠道，请刷新重试。"}</Text></View>
    <Text className="page-caption">仅显示当前身份的受理记录。{notice}</Text>
  </SettingsPage>;
}
