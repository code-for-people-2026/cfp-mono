import { useEffect, useRef, useState } from "react";
import { Text, Textarea, View } from "@tarojs/components";
import Taro, { useDidShow, useRouter } from "@tarojs/taro";
import * as api from "./api";
import { PageButton, SettingsPage } from "./settings-page";
import "./safety.css";

import type { AgeStatus, SafetyReceipt } from "@cfp/a-j-oker-contracts";
const states: Record<string, string> = { pending: "待受理", in_progress: "处理中", review: "复核中", resolved: "已处置" };
const categories = [["age_verification", "年龄核验与账号恢复"], ["other", "其他问题"], ["harassment", "侮辱或骚扰"], ["privacy", "隐私与数据"], ["fraud", "诈骗或违法"], ["violence", "暴力内容"], ["self_harm", "自伤相关不当回应"], ["sexual", "色情内容"], ["hate", "歧视与仇恨"]];
export function HelpPage() {
  const params = useRouter().params;
  const turnId = Number(params.turnId) > 0 ? Number(params.turnId) : undefined;
  const initialCategory = params.category === "age_verification" ? "age_verification" : params.category === "privacy" ? "privacy" : "other";
  const [contact, setContact] = useState("");
  const [age, setAge] = useState<AgeStatus>();
  const [rows, setRows] = useState<SafetyReceipt[]>([]), [description, setDescription] = useState(""), [category, setCategory] = useState(initialCategory);
  const [parentReceipt, setParent] = useState<string>(), [error, setError] = useState(""), [notice, setNotice] = useState(""), [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false), refreshInFlight = useRef(false), shownOnce = useRef(false);
  async function refresh(includeAge = category === "age_verification") {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true; setRefreshing(true); setError("");
    try {
      const policy = await api.getLegal(); setContact(policy.contact);
      await api.establishIdentity();
      const [result, ageStatus] = await Promise.all([api.getSafety(), includeAge ? api.getAge() : Promise.resolve(undefined)]); setRows(result.cases); if (ageStatus) setAge(ageStatus); setLoaded(true);
      setNotice(result.configuration.notice || (result.configuration.configured ? `预计 ${result.configuration.acceptanceHours} 小时内受理、${result.configuration.resolutionHours} 小时内处置，处置后 ${result.configuration.feedbackHours} 小时内提供结果。` : "人工值班与处理时限尚待运营配置；提交后可获取受理编号，不代表已有人受理。"));
    } catch (e) { setError(e instanceof Error ? e.message : "记录读取失败，请点击右上角刷新"); }
    finally { refreshInFlight.current = false; setRefreshing(false); }
  }
  useDidShow(() => { if (shownOnce.current) void refresh(); else shownOnce.current = true; });
  useEffect(() => { void refresh(initialCategory === "age_verification"); }, []);
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
  async function requestReview() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setSuccess("");
    try { setAge(await api.requestAgeReview()); setSuccess("复核申请已提交。受理编号和状态会显示在本页；提交不代表限制会自动解除。"); }
    catch (e) { setError(e instanceof Error ? e.message : "申请未完成，请重试"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function returnToChatAgeGate() {
    const pages = Taro.getCurrentPages();
    let chat = -1;
    for (let index = pages.length - 1; index >= 0; index--) {
      if (pages[index]?.route === "pages/chat/index") { chat = index; break; }
    }
    if (chat >= 0 && chat < pages.length - 1) void Taro.navigateBack({ delta: pages.length - 1 - chat });
    else void Taro.reLaunch({ url: "/pages/chat/index" });
  }
  async function appeal(row: SafetyReceipt) {
    let current = age;
    if (!current) {
      try { current = await api.getAge(); setAge(current); }
      catch { /* A generic receipt remains appealable when age status cannot be read. */ }
    }
    if (current?.review?.receipt === row.receipt) {
      setCategory("age_verification"); setParent(undefined); setDescription(""); setSuccess("");
      return;
    }
    setParent(row.receipt); setDescription(""); setSuccess("");
  }
  const agePanel = category === "age_verification";
  return <SettingsPage title="帮助与反馈" onRefresh={() => void refresh()} refreshing={refreshing || busy} scrollIntoView={parentReceipt ? "help-form" : ""}>
    <Text className="page-intro">遇到问题，或对回应有疑问，都可以在这里告诉我们。</Text>
    {success && <Text className="page-result" selectable>{success}</Text>}
    {error && <Text className="page-result page-error">{error}</Text>}
    {agePanel ? <View id="help-form" className="page-card page-card-padded age-recovery-panel">
      <Text className="page-heading">年龄核验与账号恢复</Text>
      <Text className="page-copy">这里用于申请和查看年龄复核，不是普通投诉。请不要在反馈中填写姓名、身份证号码或上传证件照片；需要重新核验时，只会回到受保护的本人核验表单。</Text>
      <PageButton className="page-link" disabled={busy} onClick={() => { setCategory("other"); setParent(undefined); setSuccess(""); }}>反馈其他问题</PageButton>
      {!age && <Text className="page-copy">正在读取年龄核验状态…</Text>}
      {age && <>
        <Text className="help-field-label">当前状态</Text>
        <Text className="age-recovery-state">{age.review?.state === "approved" ? "已允许重新核验，但尚未恢复使用" : age.review?.state === "pending" ? "复核处理中" : age.review?.state === "rejected" ? "复核后维持限制" : age.review?.state === "completed" ? "复核流程已完成" : age.review?.state === "request_required" ? "可以申请人工复核" : !age.allowed && (age.state === "minor" || age.state === "needs_review" || age.additionalVerification === "required") ? "年龄限制仍然有效" : "当前没有需要处理的复核"}</Text>
        {age.review?.receipt && <Text className="help-receipt-id" selectable>复核受理编号 {age.review.receipt}</Text>}
        {age.review?.caseStatus && <Text className="page-copy">处理进度：{states[age.review.caseStatus] || age.review.caseStatus}</Text>}
        {age.review?.reply && <Text className="help-reply">处理回复：{age.review.reply}</Text>}
        <Text className="age-recovery-steps">{age.review?.state === "approved" ? "下一步：返回聊天并完成新的本人身份核验。复核批准不会自动恢复使用，只有新的成年核验成功后才会恢复对话和上传。" : age.review?.state === "rejected" ? "下一步：请阅读处理回复；当前限制继续有效。若服务端允许再次申请，可使用下方专用按钮，不要提交普通投诉。" : age.review?.state === "completed" ? age.allowed ? "下一步：复核和年龄核验已完成，可以返回聊天。" : "下一步：复核流程已完成，但年龄限制仍然有效。请阅读处理回复或刷新最新状态。" : age.review?.state === "pending" ? "下一步：工作人员处理复核。你可以点击刷新查询状态；结果出来前，对话和上传仍不可用。" : age.review?.state === "request_required" ? "下一步：点击下方按钮申请人工复核。工作人员将查看年龄限制情况；申请不保证批准或自动恢复。" : !age.allowed ? "下一步：年龄限制仍然有效。请刷新读取最新状态；较早版本未显示专用操作时，请使用下方联系渠道。" : "下一步：可以返回聊天；也可刷新读取最新状态。"}</Text>
        {age.actions?.requestReview && <PageButton className="page-primary" disabled={busy} onClick={() => void requestReview()}>{busy ? "正在提交…" : "申请年龄复核"}</PageButton>}
        {age.actions?.checkReviewStatus && <PageButton className="page-primary" disabled={busy} onClick={() => void refresh()}>{busy ? "正在查询…" : "查询复核状态"}</PageButton>}
        {age.review?.state === "approved" && age.actions?.startReverification && <PageButton className="page-primary" onClick={returnToChatAgeGate}>返回聊天并重新核验</PageButton>}
        {age.review?.state === "completed" && age.allowed && <PageButton className="page-primary" onClick={returnToChatAgeGate}>返回聊天</PageButton>}
      </>}
    </View> : <View id="help-form" className="page-card page-card-padded">
      <Text className="page-heading">{parentReceipt ? "申请复核" : turnId ? "反馈这条回应" : "提交反馈"}</Text>
      {parentReceipt && <Text className="page-caption">关联受理编号：{parentReceipt}</Text>}
      {turnId && !parentReceipt && <Text className="page-caption">已关联回应 #{turnId}</Text>}
      <Text className="help-field-label">问题类型</Text>
      <View className="help-categories">{categories.map(([key, title]) => <PageButton key={key} className={`help-category ${category === key ? "selected" : ""}`} aria-pressed={category === key} disabled={busy} onClick={() => { setCategory(key); if (key === "age_verification") void refresh(true); }}>{title}</PageButton>)}</View>
      <View className="help-field-heading"><Text className="help-field-label">问题描述</Text><Text className="help-count">{description.length} / 1200</Text></View>
      <Textarea className="help-description" maxlength={1200} value={description} disabled={busy} onInput={(e) => setDescription(e.detail.value)} placeholder={category === "privacy" ? "说明你的查阅、更正、补充或隐私问题（至少 5 字）" : "说说发生了什么，以及希望我们如何帮助你（至少 5 字）"} />
      <Text className="help-form-note">请勿填写密码、密钥、完整证件号或恢复码。</Text>
      <PageButton className="page-primary" disabled={busy || description.trim().length < 5} onClick={() => void send()}>{busy ? "正在提交…" : parentReceipt ? "提交申诉" : "提交反馈"}</PageButton>
      {parentReceipt && <PageButton className="page-link help-cancel" disabled={busy} onClick={() => setParent(undefined)}>取消申诉，改为新反馈</PageButton>}
    </View>}
    <View className="help-records-heading"><Text>我的受理记录</Text><Text className="help-records-count">{rows.length > 0 ? `${rows.length} 条` : ""}</Text></View>
    <View className="page-card">
      {!rows.length && <View className="page-empty">{refreshing && !loaded ? "正在读取记录…" : !loaded ? "暂未读取到记录，点击右上角刷新重试" : "还没有反馈记录\n提交后，可在这里查看处理进度"}</View>}
      {rows.map((row) => <View key={row.receipt} className="help-receipt">
        <View className="help-receipt-heading"><Text>{row.kind === "appeal" ? "申诉复核" : row.kind === "complaint" ? "问题反馈" : "自动审核事项"}</Text><Text className={`help-status help-status-${row.status}`}>{states[row.status] || row.status}</Text></View>
        <Text className="help-receipt-id" selectable>受理编号 {row.receipt}</Text>
        <Text className="help-reply">{row.reply || "尚无处理结果，请稍后刷新查看。"}</Text>
        {row.canAppeal && <PageButton className="page-link" disabled={busy} onClick={() => void appeal(row)}>申请复核 ›</PageButton>}
      </View>)}
    </View>
    <View className="page-card page-card-padded"><Text className="page-heading">联系渠道</Text><Text className="page-copy" selectable>{contact || "暂未获取联系渠道，请刷新重试。"}</Text></View>
    <Text className="page-caption">仅显示当前身份的受理记录。{notice}</Text>
  </SettingsPage>;
}
