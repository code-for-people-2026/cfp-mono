import type { UserProfile } from "@cfp/hello-agent-contracts";
import { AccountAvatar, AccountProfile } from "./profile";
import { useRef, useState } from "react";
import { Button as TaroButton, type ButtonProps, Checkbox, CheckboxGroup, Input, Label, Picker, ScrollView, Text, View } from "@tarojs/components";
import { ageStateText, type AgeDeclaration, type AgeStatus } from "@cfp/hello-agent-protocol";
import { ageGateStep, declarationForBirthday, todayInChina } from "./age-onboarding";
import * as api from "./api";
import "./age.css";

function Button(props: ButtonProps) {
  return <TaroButton {...props} disabled={props.disabled || undefined} className={`control ${props.className || ""}${props.disabled ? " age-disabled" : ""}`} />;
}
type Detail = "login" | "birthday" | "verification";
const detailTitle: Record<Detail, string> = { login: "登录与使用说明", birthday: "为什么需要生日？", verification: "年龄核验说明" };

export function AgeGate({ profile, avatarSource, status, loadingError, privacyReady, onChange, onRefresh, onLogin, onPrivacy, onHelp, onClose }: {
  profile?: UserProfile; avatarSource?: string;
  status?: AgeStatus; loadingError?: string; privacyReady: boolean; onChange: (status: AgeStatus) => void;
  onRefresh: () => Promise<void>; onLogin: () => Promise<void>; onPrivacy: () => void; onHelp: () => void; onClose: () => void;
}) {
  const [nickname, setNickname] = useState("");
  const [avatarPath, setAvatarPath] = useState("");
  const [migrate, setMigrate] = useState(false);
  const [consent, setConsent] = useState(false);
  const [birthday, setBirthday] = useState("");
  const [declaration, setDeclaration] = useState<AgeDeclaration>();
  const [name, setName] = useState("");
  const [idCard, setIdCard] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const native = process.env.TARO_ENV === "weapp";
  const step = ageGateStep(status, declaration);
  const birthdayDeclaration = declarationForBirthday(birthday);

  async function act(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "暂时没有完成，请再试一次。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function login() {
    if (!status) return;
    await api.loginWechat(migrate, status.notice.version, { nickname, avatarPath });
    setNickname(""); setAvatarPath("");
    setMigrate(false); setDetail(null); setDeclaration(undefined); setBirthday(""); setName(""); setIdCard(""); setConsent(false); await onLogin();
  }
  async function confirmBirthday() {
    if (!status || !birthdayDeclaration) return;
    // Only the age band leaves this form; a birthday never becomes verified evidence.
    if (birthdayDeclaration === "under14" || status.configuration.previewOnly) {
      const result = await api.beginAge({ declaration: birthdayDeclaration, noticeVersion: status.notice.version, consent: true });
      onChange(result.status);
    }
    setDeclaration(birthdayDeclaration); setBirthday("");
  }
  async function submit() {
    const selected = declaration || status?.declaration;
    if (!status || !selected || !consent) return;
    try {
      const result = await api.beginAge({ declaration: selected, noticeVersion: status.notice.version, consent: true });
      onChange(result.status);
      if (result.challenge) onChange(await api.submitAge({ challenge: result.challenge, name, idCard }));
    } finally { setName(""); setIdCard(""); setConsent(false); }
  }
  async function cancel() {
    setBirthday(""); setName(""); setIdCard(""); setConsent(false);
    if (status?.loggedIn) { try { onChange(await api.cancelAge()); } catch { /* Closing never grants access. */ } }
    onClose();
  }
  const explanation = (kind: Detail, label: string) => <Button className="age-link" onClick={() => setDetail(kind)} disabled={busy}>{label}</Button>;

  return <View className="sheet-overlay age-overlay">
    <View className="sheet-backdrop" />
    <View className={`age-panel${detail ? " age-details-panel" : ""}`} ariaRole="dialog" ariaLabel={detail ? detailTitle[detail] : "开始使用阿J"}>
      {detail ? <>
        <View className="age-details-header"><Text className="age-title">{detailTitle[detail]}</Text><Button className="age-link" onClick={() => setDetail(null)}>返回</Button></View>
        <ScrollView className="age-details-scroll" scrollY>
          {detail === "verification" && status?.loggedIn && <Text className="age-note">当前状态：{ageStateText[status.state]}。{status.expiresAt ? `有效期至 ${status.expiresAt.slice(0, 10)}。` : ""}</Text>}
          {detail === "login" && <>
            <Text className="age-note">微信用于识别你的账号、恢复对话。我们保存账号标识的摘要，不获取手机号。点击“同意并微信登录”表示同意登录所需的身份信息处理。</Text>
            <Text className="age-note">登录后会询问生日，再根据年龄申报引导核验；使用授权可在隐私设置中管理。</Text>
            {!status?.configuration.previewOnly && <CheckboxGroup onChange={(event) => setMigrate(event.detail.value.includes("migrate"))}><Label className="age-choice"><Checkbox value="migrate" checked={migrate} /><Text>保留当前设备的旧记录（可选）</Text></Label></CheckboxGroup>}
            <Text className="age-note">{status?.configuration.previewOnly ? "本预览只体验登录和生日，不读取或迁移现有聊天。" : "仅首次绑定且能验证旧记录归属时保留；微信已有记录时恢复原账号，不自动合并其他历史。"}</Text>
            {!native && <Text className="age-note">当前为网页预览，请在微信小程序中登录。网页可查看隐私说明和帮助。</Text>}
            {!status?.configuration.wechat && <Text className="age-note">微信登录服务尚未配置，暂时无法完成真实登录。</Text>}
          </>}
          {detail === "birthday" ? <>
            <Text className="age-note">生日用于判断年龄段，帮助我们采取适合你的保护措施。</Text>
            <Text className="age-note">完整生日只在当前页面计算，不上传、不保存，也不发送给模型。后续仅提交和保存申报年龄段。</Text>
            <Text className="age-note">生日由你自行填写，不能替代年龄核验。未满14岁时不会要求填写姓名或身份证，会先引导监护人提供支持。你也可以关闭窗口，稍后再填。</Text>
            {explanation("verification", "查看年龄核验说明")}
          </> : status?.notice.paragraphs.map((text, index) => <Text key={index} className="age-note" selectable>{text}</Text>)}
          <View className="age-detail-links"><Button className="age-link" onClick={onPrivacy}>隐私政策与数据权利</Button><Button className="age-link" onClick={onHelp}>帮助与反馈</Button></View>
        </ScrollView>
      </> : <>
        {status?.loggedIn && <Button className="age-close" ariaLabel="稍后再说，关闭窗口" disabled={busy} onClick={() => void act(cancel)}>×</Button>}
        {step === "loading" && <>
          <Text className="age-title">{loadingError ? "暂时没连上" : "稍等一下"}</Text>
          <Text className="age-copy">{loadingError ? "请重试，或稍后再来。" : "正在读取登录状态…"}</Text>
          {loadingError && <Button className="age-primary" disabled={busy} onClick={() => void act(onRefresh)}>重试</Button>}
        </>}
        {step === "login" && <>
          <Text className="age-title">先登录一下吧</Text>
          <Text className="age-copy">{status?.configuration.previewOnly ? "用微信登录，体验新的开始方式。" : "用微信登录，留住和阿J的对话。"}</Text>
          <View className="age-profile-fields">
            <View className="age-avatar-option">
            <Button className="age-avatar-picker" openType={native ? "chooseAvatar" : undefined} disabled={busy || !native} onChooseAvatar={(event) => setAvatarPath(event.detail.avatarUrl)} ariaLabel="选择头像，可使用微信头像">
              <AccountAvatar source={avatarPath} /><Text className="age-avatar-caption">选头像</Text>
            </Button>
            {avatarPath && <Button className="age-avatar-reset" ariaLabel="改用随机头像" disabled={busy} onClick={() => setAvatarPath("")}>×</Button>}
            </View>
            <View className="age-nickname-field">
              <Input className="age-nickname" type={native ? "nickname" : "text"} value={nickname} maxlength={24} placeholder="怎么称呼你？" disabled={busy || !native} ariaLabel="昵称，可使用微信昵称" onInput={(event) => setNickname(event.detail.value)} onBlur={(event) => setNickname(event.detail.value)} onNickNameReview={(event) => { if (!event.detail.pass) { setNickname(""); setMessage("这个昵称暂时不能使用，请换一个。"); } }} />
              <Text className="age-profile-hint">可用微信昵称和头像 · 留空随机生成</Text>
            </View>
          </View>
          <Button className="age-primary" disabled={busy || !native || !status?.configuration.wechat} onClick={() => void act(login)}>{busy ? "正在登录…" : "同意并微信登录"}</Button>
          {(!native || !status?.configuration.wechat) && <Text className="age-hint">{!native ? "请在微信小程序中登录" : "登录暂不可用，请稍后再试"}</Text>}
          {explanation("login", "登录与使用说明")}
        </>}
        {step === "birthday" && <>
          {profile && <AccountProfile profile={profile} source={avatarSource} />}
          <Text className="age-title">你的生日是？</Text>
          <Text className="age-copy">方便我们确认适合你的使用方式。</Text>
          <Picker mode="date" start="1900-01-01" end={todayInChina()} value={birthday} disabled={busy} onChange={(event) => setBirthday(event.detail.value)}>
            <View className={`age-date${birthday ? " age-date-selected" : ""}`} ariaRole="button" ariaLabel="选择出生日期"><Text>{birthday ? birthday.replaceAll("-", " / ") : "选择出生日期"}</Text><Text className="age-date-arrow">⌄</Text></View>
          </Picker>
          <Button className="age-primary" disabled={busy || !birthdayDeclaration} onClick={() => void act(confirmBirthday)}>{busy ? "正在确认…" : "继续"}</Button>
          {explanation("birthday", "为什么需要生日？")}
        </>}
        {step === "verify" && <>
          <Text className="age-title">{status?.configuration.previewOnly ? "已完成体验" : status?.configuration.provider ? "确认一下年龄" : "暂时无法核验年龄"}</Text>
          {!status?.configuration.provider ? <>
            <Text className="age-copy">{status?.configuration.previewOnly ? "已完成本次登录和生日体验，年龄核验与聊天稍后开放。" : "服务暂不可用，请稍后再来。"}</Text>
            <Button className="age-primary" onClick={() => void act(cancel)} disabled={busy}>知道了</Button>
          </> : <>
            <Text className="age-copy">需要本人姓名和身份证，由腾讯云核验。</Text>
            <Input className="age-input" value={name} maxlength={50} placeholder="本人姓名" disabled={busy} onInput={(event) => setName(event.detail.value)} />
            <Input className="age-input" password value={idCard} maxlength={18} placeholder="本人18位大陆居民身份证号码" disabled={busy} onInput={(event) => setIdCard(event.detail.value)} />
            <CheckboxGroup onChange={(event) => setConsent(event.detail.value.includes("age"))}><Label className="age-choice"><Checkbox value="age" checked={consent} /><Text>我已阅读核验说明，单独同意处理本人姓名和身份证用于年龄核验。</Text></Label></CheckboxGroup>
            <Button className="age-primary" disabled={busy || !consent || name.trim().length < 2 || !/^\d{17}[\dXx]$/.test(idCard)} onClick={() => void act(submit)}>{busy ? "正在核验…" : "同意并核验"}</Button>
            {status && ["failed", "unknown", "expired", "unavailable"].includes(status.state) && <Text className="age-hint">{ageStateText[status.state]}</Text>}
          </>}
          {explanation("verification", "年龄核验说明")}
        </>}
        {step === "pending" && <>
          <Text className="age-title">正在确认年龄</Text><Text className="age-copy">稍等一下，可以查询本次结果。</Text>
          <Button className="age-primary" disabled={busy} onClick={() => void act(onRefresh)}>查询结果</Button>
          {explanation("verification", "年龄核验说明")}
        </>}
        {step === "blocked" && <>
          <Text className="age-title">还需要一点帮助</Text><Text className="age-copy">{status?.state === "minor" || declaration === "under14" ? "请由监护人联系我们，确认适合你的使用方式。" : "年龄信息需要进一步确认，请联系我们。"}</Text>
          <Button className="age-primary" onClick={onHelp}>联系与反馈</Button>
          {explanation("verification", "查看详细说明")}
        </>}
        {step === "ready" && <>
          <Text className="age-title">{privacyReady ? "已经准备好啦" : "最后，确认使用授权"}</Text><Text className="age-copy">{privacyReady ? "可以继续和阿J聊聊了。" : "你可以选择允许阿J使用的信息。"}</Text>
          <Button className="age-primary" onClick={privacyReady ? onClose : onPrivacy}>{privacyReady ? "继续聊天" : "查看授权"}</Button>
          {explanation("verification", "查看登录与年龄状态")}
        </>}
        {!!message && <Text className="age-error" selectable>{message}</Text>}
      </>}
    </View>
  </View>;
}
