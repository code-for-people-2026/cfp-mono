import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { activityTypeLabel } from "../../model/presentation";
import { identityUpdatedEvent, sessionExpiredEvent } from "../../navigation/events";
import {
  addPreferenceValue, changedPreferenceUpdates, clearPreferenceValues, deletePreferenceValue,
  draftFromPreferences, editPreferenceValue, movePreferenceValue, PreferenceRequestTracker,
  reconcilePreferenceDraft, type PreferenceDraft,
} from "../../preferences/options-editor";
import {
  preferenceUnit, validatePreferenceValues, type CarePreferencesView,
  type PreferenceKey, type PreferenceOption,
} from "../../preferences/shared-options";
import "./index.css";

type Group = "milkAmount" | "durationMinutes" | "count";
const groups: Array<{ id: Group; label: string }> = [
  { id: "milkAmount", label: "奶量" }, { id: "durationMinutes", label: "时长" }, { id: "count", label: "次数" },
];
const message = (error: unknown) => error instanceof Error ? error.message : "暂时没有完成，请重试。";
const sourceLabel = (source: PreferenceOption["source"]) => source === "learned" ? "根据记录整理" : source === "manual" ? "家人设置" : "示例选项";
const optionLabel = (option: PreferenceOption) => `${activityTypeLabel(option.activityType)}${option.field === "milkAmount" ? "奶量" : option.field === "durationMinutes" ? "时长" : "次数"}`;

export default function RecordOptionsPage() {
  const routeBabyId = Taro.getCurrentInstance().router?.params.babyId?.trim() ?? "";
  const [scope, setScope] = useState<{ identityId: string; babyId: string; babyName: string } | null>(null);
  const [preferences, setPreferences] = useState<CarePreferencesView | null>(null);
  const [draft, setDraft] = useState<PreferenceDraft>({});
  const [group, setGroup] = useState<Group>("milkAmount");
  const [selectedKey, setSelectedKey] = useState<PreferenceKey | null>(null);
  const [addText, setAddText] = useState("");
  const [inputTexts, setInputTexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const scopeRef = useRef<typeof scope>(null);
  const requestTracker = useRef(new PreferenceRequestTracker());

  const clearPrivateState = useCallback((nextError = "") => {
    scopeRef.current = null;
    setScope(null); setPreferences(null); setDraft({}); setSelectedKey(null); setAddText(""); setInputTexts({});
    setLoading(false); setSaving(false); setStale(false); setNotice(""); setError(nextError);
    requestTracker.current.clear();
  }, []);

  const read = useCallback(async (preserveDraft: boolean) => {
    const currentGeneration = ++generation.current;
    if (!routeBabyId) { clearPrivateState("缺少宝宝范围，请返回设置重新打开。"); return; }
    setLoading(true); setError(""); setNotice("");
    const previous = preferences;
    const previousDraft = draft;
    try {
      const context = await api.getContext(routeBabyId);
      if (currentGeneration !== generation.current || !mounted.current) return;
      if (!context.authenticated) throw new ApiError(401, "登录已过期，请返回首页重新登录。", "UNAUTHORIZED");
      if (!context.identityId || !context.baby || context.baby.id !== routeBabyId || !context.babies.some(baby => baby.id === routeBabyId)) throw new ApiError(403, "已无法访问这个宝宝，请返回首页重新选择。", "BABY_FORBIDDEN");
      const next = await api.getCarePreferences(routeBabyId);
      if (currentGeneration !== generation.current || !mounted.current) return;
      const nextScope = { identityId: context.identityId, babyId: routeBabyId, babyName: context.baby.name };
      scopeRef.current = nextScope;
      setScope(nextScope);
      setPreferences(next);
      setDraft(preserveDraft && previous ? reconcilePreferenceDraft(previous, previousDraft, next) : draftFromPreferences(next));
      setStale(false);
      requestTracker.current.clear();
      if (preserveDraft) setNotice("已读取家人保存的最新版本，并保留你改过的项目。请逐项核对后再保存。");
    } catch (failure) {
      if (currentGeneration !== generation.current || !mounted.current) return;
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) clearPrivateState(message(failure));
      else setError(message(failure));
    } finally {
      if (currentGeneration === generation.current && mounted.current) setLoading(false);
    }
  }, [clearPrivateState, draft, preferences, routeBabyId]);

  useEffect(() => {
    // The route scope is immutable for this page instance; identity events invalidate it.
    mounted.current = true;
    void read(false);
    const expire = () => { generation.current++; clearPrivateState("登录已过期，请返回首页重新登录。"); };
    const identityChanged = (next?: Awaited<ReturnType<typeof api.getContext>>) => {
      const current = scopeRef.current;
      if (next?.authenticated && current && next.identityId === current.identityId && next.baby?.id === current.babyId) return;
      generation.current++; clearPrivateState("身份或宝宝已变化，请返回设置重新打开。");
    };
    Taro.eventCenter.on(sessionExpiredEvent, expire);
    Taro.eventCenter.on(identityUpdatedEvent, identityChanged);
    return () => {
      mounted.current = false; generation.current++;
      Taro.eventCenter.off(sessionExpiredEvent, expire);
      Taro.eventCenter.off(identityUpdatedEvent, identityChanged);
    };
  }, [routeBabyId]);

  const availableGroups = useMemo(() => groups.filter(item => preferences?.options.some(option => option.field === item.id)), [preferences]);
  const groupOptions = useMemo(() => preferences?.options.filter(option => option.field === group) ?? [], [group, preferences]);
  const activeOption = groupOptions.find(option => option.key === selectedKey) ?? groupOptions[0] ?? null;
  useEffect(() => { if (activeOption && activeOption.key !== selectedKey) setSelectedKey(activeOption.key); }, [activeOption, selectedKey]);
  useEffect(() => { if (availableGroups.length && !availableGroups.some(item => item.id === group)) setGroup(availableGroups[0]!.id); }, [availableGroups, group]);

  const updateDraft = (next: PreferenceDraft, resetInputs = true) => {
    if (saving) return;
    setDraft(next); setNotice(""); setError("");
    if (resetInputs) setInputTexts({});
  };
  const validateValue = (option: PreferenceOption, text: string): number | null => {
    const normalized = text.trim();
    if (!normalized) { setError(`请先填写${optionLabel(option)}。`); return null; }
    const value = Number(normalized);
    try { validatePreferenceValues(option.key, [value]); }
    catch { setError(option.field === "count" ? "次数需填写范围内的非负整数。" : `${optionLabel(option)}需填写范围内的非负数字。`); return null; }
    if ((draft[option.key] ?? []).includes(value)) { setError("同一项不能添加重复数值。"); return null; }
    return value;
  };
  const add = () => {
    if (!activeOption || saving) return;
    const value = validateValue(activeOption, addText);
    if (value === null) return;
    updateDraft(addPreferenceValue(draft, activeOption.key, value)); setAddText("");
  };
  const edit = (index: number, text: string) => {
    if (!activeOption || saving) return;
    const inputKey = `${activeOption.key}:${index}`;
    setInputTexts(current => ({ ...current, [inputKey]: text }));
    if (text.trim() === "") return;
    const value = Number(text.trim());
    const others = (draft[activeOption.key] ?? []).filter((_item, itemIndex) => itemIndex !== index);
    try { validatePreferenceValues(activeOption.key, [...others, value]); }
    catch { setError(activeOption.field === "count" ? "次数需为非负整数且不能重复。" : "数值需在允许范围内且不能重复。"); return; }
    updateDraft(editPreferenceValue(draft, activeOption.key, index, value), false);
  };
  const finishEdit = (index: number) => {
    if (!activeOption) return;
    const inputKey = `${activeOption.key}:${index}`;
    setInputTexts(current => {
      const next = { ...current };
      delete next[inputKey];
      return next;
    });
  };

  const save = async () => {
    if (!scope || !preferences || saving || stale) return;
    const saveGeneration = generation.current;
    const updates = changedPreferenceUpdates(preferences, draft);
    if (!updates.length) { setNotice("没有需要保存的修改。"); return; }
    const requestId = requestTracker.current.requestId(preferences.version, updates);
    setSaving(true); setError(""); setNotice("");
    try {
      const receipt = await api.updateCarePreferences({ babyId: scope.babyId, requestId, expectedVersion: preferences.version, updates });
      if (!mounted.current || saveGeneration !== generation.current || scope.babyId !== routeBabyId) return;
      setPreferences(receipt.preferences); setDraft(draftFromPreferences(receipt.preferences));
      setNotice("已保存，全家共用");
      requestTracker.current.clear();
    } catch (failure) {
      if (!mounted.current || saveGeneration !== generation.current) return;
      if (failure instanceof ApiError && failure.status === 409 && failure.code === "VERSION_CONFLICT") {
        setStale(true); setError("家人已更新过这套选项。你的草稿仍保留，请先读取最新版本并核对；不会自动覆盖对方修改。");
      } else if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
        generation.current++; clearPrivateState(message(failure));
      } else setError(message(failure));
    } finally { if (mounted.current) setSaving(false); }
  };

  const values = activeOption ? draft[activeOption.key] ?? [] : [];
  const changedCount = preferences ? changedPreferenceUpdates(preferences, draft).length : 0;
  return <View className="page record-options-page">
    {process.env.TARO_ENV === "h5" && <View className="record-options-navigation"><Button className="record-options-back" onClick={() => { void Taro.navigateBack(); }}>‹ 返回</Button><Text>常用选项</Text><View className="record-options-spacer" /></View>}
    {loading && !preferences ? <View className="record-options-state">正在读取宝宝共用选项…</View> : !scope || !preferences ? <View className="record-options-state"><Text className="record-options-error">{error}</Text><Button className="record-options-secondary" onClick={() => { void read(false); }}>重新读取</Button></View> : <>
      <Text className="record-options-title">常用选项</Text>
      <Text className="record-options-intro">宝宝的常用选项，家人共用。也可以在聊天中调整。</Text>
      <View className="record-options-groups" ariaLabel="常用选项类别">
        {availableGroups.map(item => <Button key={item.id} className={`record-options-group${group === item.id ? " active" : ""}`} disabled={saving || undefined} onClick={() => { setGroup(item.id); setSelectedKey(null); setAddText(""); }}>{item.label}</Button>)}
      </View>
      <View className="record-options-activities" ariaLabel="活动类别">
        {groupOptions.map(option => <Button key={option.key} className={`record-options-activity${activeOption?.key === option.key ? " active" : ""}`} disabled={saving || undefined} onClick={() => { setSelectedKey(option.key); setAddText(""); setError(""); }}>{optionLabel(option)}</Button>)}
      </View>
      {activeOption && <View className="record-options-card">
        <View className="record-options-card-heading"><View><Text className="record-options-option-title">{optionLabel(activeOption)}</Text><Text className="record-options-source">{sourceLabel(activeOption.source)} · 单位：{preferenceUnit(activeOption.field)}</Text></View><Button className="record-options-clear" disabled={saving || !values.length || undefined} onClick={() => updateDraft(clearPreferenceValues(draft, activeOption.key))}>清空自定义</Button></View>
        {activeOption.usingExampleFallback && <View className="record-options-fallback"><Text>下面是通用示例，不代表宝宝的实际习惯或建议。</Text><View className="record-options-example-list">{activeOption.effectiveValues.map(value => <Text key={value} className="record-options-example">{value} {preferenceUnit(activeOption.field)}</Text>)}</View></View>}
        {!values.length ? <Text className="record-options-empty">还没有自定义数值。</Text> : <View className="record-options-values">
          {values.map((value, index) => <View className="record-options-value" key={`${activeOption.key}-${index}`}>
            <Input className="record-options-input" ariaLabel={`${optionLabel(activeOption)}第${index + 1}项`} disabled={saving} type="digit" value={inputTexts[`${activeOption.key}:${index}`] ?? String(value)} onInput={event => edit(index, event.detail.value)} onBlur={() => finishEdit(index)} />
            <Text className="record-options-unit">{preferenceUnit(activeOption.field)}</Text>
            <Button className="record-options-icon" ariaLabel="上移" disabled={saving || index === 0 || undefined} onClick={() => updateDraft(movePreferenceValue(draft, activeOption.key, index, -1))}>↑</Button>
            <Button className="record-options-icon" ariaLabel="下移" disabled={saving || index === values.length - 1 || undefined} onClick={() => updateDraft(movePreferenceValue(draft, activeOption.key, index, 1))}>↓</Button>
            <Button className="record-options-delete" ariaLabel="删除" disabled={saving || undefined} onClick={() => updateDraft(deletePreferenceValue(draft, activeOption.key, index))}>删除</Button>
          </View>)}
        </View>}
        <View className="record-options-add"><Input className="record-options-input" ariaLabel={`添加${optionLabel(activeOption)}`} disabled={saving} type="digit" placeholder={`添加${preferenceUnit(activeOption.field)}数值`} value={addText} onInput={event => { if (!saving) { setAddText(event.detail.value); setError(""); } }} /><Button className="record-options-add-button" disabled={saving || !addText.trim() || undefined} onClick={add}>添加</Button></View>
      </View>}
      {error && <Text className="record-options-error">{error}</Text>}
      {notice && <Text className="record-options-notice">{notice}</Text>}
      {stale ? <Button className="record-options-primary" loading={loading} disabled={loading || undefined} onClick={() => { void read(true); }}>读取最新版本并核对草稿</Button> : <Button className="record-options-primary" loading={saving} disabled={saving || changedCount === 0 || undefined} onClick={() => { void save(); }}>保存 {changedCount ? `${changedCount} 项修改` : "修改"}</Button>}
    </>}
  </View>;
}
