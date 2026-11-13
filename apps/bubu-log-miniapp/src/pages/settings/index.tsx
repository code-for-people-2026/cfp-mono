import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import type { Baby } from "../../model";
import { profileUpdatedEvent, sessionExpiredEvent } from "../../navigation/events";
import {
  DEFAULT_CARE_PREFERENCES,
  getCarePreferences,
  resetCarePreferences,
  saveCarePreferences,
  validateCarePreferences,
  type CarePreferences,
  type CarePreferencesStorageState,
} from "../../preferences/care-preferences";
import { carePreferencesScope, carePreferencesUpdatedEvent } from "../../preferences/runtime";
import "./settings.css";

type RateChoice = CarePreferences["breastfeedRate"]["mode"];

const numberText = (value: number) => String(value);

function hydratePreferenceInputs(preferences: CarePreferences): {
  rateChoice: RateChoice;
  rateMin: string;
  rateMax: string;
  milkMin: string;
  milkMax: string;
  sleepMin: string;
  sleepMax: string;
} {
  return {
    rateChoice: preferences.breastfeedRate.mode,
    rateMin: preferences.breastfeedRate.range ? numberText(preferences.breastfeedRate.range.min) : "",
    rateMax: preferences.breastfeedRate.range ? numberText(preferences.breastfeedRate.range.max) : "",
    milkMin: preferences.milkReference ? numberText(preferences.milkReference.min) : "",
    milkMax: preferences.milkReference ? numberText(preferences.milkReference.max) : "",
    sleepMin: preferences.sleepReference ? numberText(preferences.sleepReference.min / 60) : "",
    sleepMax: preferences.sleepReference ? numberText(preferences.sleepReference.max / 60) : "",
  };
}

export default function SettingsPage() {
  const [baby, setBaby] = useState<Baby | null>(null);
  const [name, setName] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  const [rateChoice, setRateChoice] = useState<RateChoice>(DEFAULT_CARE_PREFERENCES.breastfeedRate.mode);
  const [rateMin, setRateMin] = useState(numberText(DEFAULT_CARE_PREFERENCES.breastfeedRate.range!.min));
  const [rateMax, setRateMax] = useState(numberText(DEFAULT_CARE_PREFERENCES.breastfeedRate.range!.max));
  const [milkCustom, setMilkCustom] = useState(false);
  const [milkMin, setMilkMin] = useState("");
  const [milkMax, setMilkMax] = useState("");
  const [sleepCustom, setSleepCustom] = useState(false);
  const [sleepMin, setSleepMin] = useState("");
  const [sleepMax, setSleepMax] = useState("");
  const [storageState, setStorageState] = useState<CarePreferencesStorageState>("empty");
  const [careError, setCareError] = useState("");
  const [careSaved, setCareSaved] = useState("");
  const mounted = useRef(true);
  const savingRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const setPreferencesFromValue = (preferences: CarePreferences, nextState: CarePreferencesStorageState) => {
    const inputs = hydratePreferenceInputs(preferences);
    setRateChoice(inputs.rateChoice);
    setRateMin(inputs.rateMin);
    setRateMax(inputs.rateMax);
    setMilkCustom(preferences.milkReference !== null);
    setMilkMin(inputs.milkMin);
    setMilkMax(inputs.milkMax);
    setSleepCustom(preferences.sleepReference !== null);
    setSleepMin(inputs.sleepMin);
    setSleepMax(inputs.sleepMax);
    setStorageState(nextState);
  };

  const clearPreferenceUi = () => {
    setPreferencesFromValue(DEFAULT_CARE_PREFERENCES, "empty");
    setCareError("");
    setCareSaved("");
  };

  useEffect(() => {
    const expire = () => {
      setBaby(null); setName(""); setFullName(""); setSaved(false); setSaving(false); savingRef.current = false;
      clearPreferenceUi();
      setError("登录已过期，请返回首页重新登录。");
    };
    Taro.eventCenter.on(sessionExpiredEvent, expire);
    return () => { Taro.eventCenter.off(sessionExpiredEvent, expire); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const babyId = Taro.getCurrentInstance().router?.params.babyId;
    setLoading(true); setError("");
    void api.getContext(babyId || undefined).then((context) => {
      if (cancelled) return;
      if (!context.authenticated) {
        Taro.eventCenter.trigger(sessionExpiredEvent);
        throw new Error("登录已过期，请返回首页重新登录。");
      }
      if (!context.baby || (babyId && context.baby.id !== babyId)) throw new Error("暂时无法读取这个宝宝的资料，请返回菜单重新选择。");
      setBaby(context.baby); setName(context.baby.name); setFullName(context.baby.fullName || "");
    }).catch((failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "读取资料失败，请重试。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);

  useEffect(() => {
    if (!baby) return;
    let cancelled = false;
    clearPreferenceUi();
    try {
      const result = getCarePreferences(carePreferencesScope(baby.id));
      if (!cancelled) setPreferencesFromValue(result.preferences, result.storageState);
    } catch (failure) {
      if (!cancelled) {
        setStorageState("empty");
        setCareError(failure instanceof Error ? failure.message : "暂时无法读取本机参考设置。");
      }
    }
    return () => { cancelled = true; };
  }, [baby?.id]);

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
      if (mounted.current) setError(failure instanceof Error ? failure.message : "保存失败，请重试。");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const clearCareFeedback = () => {
    setCareError("");
    setCareSaved("");
  };

  const selectResearchRate = () => {
    clearCareFeedback();
    setRateChoice("research");
    setRateMin(numberText(DEFAULT_CARE_PREFERENCES.breastfeedRate.range!.min));
    setRateMax(numberText(DEFAULT_CARE_PREFERENCES.breastfeedRate.range!.max));
  };

  const selectCustomRate = () => {
    clearCareFeedback();
    setRateMin((current) => current || numberText(DEFAULT_CARE_PREFERENCES.breastfeedRate.range!.min));
    setRateMax((current) => current || numberText(DEFAULT_CARE_PREFERENCES.breastfeedRate.range!.max));
    setRateChoice("custom");
  };

  const parsePositiveRange = (
    minimum: string,
    maximum: string,
    bounds: { min: number; max: number; unit: string },
  ): { min: number; max: number } | null => {
    const lower = Number(minimum.trim());
    const upper = Number(maximum.trim());
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower <= 0 || upper <= 0) {
      setCareError(`${bounds.unit}需填写大于 0 的数字。`);
      return null;
    }
    if (lower < bounds.min || upper > bounds.max) {
      setCareError(`${bounds.unit}需在 ${bounds.min}–${bounds.max} 之间。`);
      return null;
    }
    if (lower > upper) {
      setCareError(`${bounds.unit}下限不能大于上限。`);
      return null;
    }
    return { min: lower, max: upper };
  };

  const buildPreferences = (): CarePreferences | null => {
    let preferences: CarePreferences | null = null;
    if (rateChoice === "off") {
      preferences = { breastfeedRate: { mode: "off", range: null, source: "user-disabled" }, milkReference: null, sleepReference: null };
    } else {
      const rate = parsePositiveRange(rateMin, rateMax, { min: 0.1, max: 30, unit: "亲喂估算速度（ml/分钟）" });
      if (!rate) return null;
      preferences = {
        breastfeedRate: {
          mode: rateChoice,
          range: rate,
          source: rateChoice === "research" ? "research-heuristic" : "user-custom",
        },
        milkReference: null,
        sleepReference: null,
      };
    }

    if (milkCustom) {
      const milk = parsePositiveRange(milkMin, milkMax, { min: 1, max: 3000, unit: "每日奶量参考（ml）" });
      if (!milk) return null;
      preferences.milkReference = milk;
    }
    if (sleepCustom) {
      const sleepHours = parsePositiveRange(sleepMin, sleepMax, { min: 0.1, max: 24, unit: "每日睡眠参考（小时）" });
      if (!sleepHours) return null;
      preferences.sleepReference = { min: sleepHours.min * 60, max: sleepHours.max * 60 };
    }
    const result = validateCarePreferences(preferences);
    if (!result.ok) {
      setCareError(result.issues[0]?.message ?? "本机参考设置不完整。");
      return null;
    }
    return result.value;
  };

  const savePreferences = () => {
    if (!baby) {
      setCareError("请先确认当前宝宝。");
      return;
    }
    clearCareFeedback();
    const preferences = buildPreferences();
    if (!preferences) return;
    try {
      const scope = carePreferencesScope(baby.id);
      saveCarePreferences(scope, preferences);
      setPreferencesFromValue(preferences, "valid");
      setCareSaved("本机参考设置已保存。");
      Taro.eventCenter.trigger(carePreferencesUpdatedEvent, baby.id);
    } catch (failure) {
      setCareError(failure instanceof Error ? failure.message : "保存本机参考设置失败，请重试。");
    }
  };

  const restoreDefaults = () => {
    if (!baby) {
      setCareError("请先确认当前宝宝。");
      return;
    }
    clearCareFeedback();
    try {
      const scope = carePreferencesScope(baby.id);
      resetCarePreferences(scope);
      setPreferencesFromValue(DEFAULT_CARE_PREFERENCES, "empty");
      setCareSaved("已恢复初始参考设置。");
      Taro.eventCenter.trigger(carePreferencesUpdatedEvent, baby.id);
    } catch (failure) {
      setCareError(failure instanceof Error ? failure.message : "恢复初始参考设置失败，请重试。");
    }
  };

  return <View className="page settings-page">
    {process.env.TARO_ENV === "h5" && <View className="settings-navigation"><Button className="text-button" onClick={() => { void Taro.navigateBack(); }}>‹ 返回</Button><Text>设置</Text><View className="settings-spacer" /></View>}
    {loading ? <View className="state-panel">正在读取宝宝资料…</View> : baby ? <>
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
      <Text className="settings-subheading">本机参考设置</Text>
      <Text className="muted">仅用于本机的当前宝宝，不同步给家人。所有数字都是家庭参考估算，不是医疗诊断或精确测量。</Text>
      <View className="settings-card preference-card">
        <Text className="preference-title">亲喂估算速度</Text>
        {storageState === "corrupt" && <Text className="preference-warning">本机数据已损坏，正在显示初始参考；保存后会修复。</Text>}
        <Text className="muted">初始 5–10 ml/分钟依据公开研究作粗略估计，可按个人情况调整；不代表每个人的标准流速。</Text>
        <View className="settings-segment">
          <Button className={`segment-button${rateChoice === "research" ? " active" : ""}`} ariaLabel="亲喂按初始参考估算" onClick={selectResearchRate}>初始参考 5–10</Button>
          <Button className={`segment-button${rateChoice === "custom" ? " active" : ""}`} ariaLabel="亲喂自定义速度区间" onClick={selectCustomRate}>自定义区间</Button>
          <Button className={`segment-button${rateChoice === "off" ? " active" : ""}`} ariaLabel="不估算亲喂奶量" onClick={() => { clearCareFeedback(); setRateChoice("off"); }}>不估算亲喂</Button>
        </View>
        {rateChoice !== "off" && <View className="range-row">
          <View className="range-field">
            <Text className="field-label">下限 ml/分钟</Text>
            <Input className="login-input" ariaLabel="亲喂速度下限" type="digit" placeholder="5" value={rateMin} disabled={rateChoice === "research" || undefined} onInput={(event) => { clearCareFeedback(); setRateMin(event.detail.value); }} />
          </View>
          <View className="range-field">
            <Text className="field-label">上限 ml/分钟</Text>
            <Input className="login-input" ariaLabel="亲喂速度上限" type="digit" placeholder="10" value={rateMax} disabled={rateChoice === "research" || undefined} onInput={(event) => { clearCareFeedback(); setRateMax(event.detail.value); }} />
          </View>
        </View>}

        <View className="preference-divider" />
        <Text className="preference-title">每日参考区间</Text>
        <View className="reference-toggle">
          <Text className="field-label">奶量参考</Text>
          <View className="settings-segment compact">
            <Button className={`segment-button${!milkCustom ? " active" : ""}`} ariaLabel="奶量按月龄参考" onClick={() => { clearCareFeedback(); setMilkCustom(false); }}>按月龄</Button>
            <Button className={`segment-button${milkCustom ? " active" : ""}`} ariaLabel="自定义奶量参考" onClick={() => { clearCareFeedback(); setMilkCustom(true); }}>自定</Button>
          </View>
        </View>
        {milkCustom && <View className="range-row">
          <View className="range-field">
            <Text className="field-label">下限 ml/日</Text>
            <Input className="login-input" ariaLabel="每日奶量下限" type="digit" placeholder="600" value={milkMin} onInput={(event) => { clearCareFeedback(); setMilkMin(event.detail.value); }} />
          </View>
          <View className="range-field">
            <Text className="field-label">上限 ml/日</Text>
            <Input className="login-input" ariaLabel="每日奶量上限" type="digit" placeholder="800" value={milkMax} onInput={(event) => { clearCareFeedback(); setMilkMax(event.detail.value); }} />
          </View>
        </View>}
        <View className="reference-toggle">
          <Text className="field-label">睡眠参考</Text>
          <View className="settings-segment compact">
            <Button className={`segment-button${!sleepCustom ? " active" : ""}`} ariaLabel="睡眠按月龄参考" onClick={() => { clearCareFeedback(); setSleepCustom(false); }}>按月龄</Button>
            <Button className={`segment-button${sleepCustom ? " active" : ""}`} ariaLabel="自定义睡眠参考" onClick={() => { clearCareFeedback(); setSleepCustom(true); }}>自定</Button>
          </View>
        </View>
        {sleepCustom && <View className="range-row">
          <View className="range-field">
            <Text className="field-label">下限 小时/日</Text>
            <Input className="login-input" ariaLabel="每日睡眠下限小时" type="digit" placeholder="12" value={sleepMin} onInput={(event) => { clearCareFeedback(); setSleepMin(event.detail.value); }} />
          </View>
          <View className="range-field">
            <Text className="field-label">上限 小时/日</Text>
            <Input className="login-input" ariaLabel="每日睡眠上限小时" type="digit" placeholder="15" value={sleepMax} onInput={(event) => { clearCareFeedback(); setSleepMax(event.detail.value); }} />
          </View>
        </View>}
        <Text className="preference-note">月龄参考按记录日期计算，不按打开设置页的今天计算。「便」统计所有更换过的尿布；观察尿量时，请把更换次数和重湿尿布数分开看，不把固定次数当作医学正常值。户外家庭目标固定为 60/120/180 分钟。</Text>
        {careError && <Text className="error-text settings-feedback">{careError}</Text>}
        {careSaved && <Text className="settings-success">{careSaved}</Text>}
        <View className="settings-actions">
          <Button className="primary-button preference-save" onClick={savePreferences}>保存参考设置</Button>
          <Button className="settings-secondary" onClick={restoreDefaults}>恢复初始参考设置</Button>
        </View>
      </View>
    </> : <View className="state-panel"><Text className="error-text">{error}</Text><Button className="text-button" onClick={() => setRevision((value) => value + 1)}>重新读取</Button><Button className="text-button" onClick={() => { void Taro.navigateBack(); }}>返回首页</Button></View>}
  </View>;
}
