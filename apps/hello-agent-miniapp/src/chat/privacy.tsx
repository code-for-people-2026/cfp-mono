import { useEffect, useRef, useState } from "react";
import { Checkbox, CheckboxGroup, Input, Label, Text, View } from "@tarojs/components";
import Taro, { useDidShow, useRouter } from "@tarojs/taro";
import * as api from "./api";
import { PageButton, SettingsPage, SettingsRow } from "./settings-page";
import { notifyPrivacyChange, openHelp, openPrivacy, privacyChangedEvent, type PrivacyChange } from "./settings-navigation";
import "./privacy.css";

import type { PrivacyPolicy as Policy, PrivacyStatus } from "@cfp/hello-agent-contracts";
export type { PrivacyPolicy as Policy, PrivacyStatus } from "@cfp/hello-agent-contracts";
export function consentCurrent(status?: PrivacyStatus) {
  return status?.state === "active" && status.consent?.version === status.policy.version && (!status.expiresAt || Date.parse(status.expiresAt) > Date.now());
}

function usePrivacy() {
  const [policy, setPolicy] = useState<Policy>();
  const [status, setStatus] = useState<PrivacyStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function refresh() {
    setLoading(true); setError("");
    try {
      setPolicy(await api.getLegal());
      try { await api.establishIdentity(); setStatus(await api.getPrivacy()); }
      catch (value) { setStatus(undefined); throw value; }
    } catch (value) { setError(value instanceof Error ? value.message : "暂时无法读取，请重试"); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void refresh();
    const changed = (change: PrivacyChange) => {
      if (change.clearIdentity) void refresh();
      else if (change.status) { setStatus(change.status); setPolicy(change.status.policy); }
    };
    Taro.eventCenter.on(privacyChangedEvent, changed);
    return () => { Taro.eventCenter.off(privacyChangedEvent, changed); };
  }, []);
  return { policy, status, setStatus, loading, error, refresh };
}
function dataPage(action: string) { void Taro.navigateTo({ url: `/pages/privacy/data/index?action=${action}` }); }
function LoadState({ loading, error, retry }: { loading: boolean; error: string; retry: () => Promise<void> }) {
  return <>{loading && <Text className="page-caption">正在读取…</Text>}{error && <View className="page-result page-error"><Text>{error}</Text><PageButton className="page-link" onClick={() => void retry()}>重新读取</PageButton></View>}</>;
}

export function PrivacyHome() {
  const { status, loading, error, refresh } = usePrivacy();
  const shown = useRef(false);
  useDidShow(() => { if (shown.current) void refresh(); shown.current = true; });
  return <SettingsPage title="隐私与数据">
    <Text className="page-intro">由你决定如何使用和管理自己的数据。</Text>
    <Text className="page-section-title">数据管理</Text>
    <View className="page-card">
      <SettingsRow title="授权管理" description="查看或调整信息处理权限" detail={loading ? "" : consentCurrent(status) ? "已授权" : "待确认"} onClick={() => void openPrivacy("authorization")} />
      <SettingsRow title="导出数据" description="保存一份对话、作品和图片副本" onClick={() => dataPage("export")} />
      <SettingsRow title="删除数据" description="删除与当前身份关联的在线数据" danger onClick={() => dataPage("delete")} />
    </View>
    <Text className="page-section-title">政策与支持</Text>
    <View className="page-card">
      <SettingsRow title="政策与协议" onClick={() => void openPrivacy("policies")} />
      <SettingsRow title="隐私权利请求" description="申请查阅、更正、补充或其他协助" onClick={() => void openHelp(undefined, "privacy")} />
      <SettingsRow title="身份恢复与旧记录" onClick={() => dataPage("recovery")} />
    </View>
    <LoadState loading={loading} error={error} retry={refresh} />
    {status?.state === "deleting" && <Text className="page-result">删除尚未完成，请进入“删除数据”重试。</Text>}
  </SettingsPage>;
}

export function PrivacyAuthorization() {
  const { policy, status, setStatus, loading, error, refresh } = usePrivacy();
  const [checked, setChecked] = useState<string[]>([]);
  const [recipient, setRecipient] = useState({ name: "", contact: "", region: "", privacyUrl: "" });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    // Only display previously granted, still-current scopes. New consent is never preselected.
    if (!consentCurrent(status) || !status?.consent) { setChecked([]); return; }
    const saved = status.consent;
    setChecked((["core", "model", "sensitive", "external"] as const).filter((key) => saved[key]));
    if (saved.externalRecipient) setRecipient(saved.externalRecipient);
  }, [status]);
  const choices = [
    { key: "core", title: "对话存储", tag: "基础服务", description: "我已阅读隐私政策、服务协议与第三方说明，同意保存对话以提供服务。" },
    { key: "model", title: "模型生成与安全审核", tag: "基础服务", description: "我同意将必要输入、历史、摘要与作品发送 DeepSeek 生成及安全审核；BYOK 和外部提交也适用所列说明。" },
    { key: "sensitive", title: "敏感信息处理", tag: "可选", description: "单独同意处理我主动提供的敏感信息，用于图片、情绪练习、回应及安全审核。可能涉及健康或人脸，泄露会影响个人权益；可不选并只发送不含此类信息的普通文字。" },
    { key: "external", title: "外部 Agent 访问", tag: "可选", description: "单独授权我选择并提供令牌的外部 Agent 读取全部历史、摘要和图片。我会先核查其接收方、地域与留存说明；可不选并使用平台或 BYOK。" },
  ];
  async function save() {
    if (!policy || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      await api.establishIdentity();
      const next = await api.updateConsent({ version: policy.version, core: true, model: true, sensitive: checked.includes("sensitive"), external: checked.includes("external"), ...(checked.includes("external") ? { externalRecipient: recipient } : {}) });
      setStatus(next); notifyPrivacyChange({ status: next }); setMessage("授权已保存。");
    } catch (value) { setMessage(value instanceof Error ? value.message : "保存未完成，请重试"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <SettingsPage title="授权管理" back>
    <Text className="page-intro">按需选择权限，随时可以调整。首次授权不预选。</Text>
    <LoadState loading={loading} error={error} retry={refresh} />
    {message && <Text className="page-result">{message}</Text>}
    <PageButton className="page-link privacy-policy-link" onClick={() => void openPrivacy("policies")}>阅读隐私政策、服务协议与第三方说明 ›</PageButton>
    <CheckboxGroup onChange={(event) => setChecked(event.detail.value)}>
      <View className="page-card">{choices.map((choice) => <Label className="privacy-choice" key={choice.key}>
        <Checkbox value={choice.key} checked={checked.includes(choice.key)} disabled={busy || loading} color="#56765d" />
        <View className="privacy-choice-copy"><View className="privacy-choice-heading"><Text>{choice.title}</Text><Text className="privacy-choice-tag">{choice.tag}</Text></View><Text className="privacy-choice-description">{choice.description}</Text></View>
      </Label>)}</View>
    </CheckboxGroup>
    {checked.includes("external") && <View className="privacy-recipient"><Text className="page-section-title">外部接收方信息</Text><Text className="page-caption">填写实际使用的客户端及模型接收方；不明时请先使用平台或 BYOK。跨境处理须满足政策所述前提，填写不代表跨境手续获准。</Text>{([["name", "客户端及模型服务商名称"], ["contact", "接收方权利联系渠道"], ["region", "实际数据处理地域"], ["privacyUrl", "隐私政策完整 https 地址"]] as const).map(([key, label]) => <Input key={key} className="page-input" value={recipient[key]} disabled={busy} maxlength={500} placeholder={label} onInput={(event) => setRecipient((current) => ({ ...current, [key]: event.detail.value }))} />)}</View>}
    <PageButton className="page-primary" disabled={busy || loading || !policy || !checked.includes("core") || !checked.includes("model")} onClick={() => void save()}>{busy ? "正在保存…" : "保存授权选择"}</PageButton>
    <Text className="page-caption">取消可选项后保存即可撤销该项授权。取消敏感信息处理后，含相关历史的对话不能继续交给模型，可导出或删除。停止全部处理，请撤回全部授权。</Text>
    <PageButton className="page-secondary" onClick={() => dataPage("withdraw")}>撤回全部授权</PageButton>
  </SettingsPage>;
}

export function PrivacyPolicies() {
  const { policy, loading, error, refresh } = usePrivacy();
  return <SettingsPage title="政策与协议" back>
    <Text className="page-intro">了解服务如何使用、保存和保护你的信息。</Text>
    <LoadState loading={loading} error={error} retry={refresh} />
    <View className="page-card">{policy?.documents.map((item, index) => <SettingsRow key={item.title} title={item.title} onClick={() => void Taro.navigateTo({ url: `/pages/privacy/document/index?document=${index}` })} />)}</View>
    {policy && <Text className="page-caption">版本 {policy.version}{!policy.ready ? " · 运营资料待确认" : ""}</Text>}
  </SettingsPage>;
}

export function PrivacyDocument() {
  const { policy, loading, error, refresh } = usePrivacy();
  const index = Number(useRouter().params.document || 0);
  const document = policy?.documents[index];
  return <SettingsPage title={document?.title || "政策正文"} back>
    <LoadState loading={loading} error={error} retry={refresh} />
    {document && <><Text className="privacy-document-version">版本 {policy?.version}</Text>{document.paragraphs.map((paragraph, i) => <Text key={i} className="privacy-paragraph" selectable>{paragraph}</Text>)}</>}
    {policy && !document && <Text className="page-result page-error">未找到这份文件，请返回重新选择。</Text>}
  </SettingsPage>;
}

const dataTitles: Record<string, string> = { export: "导出数据", delete: "删除数据", recovery: "身份恢复与旧记录", withdraw: "撤回全部授权", logout: "撤销所有连接" };
export function PrivacyData() {
  const action = useRouter().params.action || "export";
  const { status, setStatus, loading, error, refresh } = usePrivacy();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false), [done, setDone] = useState(false);
  const [code, setCode] = useState(""), [recovery, setRecovery] = useState(""), [confirmation, setConfirmation] = useState("");
  const inFlight = useRef(false);
  async function act(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage(""); setFailed(false);
    try { await work(); } catch (value) { setFailed(true); setMessage(value instanceof Error ? value.message : "未完成，请重试"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const unavailable = busy || loading || !status || done;
  return <SettingsPage title={dataTitles[action] || "数据管理"} back>
    <LoadState loading={loading} error={error} retry={refresh} />
    {message && <Text className={`page-result ${failed ? "page-error" : ""}`} selectable>{message}</Text>}
    {!loading && !status && !done && action !== "recovery" && <Text className="page-result">当前没有有效身份。可以先在“身份恢复与旧记录”中找回，再管理原有数据。</Text>}
    {action === "export" && <>
      <Text className="page-intro">将属于你的记录保存一份，方便查阅和备份。</Text>
      <View className="page-card page-card-padded"><Text className="page-heading">导出包含哪些内容</Text><Text className="page-copy">对话输入与回应作品、对话摘要、执行轨迹，以及上传的图片。</Text><Text className="page-caption">被隔离的图片可能仅保留说明。自助导出上限为 8 MB 或 1000 条记录，超限可通过隐私政策中的联系渠道申请完整副本。</Text></View>
      <Text className="page-caption">文件可能含有私密信息，请妥善保管，分享前先检查内容。导出不会删除在线记录。</Text>
      <PageButton className="page-primary" disabled={unavailable} onClick={() => void act(async () => { await api.exportPersonalData(); setMessage("已发起导出，请保存文件并妥善保管其中的私密信息。"); })}>{busy ? "正在导出…" : "导出我的数据与图片"}</PageButton>
    </>}
    {action === "delete" && <>
      <Text className="page-intro">删除前，请确认已经保存需要的记录。</Text>
      <View className="page-card page-card-padded"><Text className="page-heading">这项操作无法撤销</Text><Text className="page-copy">处理将被冻结，全部在线关联记录、图片和连接凭证将被删除。</Text><Text className="page-copy">备份、供应商副本及依法暂缓删除的运营记录按政策分别处理；删除失败时保留必要记录供重试。</Text><PageButton className="page-link" onClick={() => dataPage("export")}>先导出一份数据 ›</PageButton></View>
      <Text className="page-section-title">输入下方文字，确认删除</Text><Text className="privacy-confirm-label">删除我的全部在线数据</Text>
      <Input className="page-input" value={confirmation} disabled={busy || done} placeholder="请输入上方完整文字" maxlength={30} onInput={(event) => setConfirmation(event.detail.value)} />
      <PageButton className="page-primary page-danger" disabled={unavailable || confirmation !== "删除我的全部在线数据"} onClick={() => void act(async () => { const result = await api.deletePersonalData(confirmation); notifyPrivacyChange({ clearIdentity: true }); setStatus(undefined); setCode(""); setConfirmation(""); setDone(true); setMessage(`在线聊天数据删除已完成。${result.operations?.notice || ""}${result.backupNotice}`); })}>{busy ? "正在删除…" : status?.state === "deleting" ? "重试删除在线数据" : "确认删除在线数据"}</PageButton>
    </>}
    {action === "withdraw" && <>
      <View className="page-card page-card-padded"><Text className="page-heading">撤回后会发生什么</Text><Text className="page-copy">将停止生成、上传和外部访问，并将数据列入清理。已经发出的请求无法召回。</Text><Text className="page-copy">请先导出需要的记录。你也可以返回授权管理，只关闭可选权限。</Text><PageButton className="page-link" onClick={() => dataPage("export")}>先导出一份数据 ›</PageButton></View>
      <PageButton className="page-primary page-danger" disabled={unavailable} onClick={() => void act(async () => { const next = await api.withdrawConsent(); setStatus(next); notifyPrivacyChange({ status: next }); setDone(true); setMessage("全部授权已撤回，数据停止新处理并等待清理。你也可以进入删除数据立即执行删除。"); })}>{busy ? "正在撤回…" : "确认撤回全部授权"}</PageButton>
    </>}
    {action === "recovery" && <>
      <Text className="page-intro">退出或清除缓存前，请保存恢复码。恢复码可以找回原有记录，请像密码一样妥善保管。</Text>
      <View className="page-card page-card-padded"><Text className="page-heading">保管当前记录的恢复码</Text><Text className="page-copy">访客记录在凭证到期或清缓存后不能自动找回。请保存恢复码；重新生成会使旧恢复码失效。</Text>
        <PageButton className="page-secondary" disabled={unavailable} onClick={() => void act(async () => { setCode((await api.createRecoveryCode()).code); setStatus((current) => current ? { ...current, hasRecoveryCode: true } : current); })}>{status?.hasRecoveryCode ? "更换恢复码（旧码失效）" : "生成恢复码"}</PageButton>
        {code && <><Text className="privacy-code" selectable>{code}</Text><PageButton className="page-link" onClick={() => void act(async () => { await api.copy(code); setMessage("恢复码已复制，请自行妥善保管。"); })}>复制恢复码</PageButton></>}
      </View>
      <Text className="page-section-title">恢复原有记录</Text><View className="page-card page-card-padded"><Text className="page-copy">填入此前保存的恢复码。恢复成功后，原有连接将被撤销。</Text>
        <Input className="page-input" password value={recovery} maxlength={60} disabled={busy} placeholder="填写此前保存的恢复码" onInput={(event) => setRecovery(event.detail.value)} />
        <PageButton className="page-primary" disabled={busy || !recovery.trim()} onClick={() => void act(async () => { await api.recoverIdentity(recovery); setRecovery(""); setCode(""); notifyPrivacyChange({ clearIdentity: true }); await refresh(); setMessage("记录已恢复，旧连接已撤销。返回聊天后将更新记录。"); })}>恢复记录</PageButton>
      </View>
      <Text className="page-caption">没有任何有效凭证时，请通过隐私权利请求联系运营方核验归属。不要在反馈中发送完整恢复码。</Text>
      <PageButton className="page-link" onClick={() => void openHelp(undefined, "privacy")}>申请隐私权利协助 ›</PageButton>
      {status && <PageButton className="page-secondary" onClick={() => dataPage("logout")}>退出并撤销所有连接</PageButton>}
    </>}
    {action === "logout" && <>
      <View className="page-card page-card-padded"><Text className="page-heading">退出前请保存恢复方式</Text><Text className="page-copy">退出会撤销全部设备及 MCP 连接，数据仍按政策保留。旧记录需要恢复码才能自行找回。</Text></View>
      <PageButton className="page-primary" disabled={unavailable} onClick={() => void act(async () => { await api.logoutIdentity(); notifyPrivacyChange({ clearIdentity: true }); setStatus(undefined); setCode(""); setDone(true); setMessage("已退出，全部连接已撤销，数据仍按政策保留。"); })}>确认退出并撤销连接</PageButton>
    </>}
  </SettingsPage>;
}
