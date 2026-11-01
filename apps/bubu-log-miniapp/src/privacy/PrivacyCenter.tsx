import { clearPrivacyExports } from "./exports";
import { Button, Input, Switch, Text, Textarea, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { clearImageFiles } from "../chat/files";
import { chatDrafts } from "../chat/storage";
import { sessionExpiredEvent } from "../navigation/events";
import type { DeletionIntent, DeletionJob, PrivacyPolicy, PrivacyRequest, PrivacyStatus } from "./contracts";
import "./privacy.css";

export function Choice({ value, label, disabled, onChange }: { value: boolean; label: string; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <View className="privacy-choice"><Text>{label}</Text><Switch checked={value} disabled={disabled} ariaLabel={label} color="#9b6654" onChange={event => { if (!disabled) onChange(event.detail.value); }} /></View>;
}
export function PolicyDocuments({ policy }: { policy: PrivacyPolicy }) {
  const [open, setOpen] = useState(false);
  return <View><Button className="text-button" onClick={() => setOpen(!open)}>{open ? "收起说明" : "阅读隐私、儿童信息及服务说明"}</Button>{open && <View className="privacy-documents">{policy.documents.map(doc => <View key={doc.title}><Text className="section-title">{doc.title}</Text>{doc.paragraphs.map(paragraph => <Text className="privacy-paragraph" key={paragraph}>{paragraph}</Text>)}</View>)}</View>}</View>;
}
export function PrivacyCenter({ babyId, authenticated = true, onReady, onChanged }: { babyId?: string; authenticated?: boolean; onReady?: () => void; onChanged?: () => void }) {
  const [policy, setPolicy] = useState<PrivacyPolicy>();
  const [status, setStatus] = useState<PrivacyStatus>();
  const [accepted, setAccepted] = useState(false), [adult, setAdult] = useState(false), [sensitive, setSensitive] = useState(false);
  const [ai, setAi] = useState(false), [images, setImages] = useState(false);
  const [guardian, setGuardian] = useState(false), [child, setChild] = useState(false), [childAi, setChildAi] = useState(false), [childImages, setChildImages] = useState(false);
  const [collection, setCollection] = useState(false), [groupNotice, setGroupNotice] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [receipt, setReceipt] = useState("");
  const [requests, setRequests] = useState<PrivacyRequest[]>([]), [jobs, setJobs] = useState<DeletionJob[]>([]);
  const [message, setMessage] = useState(""), [kind, setKind] = useState<"privacy" | "complaint" | "appeal">("privacy");
  const [intent, setIntent] = useState<DeletionIntent>(), [confirmation, setConfirmation] = useState("");
  const inFlight = useRef(false), generation = useRef(0), mounted = useRef(true);
  const refresh = async () => {
    const current = ++generation.current;
    const nextPolicy = await api.privacyPolicy();
    const next = authenticated ? await api.privacyStatus(babyId) : undefined;

    if (generation.current !== current) return;
    setPolicy(nextPolicy); setStatus(next);
    if (next) {
      setAccepted(next.consentCurrent); setAdult(next.consentCurrent); setSensitive(next.consentCurrent);
      setAi(next.consentCurrent && !!next.consent?.ai); setImages(next.consentCurrent && !!next.consent?.images);
      const own = next.guardianCurrent && !!next.guardian?.isOwn;
      setGuardian(own); setChild(own); setChildAi(own && !!next.guardian?.ai); setChildImages(own && !!next.guardian?.images);
      setCollection(own && !!next.guardian?.collection); setGroupNotice(own && !!next.guardian?.groupMembersInformed);
    }
    if (authenticated) {
      const rights = await Promise.allSettled([api.privacyRequests(), api.deletionJobs()]);
      if (generation.current !== current) return;
      if (rights[0].status === "fulfilled") setRequests(rights[0].value);
      if (rights[1].status === "fulfilled") setJobs(rights[1].value);
      if (rights.some(result => result.status === "rejected")) setError("授权已读取；数据请求进度暂时无法读取，可稍后刷新。");
    }
  };
  useEffect(() => { mounted.current = true; void refresh().catch(failure => setError(failure instanceof Error ? failure.message : "读取失败")); return () => { mounted.current = false; generation.current++; }; }, [babyId, authenticated]);
  const run = async (operation: () => Promise<void>, success: string, refreshAfter = true) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setReceipt("");
    try { await operation(); if (!mounted.current) return; setReceipt(success); if (refreshAfter) await refresh(); onChanged?.(); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "处理未完成，请重试。"); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const exportData = async (family: boolean) => {
    const result = await api.privacyExport(family ? babyId : undefined), text = JSON.stringify(result, null, 2), fileName = `bubu-${family ? "family" : "account"}-${Date.now()}.json`;
    if (process.env.TARO_ENV === "h5") {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      clearPrivacyExports();
      const filePath = `${Taro.env.USER_DATA_PATH}/${fileName}`, fs = Taro.getFileSystemManager();
      fs.writeFileSync(filePath, text, "utf8");
      try { await Taro.shareFileMessage({ filePath, fileName }); }
      finally { try { fs.unlinkSync(filePath); } catch { /* next launch cleanup handles interrupted exports */ } }
    }
  };
  return <View className="privacy-center">
    <Text className="settings-heading">隐私与安全</Text>
    <Text className="muted">由你决定如何处理数据。AI、照片和群采集可以分别关闭。</Text>
    {error && <Text className="error-text">{error}</Text>}{receipt && <Text className="settings-success">{receipt}</Text>}
    {!policy ? <Button className="text-button" onClick={() => { void run(refresh, "已刷新"); }}>重新读取说明</Button> : <>
      <PolicyDocuments policy={policy} />
      {!policy.ready && <Text className="error-text">运营信息尚未配置完整，暂时不能开启数据处理。</Text>}
      {authenticated && status && <>
        <View className="privacy-card">
          <Text className="section-title">本人的选择</Text>
          <Choice label="我已阅读并同意隐私及服务说明" value={accepted} onChange={setAccepted} />
          <Choice label="我是成年照护者，已获得照护授权" value={adult} onChange={setAdult} />
          <Choice label="同意为记录照护而处理敏感信息" value={sensitive} onChange={setSensitive} />
          <Choice label="允许 AI 整理和回复" value={ai} onChange={setAi} />
          <Choice label="允许处理我主动上传的照片" value={images} onChange={setImages} />
          <Button className="primary-button" disabled={busy || !policy.ready || !accepted || !adult || !sensitive || undefined} onClick={() => { void run(() => api.privacyConsent({ policyVersion: policy.version, accepted: true, adultCaregiver: true, sensitive: true, ai, images }), "已保存本人选择"); }}>保存本人选择</Button>
          {status.consentCurrent && <Button className="text-button" disabled={busy || undefined} onClick={() => { void run(() => api.privacyWithdraw(), "已撤回授权，后续处理已暂停"); }}>撤回本人授权</Button>}
        </View>
        {babyId && <View className="privacy-card">
          <Text className="section-title">宝宝的监护授权</Text>
          {status.canManage && (!status.guardian || status.guardian.isOwn || status.guardian.replaceable) ? <>
            <Choice label="我是这位宝宝的成年监护人" value={guardian} onChange={setGuardian} />
            <Choice label="同意为照护记录处理宝宝的敏感信息" value={child} onChange={setChild} />
            <Choice label="允许 AI 整理宝宝的记录" value={childAi} onChange={setChildAi} />
            <Choice label="允许处理宝宝照片" value={childImages} onChange={setChildImages} />
            <Choice label="允许定时采集已指定家庭群的照护信息" value={collection} onChange={setCollection} />
            {collection && <Choice label="已告知群成员并取得必要同意" value={groupNotice} onChange={setGroupNotice} />}
            <Text className="muted">群采集有延迟，不是急救监护。此开关不等于已经绑定群或启动采集任务。</Text>
            <Button className="primary-button" disabled={busy || !status.consentCurrent || !guardian || !child || collection && !groupNotice || undefined} onClick={() => { void run(() => api.privacyGuardian(babyId, { policyVersion: policy.version, guardian: true, sensitive: true, ai: childAi, images: childImages, collection, groupMembersInformed: groupNotice }), "已保存监护授权"); }}>保存监护授权</Button>
            {status.guardianCurrent && <Button className="text-button" disabled={busy || undefined} onClick={() => { void run(() => api.privacyWithdraw(babyId), "已暂停此宝宝的数据处理"); }}>撤回宝宝授权</Button>}
          </> : <Text className="muted">{status.guardianCurrent ? "监护人已设置授权；你仍需作出本人的选择。" : "请联系拥有管理权限的监护人完成宝宝授权。"}</Text>}
        </View>}
        {onReady && <Button className="primary-button" disabled={busy || !status.consentCurrent || !!babyId && !status.guardianCurrent || undefined} onClick={onReady}>返回日历</Button>}
        <View className="privacy-card">
          <Text className="section-title">数据与账号</Text>
          <Text className="muted">照护记录由家庭共同使用。注销本人账号与删除宝宝全部数据是两件事。</Text>
          <Button className="text-button" disabled={busy || undefined} onClick={() => { void run(() => exportData(false), "导出已生成，请妥善保管副本"); }}>导出本人的数据</Button>
          {babyId && status.guardian?.isOwn && <Button className="text-button" disabled={busy || undefined} onClick={() => { void run(() => exportData(true), "家庭导出已生成"); }}>导出家庭照护数据</Button>}
          <Button className="text-button" disabled={busy || undefined} onClick={() => { void run(async () => { setIntent(await api.deletionIntent("account")); setConfirmation(""); }, "请核对注销范围"); }}>申请注销本人账号</Button>
          {babyId && status.guardian?.isOwn && <Button className="text-button privacy-danger" disabled={busy || undefined} onClick={() => { void run(async () => { setIntent(await api.deletionIntent("family", babyId)); setConfirmation(""); }, "请核对家庭删除范围"); }}>申请删除宝宝全部数据</Button>}
          {intent && <View className="privacy-confirm">{intent.consequences.map(text => <Text className="privacy-paragraph" key={text}>{text}</Text>)}<Text>确认后立即暂停访问，清理失败会继续重试。请输入：{intent.confirmation}</Text><Input value={confirmation} ariaLabel="删除确认文字" onInput={event => setConfirmation(event.detail.value)} />
            <Button className="primary-button" disabled={busy || confirmation !== intent.confirmation || undefined} onClick={() => { void run(async () => { await api.deletionConfirm(intent.token, confirmation); const account = intent.scope === "account"; setIntent(undefined); setConfirmation(""); chatDrafts.clear(); clearImageFiles(); if (account) { await api.logout().catch(() => {}); Taro.eventCenter.trigger(sessionExpiredEvent); } }, "删除申请已受理；受理不代表清理已完成", intent.scope !== "account"); }}>确认提交删除申请</Button>
            <Button className="text-button" disabled={busy || undefined} onClick={() => { setIntent(undefined); setConfirmation(""); }}>取消</Button></View>}
          {jobs.map(job => <Text className="privacy-paragraph" key={job.id}>{job.scope === "family" ? "家庭删除" : "账号注销"}：{({ pending: "等待处理", running: "正在清理", retry: "等待重试，访问已暂停", completed: "处理完成" })[job.status]}</Text>)}
        </View>
        <View className="privacy-card">
          <Text className="section-title">问题、投诉与隐私请求</Text>
          <View className="privacy-tabs">{(["privacy", "complaint", "appeal"] as const).map(value => <Button key={value} className="text-button" onClick={() => setKind(value)}>{kind === value ? "✓ " : ""}{({ privacy: "隐私请求", complaint: "内容投诉", appeal: "处理申诉" })[value]}</Button>)}</View>
          <Textarea value={message} maxlength={2000} placeholder="请描述问题，无需重复发送宝宝照片或证件" onInput={event => setMessage(event.detail.value)} />
          <Button className="primary-button" disabled={busy || !message.trim() || undefined} onClick={() => { void run(async () => { await api.privacyRequest(kind, message.trim(), babyId); setMessage(""); }, "已提交，可在这里查看回复"); }}>提交请求</Button>
          <Text className="muted">联系渠道：{policy.contact || "尚未配置"}。紧急情况请立即寻求现实帮助，不要等待这里的回复。</Text>
          {requests.map(item => <View key={item.id} className="privacy-request"><Text>{item.message}</Text><Text className="muted">{({ open: "待处理", reviewing: "处理中", resolved: "已回复" })[item.status] || item.status}</Text>{item.reply && <Text>{item.reply}</Text>}</View>)}
          <Button className="text-button" disabled={busy || undefined} onClick={() => { void run(refresh, "已刷新处理进度"); }}>刷新处理进度</Button>
        </View>
      </>}
    </>}
  </View>;
}
