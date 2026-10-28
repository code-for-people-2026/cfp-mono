import { useState } from "react";
import { Input, Label, Checkbox, CheckboxGroup, Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import type { InteractionStatus } from "@cfp/hello-agent-contracts";
import { getInteractionStatus, interactionAction } from "../../chat/api";
import { SettingsPage, PageButton } from "../../chat/settings-page";

export default function SafetyPage() {
  const [status, setStatus] = useState<InteractionStatus>();
  const [name, setName] = useState(""), [phone, setPhone] = useState("");
  const [checked, setChecked] = useState<string[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function act(action: () => Promise<InteractionStatus>) {
    if (busy) return; setBusy(true); setMessage("");
    try { setStatus(await action()); } catch (e) { setMessage(e instanceof Error ? e.message : "操作未完成，请重试"); }
    finally { setBusy(false); }
  }
  useDidShow(() => { void act(getInteractionStatus); });
  return <SettingsPage title="互动安全" back>
    <View className="page-card page-card-padded"><Text className="page-heading">人工支持</Text><Text className="page-copy">{status?.support.hours}</Text><Text className="page-copy" selectable>{status?.support.phone}</Text>
      <PageButton disabled={!status} onClick={() => { if (status) void Taro.makePhoneCall({ phoneNumber: status.support.phone }).catch(() => setMessage("没有拨出电话，请使用上方号码手动拨打。")); }}>拨打人工联系电话</PageButton>
      <Text className="page-caption">紧急情况请先联系当地急救或警方。登记待处理事项不表示已通知或已有人接听。</Text></View>
    <Text className="page-section-title">紧急联系人（选填）</Text>
    <Text className="page-copy">{status?.contactNotice}</Text>
    {status?.contact && <View className="page-card page-card-padded"><Text className="page-copy" selectable>{status.contact.name} · {status.contact.phone}</Text><Text className="page-caption">授权时间：{new Date(status.contact.consentedAt).toLocaleString()}</Text><PageButton disabled={busy} onClick={() => void act(async () => { const s = await interactionAction("remove-contact"); setName(""); setPhone(""); setChecked([]); setMessage("已移除联系人并撤销联络授权。"); return s; })}>移除并撤销授权</PageButton></View>}
    <Input className="page-input" value={name} disabled={busy} maxlength={40} placeholder="联系人姓名" onInput={(e) => setName(e.detail.value)} />
    <Input className="page-input" value={phone} disabled={busy} type="number" maxlength={11} placeholder="中国大陆手机号码" onInput={(e) => setPhone(e.detail.value)} />
    <CheckboxGroup onChange={(e) => setChecked(e.detail.value)}>
      <Label><Checkbox value="consent" checked={checked.includes("consent")} disabled={busy} /><Text>我单独同意上述紧急联络用途</Text></Label>
      <Label><Checkbox value="informed" checked={checked.includes("informed")} disabled={busy} /><Text>我已告知联系人并取得其同意</Text></Label>
    </CheckboxGroup>
    <PageButton className="page-primary" disabled={busy || !status || !name.trim() || !/^1[3-9]\d{9}$/.test(phone) || checked.length !== 2} onClick={() => void act(async () => { const s = await interactionAction("contact", { name: name.trim(), phone, consent: true, contactInformed: true, version: status!.contactVersion }); setName(""); setPhone(""); setChecked([]); setMessage("已保存授权，尚未联系该联系人。"); return s; })}>{busy ? "正在处理…" : "保存联系人及单独授权"}</PageButton>
    {message && <Text className="page-result">{message}</Text>}
  </SettingsPage>;
}
