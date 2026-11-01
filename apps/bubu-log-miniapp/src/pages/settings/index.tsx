import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";
import { api, identityEnabled } from "../../api";
import { IdentitySetup } from "../../components/IdentitySetup";
import type { AuthContext, Baby } from "../../model";
import { identityUpdatedEvent, profileUpdatedEvent, sessionExpiredEvent } from "../../navigation/events";
import "./settings.css";

export default function SettingsPage() {
  const [baby, setBaby] = useState<Baby | null>(null);
  const [context, setContext] = useState<AuthContext | null>(null);
  const [name, setName] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const expire = () => { setContext(null); setBaby(null); setName(""); setFullName(""); setError("登录已过期，请返回首页重新登录。"); };
    Taro.eventCenter.on(sessionExpiredEvent, expire);
    return () => { Taro.eventCenter.off(sessionExpiredEvent, expire); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const babyId = Taro.getCurrentInstance().router?.params.babyId;
    setLoading(true); setError(""); setBaby(null); setContext(null);
    void api.getContext(babyId || undefined).then((context) => {
      if (cancelled) return;
      if (!context.authenticated) {
        Taro.eventCenter.trigger(sessionExpiredEvent);
        throw new Error("登录已过期，请返回首页重新登录。");
      }
      setContext(context);
      if (!context.baby && identityEnabled) return;
      if (!context.baby || (babyId && context.baby.id !== babyId)) throw new Error("暂时无法读取这个宝宝的资料，请返回菜单重新选择。");
      setBaby(context.baby); setName(context.baby.name); setFullName(context.baby.fullName || "");
    }).catch((failure: unknown) => {
      if (failure && typeof failure === "object" && "status" in failure && failure.status === 403) {
        void api.getContext().then((next) => Taro.eventCenter.trigger(identityUpdatedEvent, next)).catch(() => {});
      }
      if (!cancelled) setError(failure instanceof Error ? failure.message : "读取资料失败，请重试。");
    })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);

  const save = async () => {
    if (!baby || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setError(""); setSaved(false);
    try {
      const updated = await api.updateBabyNames(baby.id, { name, fullName });
      // Returning to the calendar during a request must still refresh its menu identity.
      Taro.eventCenter.trigger(profileUpdatedEvent, updated);
      if (mounted.current) { setBaby(updated); setName(updated.name); setFullName(updated.fullName || ""); setSaved(true); }
    } catch (failure) {
      if (failure && typeof failure === "object" && "status" in failure && failure.status === 401) Taro.eventCenter.trigger(sessionExpiredEvent);
      if (failure && typeof failure === "object" && "status" in failure && failure.status === 403) {
        if (mounted.current) { setBaby(null); setContext(null); }
        void api.getContext().then((next) => Taro.eventCenter.trigger(identityUpdatedEvent, next)).catch(() => {});
      }
      if (mounted.current) setError(failure instanceof Error ? failure.message : "保存失败，请重试。");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return <View className="page settings-page">
    {process.env.TARO_ENV === "h5" && <View className="settings-navigation"><Button className="text-button" onClick={() => { void Taro.navigateBack(); }}>‹ 返回</Button><Text>设置</Text><View className="settings-spacer" /></View>}
    {loading ? <View className="state-panel">正在读取宝宝资料…</View> : <>{baby ? <>
      <Text className="settings-heading">宝宝资料</Text>
      <Text className="muted">这里的名字会同步给一起照顾宝宝的家人。</Text>
      <View className="settings-card">
        <Text className="field-label">昵称（小名）</Text>
        <Input className="login-input" ariaLabel="宝宝昵称" placeholder="怎么称呼宝宝" value={name} maxlength={30} disabled={saving || undefined} onInput={(event) => { setName(event.detail.value); setSaved(false); }} />
        <Text className="field-label">姓名（选填）</Text>
        <Input className="login-input" ariaLabel="宝宝姓名" placeholder="宝宝的大名" value={fullName} maxlength={60} disabled={saving || undefined} onInput={(event) => { setFullName(event.detail.value); setSaved(false); }} />
        {error && <Text className="error-text settings-feedback">{error}</Text>}
        {saved && <Text className="settings-success">已保存</Text>}
        <Button className="primary-button" loading={saving} disabled={saving || !name.trim() || undefined} onClick={() => { void save(); }}>保存</Button>
      </View>
    </> : (!identityEnabled || !context?.authenticated) && <View className="state-panel"><Text className="error-text">{error}</Text><Button className="text-button" onClick={() => setRevision((value) => value + 1)}>重新读取</Button><Button className="text-button" onClick={() => { void Taro.navigateBack(); }}>返回首页</Button></View>}
    {identityEnabled && context?.authenticated && <IdentitySetup context={context} settings={context.hasBaby} onComplete={(next) => {
      Taro.eventCenter.trigger(identityUpdatedEvent, next);
      if (mounted.current) { setContext(next); setBaby(next.baby); setName(next.baby?.name || ""); setFullName(next.baby?.fullName || ""); }
    }} />}</>}
  </View>;
}
