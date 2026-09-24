import mixerIcon from "../../assets/mixer.svg";
import searchIcon from "../../assets/search.svg";
import greenCheckIcon from "../../assets/check-green.svg";
import checkIcon from "../../assets/check.svg";
import backIcon from "../../assets/back.svg";
import nextIcon from "../../assets/next.svg";
import archiveIcon from "../../assets/archive.svg";
import { useEffect, useRef, useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { Image, Input, Picker, Switch, ScrollView, Text, Textarea, View } from "@tarojs/components";
import { CategorySchema, StructureSchema, WeekStartSchema, type Category, type Dish, type GenerateInput, type MenuPreview, type WeekPlan } from "@cfp/kith-inn-contracts";
import { ClientError, getKithInnClient, type WriteResult } from "../../lib/api";
import { WeekEditError, randomReplaceDish, replacementCandidates, replaceDish, restoreSoup, setSoupOmitted, toWeekWriteInput } from "../../lib/week-editor";
import { Button } from "../../lib/button";
import { DishName, DishNameProvider } from "../../lib/dish-name";
import { labels } from "../../lib/classify";
import { formatMealExample, formatMealText } from "../../lib/menu-text";
import { MainNav } from "../../lib/main-nav";
import { weekRange, WeekBoard, firstPosition, type DishPosition } from "../../lib/week-board";

const categories = CategorySchema.options;
const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
function addDays(date: string, count: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10); }
function todayInChina() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function thisMonday() {
  const today = todayInChina();
  return addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
}
function selections(date: string): GenerateInput["meals"] {
  return Array.from({ length: 14 }, (_, i) => ({ date: addDays(date, Math.floor(i / 2)), mealType: i % 2 ? "dinner" : "lunch", enabled: true }));
}
function defaultMealIndex(menu: MenuPreview | null) {
  const today = menu?.meals.findIndex((meal) => meal.enabled && meal.date === todayInChina()) ?? -1;
  return today >= 0 ? today : menu?.meals.findIndex((meal) => meal.enabled) ?? -1;
}

function MealPicker({ menu, index, disabled, onChange, compactDates = false }: { menu: MenuPreview; index: number; disabled: boolean; onChange: (index: number) => void; compactDates?: boolean }) {
  const days = dayNames.map((day, i) => {
    const date = addDays(menu.weekStart, i);
    return { label: compactDates ? `${date === todayInChina() ? "今天 · " : ""}${Number(date.slice(5, 7))}月${Number(date.slice(8))}日 ${day}` : `${day} · ${date}`, index: i };
  })
    .filter(({ index }) => menu.meals.slice(index * 2, index * 2 + 2).some((meal) => meal.enabled));
  const selectedDay = Math.floor(index / 2);
  const chooseDay = (day: number) => onChange(menu.meals[day * 2]!.enabled ? day * 2 : day * 2 + 1);
  return <>
    {process.env.TARO_ENV === "h5" ? <select className="copy-date" aria-label="选择日期" value={selectedDay} disabled={disabled} onChange={(event) => chooseDay(Number(event.target.value))}>
      {days.map((day) => <option key={day.index} value={day.index}>{day.label}</option>)}
    </select> : <Picker mode="selector" range={days.map((day) => day.label)} value={Math.max(0, days.findIndex((day) => day.index === selectedDay))} disabled={disabled}
      onChange={(event) => chooseDay(days[Number(event.detail.value)]!.index)}>
      <View className="copy-date">{days.find((day) => day.index === selectedDay)?.label ?? "选择日期"}<Text>选择日期 ▾</Text></View>
    </Picker>}
    <View className="menu-detail-actions">{[selectedDay * 2, selectedDay * 2 + 1].filter((i) => menu.meals[i]?.enabled).map((i) =>
      <Button key={i} className="menu-detail-button" ariaPressed={index === i} disabled={disabled} onClick={() => onChange(i)}>{i % 2 ? "晚餐" : "午餐"}</Button>)}</View>
  </>;
}

export default function WeekPage() {
  const [client] = useState(() => { try { return getKithInnClient(); } catch { return null; } });
  const [week, setWeek] = useState(() => { const value = client?.pendingWrite()?.weekStart ?? Taro.getCurrentInstance().router?.params.weekStart; return WeekStartSchema.safeParse(value).success ? value! : thisMonday(); });
  const [saved, setSaved] = useState<WeekPlan | null>(null), [draft, setDraft] = useState<MenuPreview | null>(null);
  const [loaded, setLoaded] = useState(false), [screen, setScreen] = useState<"home" | "edit" | "swap" | "pick" | "review" | "meal" | "settings">("home"), [rebuild, setRebuild] = useState(false);
  const [mealIndex, setMealIndex] = useState(0);
  const [homeMealIndex, setHomeMealIndex] = useState<number | null>(null);
  const editing = screen === "edit";
  function setEditing(value: boolean) { setScreen(value ? "edit" : "home"); }
  const [dishes, setDishes] = useState<Dish[]>([]), [settings, setSettings] = useState(false);
  const [mealsExpanded, setMealsExpanded] = useState(false), [structureExpanded, setStructureExpanded] = useState(true);
  const [structure, setStructure] = useState({ meat: 2, vegetable: 2, soup: 1 });
  const [meals, setMeals] = useState(() => selections(WeekStartSchema.safeParse(week).success ? week : thisMonday()));
  const [selected, setSelected] = useState<DishPosition | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [target, setTarget] = useState<{ meal: number; category: Category; index: number } | null>(null);
  const [candidate, setCandidate] = useState(""), [query, setQuery] = useState(""), [suggested, setSuggested] = useState<string[]>([]);
  const [soupSelection, setSoupSelection] = useState<{ meal: number; ids: string[] } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [pending, setPending] = useState(() => client?.pendingWrite() ?? null), [review, setReview] = useState<WeekPlan | null | undefined>();
  const [conflict, setConflict] = useState(false), [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now);
  const [copyMeal, setCopyMeal] = useState<number | null>(null), [copyText, setCopyText] = useState<string | null>(null);
  const [copyDraft, setCopyDraft] = useState<string | null>(null);
  const [copyExample, setCopyExample] = useState<string | null>(null), [exampleDraft, setExampleDraft] = useState<string | null>(null);
  const copyDraftDirty = (copyDraft !== null && copyDraft !== copyText) || (exampleDraft !== null && exampleDraft !== copyExample);
  const copyPayload = copyDraft ?? copyText;
  const examplePayload = exampleDraft ?? copyExample;
  const [sharing, setSharing] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [copiedPart, setCopiedPart] = useState<"description" | "example">("description");
  useEffect(() => {
    if (copyStatus !== "已复制") return;
    const timer = setTimeout(() => setCopyStatus(""), 2000);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  const blocked = !!pending && pending.state !== "rejected", disabled = busy || blocked;
  const dirty = !!draft && (rebuild || JSON.stringify({ structure: draft.structure, meals: draft.meals }) !== JSON.stringify(saved && { structure: saved.structure, meals: saved.meals }));
  const needsReview = !!pending && (pending.state === "review" || now - pending.createdAt >= 86400000);
  const cooling = now < retryAt;
  const menu = draft;
  const visibleCopyText = screen === "meal" && dirty && menu ? formatMealText(menu.meals[mealIndex]!) : copyPayload;
  const homePreviewIndex = homeMealIndex !== null && saved?.meals[homeMealIndex]?.enabled ? homeMealIndex : defaultMealIndex(saved);
  const homeMeal = saved?.meals[homePreviewIndex];
  const selectedMeal = selected && menu?.meals[selected.meal];
  const selectedDish = selected && selectedMeal?.enabled && !(selected.category === "soup" && selectedMeal.soupOmitted) ? selectedMeal?.[selected.category][selected.index] : null;
  const settingsDirty = settings && JSON.stringify({ structure, meals }) !== JSON.stringify({ structure: draft?.structure ?? { meat: 2, vegetable: 2, soup: 1 }, meals: draft?.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled })) ?? selections(week) });

  const arranging = loaded && !sharing && settings && (screen === "settings" || screen === "home" && !menu) && (!!menu || dishes.some((dish) => dish.active));
  const enabledMeals = meals.filter((meal) => meal.enabled);
  const mealSummary = enabledMeals.length === 14 ? "每天午餐、晚餐，共 14 餐" : enabledMeals.length === 0 ? "尚未选择餐次" : `已选 ${enabledMeals.filter((meal) => meal.mealType === "lunch").length} 顿午餐、${enabledMeals.filter((meal) => meal.mealType === "dinner").length} 顿晚餐，共 ${enabledMeals.length} 餐`;
  const title = sharing ? "复制菜单" : arranging ? "安排本周菜单" : ({ home: "本周菜单", edit: "调整菜单", swap: "替换菜品", pick: "手选替换菜", review: "确认菜单", meal: "调整某一餐", settings: "安排本周菜单" })[screen];
  const backLabel = editing ? "返回安排" : screen === "settings" || screen === "meal" ? "返回本周菜单" : "返回编辑";
  useEffect(() => {
    void Taro.setNavigationBarTitle({ title });
    void Taro.pageScrollTo({ scrollTop: 0, duration: 0 });
  }, [title]);
  useDidShow(() => setPending(client?.pendingWrite() ?? null));
  useEffect(() => {
    if (!blocked && !cooling) return;
    const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [blocked, cooling]);
  useEffect(() => {
    if (!dirty && !settingsDirty && !copyDraftDirty && !blocked) return;
    if (process.env.TARO_ENV === "weapp") {
      Taro.enableAlertBeforeUnload({ message: copyDraftDirty ? "文案修改还未复制，离开后不会保留" : "还有未保存的菜单，请先确认保存结果" });
      return () => Taro.disableAlertBeforeUnload();
    }
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, settingsDirty, copyDraftDirty, blocked]);
  async function run(action: () => Promise<void> | void) {
    if (!client || busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (value) {
      const issue = value instanceof Error ? value : new Error("操作未完成，请重试");
      setError(issue.message + (issue instanceof ClientError && issue.details?.shortages
        ? `：${issue.details.shortages.map((s) => `${labels[s.category]}需${s.required}道，现有${s.available}道`).join("；")}` : ""));
      if (issue instanceof ClientError) {
        if (issue.code === "VERSION_CONFLICT") setConflict(true);
        if (issue.retryAt) { setRetryAt(issue.retryAt); setNow(Date.now()); }
      }
    } finally { setPending(client.pendingWrite()); setBusy(false); }
  }
  function adopt(value: WeekPlan | null) {
    setCopyText(null); setCopyDraft(null); setCopyExample(null); setExampleDraft(null); setMealsExpanded(false); setStructureExpanded(true);
    setNotice(""); void Taro.pageScrollTo({ scrollTop: 0, duration: 0 });
    setSaved(value); setDraft(value); setRebuild(false); setEditing(false); setSettings(!value);
    setStructure(value?.structure ?? { meat: 2, vegetable: 2, soup: 1 });
    setMeals(value?.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled })) ?? selections(week));
    setSelected(value ? firstPosition(value) : null); setShowAll(value?.structure.meat === 0);
    setConflict(false); setReview(undefined); setTarget(null); setSoupSelection(null); setLoaded(true);
  }
  const copiedFrom = useRef(false);
  async function read() {
    const value = await client!.getWeek(week);
    const pool = await client!.getDishes();
    setDishes(pool); adopt(value);
    const source = Taro.getCurrentInstance().router?.params.copyFrom;
    if (!copiedFrom.current && !blocked && WeekStartSchema.safeParse(source).success && source !== week) {
      const original = await client!.getWeek(source!);
      if (!original) throw new Error("原菜单暂时无法读取，请重试。");
      const answer = await Taro.showModal({ title: "复制到所选周？", content: `${week} 起的一周。${value ? "目标周已有菜单，复制后会进入新草稿，确认保存才会替换目标周菜单。" : "复制后可继续调整，确认保存后生效。"}`, confirmText: "复制菜单", cancelText: "取消" });
      copiedFrom.current = true;
      if (!answer.confirm) { await Taro.reLaunch({ url: "/pages/history/index" }); return; }
      const next = { weekStart: week, structure: original.structure, meals: original.meals.map((meal) => ({ ...meal, date: addDays(meal.date, Math.round((Date.parse(week) - Date.parse(source!)) / 86400000)) })) };
      setDraft(next); setStructure(next.structure); setMeals(next.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled })));
      setSelected(firstPosition(next)); setShowAll(next.structure.meat === 0); setRebuild(true); setSettings(false); setEditing(true);
    } else if (value && Taro.getCurrentInstance().router?.params.view === "edit") beginEditing();
  }
  useEffect(() => { if (client?.restoreSession()) void run(read); }, [week, client]);
  async function discardCopyDraft() {
    return !copyDraftDirty || (await Taro.showModal({ title: "放弃文案修改？", content: "当前修改还没有复制，放弃后将恢复默认文案。", confirmText: "放弃修改", cancelText: "继续编辑" })).confirm;
  }
  async function discard() {
    if (!await discardCopyDraft()) return false;
    return !(dirty || settingsDirty) || (await Taro.showModal({ title: "放弃未保存菜单？", content: "当前调整还没有保存，离开后只保留上次成功保存的内容。", confirmText: "放弃修改", cancelText: "继续编辑" })).confirm;
  }
  async function move(date: string) {
    if (disabled || !await discard()) return;
    setLoaded(false); setDraft(null); setSaved(null); setSelected(null); setHomeMealIndex(null); setNotice(""); setWeek(date);
  }
  async function generate() {
    if (!StructureSchema.safeParse(structure).success) throw new Error("每类请填0～10，总数需为1～20道");
    if (draft && !(await Taro.showModal({ title: "重新安排整周？", content: "这会覆盖整周的换菜和去汤调整。取消或生成失败会保留原菜单；生成后仍需保存。", confirmText: "确认重排" })).confirm) return;
    const result = await client!.generateWeek(week, { structure, meals });
    setSelected(firstPosition(result)); setShowAll(result.structure.meat === 0);
    setDraft(result); void Taro.pageScrollTo({ scrollTop: 0, duration: 0 }); setRebuild(true); setEditing(true); setSettings(false); setTarget(null); setSoupSelection(null); setNotice("");
  }
  function acceptWrite(result: WriteResult) {
    if (result.kind !== "week") throw new Error("请回到菜品池核对上次写入");
    if (result.week.weekStart !== week) { setWeek(result.week.weekStart); setLoaded(false); return; }
    adopt(result.week);
    if (screen === "meal") { setCopyText(formatMealText(result.week.meals[mealIndex]!)); setCopyExample(formatMealExample(result.week.meals[mealIndex]!)); }
    setScreen(screen === "meal" ? "meal" : result.week.confirmedAt ? "home" : "edit");
    if (screen !== "meal" && result.week.confirmedAt) void Taro.showToast({ title: "菜单已保存", icon: "none", duration: 1800 });
    else setNotice(screen === "meal" ? "本餐调整已保存" : "菜单已保存，可继续调整或确认");
  }
  async function save(confirm: boolean) {
    if (!draft || !confirm && !dirty) return;
    setNotice("");
    // Single-meal writes are assembled from the saved snapshot; only this meal's soup can change.
    const input = screen === "meal" && saved ? { ...saved, meals: saved.meals.map((meal, i) => i === mealIndex
      ? { ...meal, soupOmitted: draft.meals[i]!.soupOmitted, soup: draft.meals[i]!.soup } : meal) } : draft;
    acceptWrite(await client!.saveWeek(week, toWeekWriteInput(input, saved?.version ?? 0, screen === "meal" ? false : rebuild, screen === "meal" ? false : confirm)));
  }
  async function previewCopy(mealIndex: number, discardDraft = false) {
    setCopyText(null); setCopyStatus("");
    if ((dirty || settingsDirty) && !discardDraft) return;
    try {
      const latest = await client!.getWeek(week);
      if (!latest) throw new Error("这一周尚未保存，请先保存菜单。");
      const text = formatMealText(latest.meals[mealIndex]!);
      adopt(latest);
      if (text === null) {
        const next = latest.meals.findIndex((meal) => meal.enabled);
        setCopyMeal(next < 0 ? null : next);
        setCopyStatus("这餐已改为不安排，请选择其他餐次后重新预览。");
        return;
      }
      setCopyText(text); setCopyExample(formatMealExample(latest.meals[mealIndex]!)); setMealIndex(mealIndex); setHomeMealIndex(mealIndex); setScreen("meal");
    } catch (value) {
      setCopyStatus("读取已保存菜单失败，请重试；未生成可复制文字。");
      throw value;
    }
  }
  async function openCopy(mealIndex = defaultMealIndex(menu)) {
    if (!await discardCopyDraft()) return;
    if (mealIndex < 0) mealIndex = menu?.meals.findIndex((meal) => meal.enabled) ?? -1;
    const changingMeal = sharing && screen === "meal" && dirty && mealIndex !== copyMeal;
    if (changingMeal && !await discard()) return;
    setSharing(true); setNotice(""); setSoupSelection(null);
    if (mealIndex < 0) { setCopyMeal(null); setCopyText(null); return; }
    setCopyMeal(mealIndex); setCopyText(null); setCopyDraft(null); setCopyExample(null); setExampleDraft(null); setCopyStatus("");
    try { await previewCopy(mealIndex, changingMeal); }
    catch (error) { if (changingMeal) setCopyMeal(copyMeal); throw error; }
  }
  async function copy(part: "description" | "example") {
    const payload = part === "description" ? copyPayload : examplePayload;
    if (!payload?.trim() || dirty || settingsDirty || blocked) return;
    setCopyStatus("");
    try {
      // Taro 4.2 H5 ignores execCommand's false result; the native Promise reports failures.
      if (process.env.TARO_ENV === "h5") await navigator.clipboard.writeText(payload);
      else await Taro.setClipboardData({ data: payload });
      if (part === "description") { setCopyText(payload); setCopyDraft(null); }
      else { setCopyExample(payload); setExampleDraft(null); }
      setCopiedPart(part);
      setCopyStatus("已复制");
      void Taro.showToast({ title: `已复制，粘贴到微信接龙的${part === "description" ? "说明" : "示例"}栏`, icon: "none", duration: 2400 });
    }
    catch { setCopyStatus("复制失败，文字已保留，请重试复制。"); }
  }
  function beginEditing() {
    setEditing(true); setNotice("");
  }
  async function edit() { setDishes(await client!.getDishes()); if (settings) setScreen("settings"); else beginEditing(); }
  async function openCandidates(mode: "swap" | "pick") {
    if (!menu || !selected || !selectedDish) return;
    const pool = await client!.getDishes(); setDishes(pool);
    const candidates = replacementCandidates(menu.meals[selected.meal]!, selected.category, selected.index, pool);
    const chosen = candidates.length ? randomReplaceDish(menu, selected.meal, selected.category, selected.index, pool).meals[selected.meal]![selected.category][selected.index]!.dishId : "";
    setTarget(selected); setCandidate(mode === "swap" ? chosen : ""); setSuggested([chosen, ...candidates.map((dish) => dish.id).filter((id) => id !== chosen)].slice(0, 4)); setQuery(""); setScreen(mode);
  }
  async function applyCandidate() {
    if (!menu || !target || !candidate) return;
    const pool = await client!.getDishes(); setDishes(pool);
    setDraft(replaceDish(menu, target.meal, target.category, target.index, candidate, pool));
    setSelected(target); setTarget(null); setScreen("edit");
  }
  function cancelSettings() {
    if (menu) { setStructure(menu.structure); setMeals(menu.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled }))); }
    setSettings(false); setScreen("edit");
  }
  function back() {
    if (editing) { openSettings(); return; }
    if (screen === "settings") {
      setSettings(settingsDirty); setScreen("home");
      return;
    }
    setTarget(null); setSoupSelection(null);
    setScreen("edit");
  }
  async function soup(mealIndex: number) {
    if (!draft || !await discardCopyDraft()) return;
    setNotice(""); setCopyStatus("");
    const pool = await client!.getDishes(); setDishes(pool);
    try { setDraft(setSoupOmitted(draft, mealIndex, !draft.meals[mealIndex]!.soupOmitted, pool)); setCopyDraft(null); setExampleDraft(null); }
    catch (value) {
      if (value instanceof WeekEditError && value.code === "SOUP_RESELECTION_REQUIRED") {
        setSoupSelection({ meal: mealIndex, ids: [] }); setNotice("原汤已有停用或改类，请选齐本餐汤后一起恢复。");
      } else throw value;
    }
  }
  function closeCopy() { setScreen("home"); setSharing(false); setCopyMeal(null); setCopyText(null); setCopyDraft(null); setCopyExample(null); setExampleDraft(null); setCopyStatus(""); setError(""); }
  function openSettings() {
    if (!menu) return;
    if (!settings) {
      setStructure(menu.structure);
      setMeals(menu.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled })));
    }
    setSettings(true); setMealsExpanded(false); setStructureExpanded(true); setScreen("settings");
  }
  const candidates = target && menu ? replacementCandidates(menu.meals[target.meal]!, target.category, target.index, dishes).filter((dish) => screen === "swap" ? suggested.includes(dish.id) : dish.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
  return <DishNameProvider><View className={`dish-app week-app flow-page screen-${screen} ${sharing ? "sharing" : ""}`}>
    {process.env.TARO_ENV === "h5" ? <View className="app-heading flow-heading">{!sharing && screen !== "home" && <Button className={editing ? "flow-back-label" : ""} ariaLabel={backLabel} disabled={disabled} onClick={back}><Image src={backIcon} className="flow-icon" />{editing && <Text>返回安排</Text>}</Button>}<Text>{title}</Text></View>
      : !sharing && screen !== "home" && <Button className="flow-return" disabled={disabled} onClick={back}>{backLabel}</Button>}
    <View className="dish-page"><ScrollView scrollY className="flow-scroll" key={`${sharing ? "copy" : screen}-${settings}`}>

      {!sharing && (screen === "home" || screen === "settings") && <View className="week-toolbar"><Button ariaLabel="上一周" disabled={disabled} onClick={() => void move(addDays(week, -7))}>‹</Button>
        <View className="week-range"><View className="week-range-line"><Text className="range-title">{weekRange({ weekStart: week, meals: selections(week) })}</Text>
          {screen === "home" && menu && <Text className="state-badge">{dirty || settingsDirty ? "未保存" : saved?.confirmedAt ? "已确认" : "已保存"}</Text>}</View></View>
        <Button ariaLabel="下一周" disabled={disabled} onClick={() => void move(addDays(week, 7))}>›</Button></View>}
      {error && <View className="alert" role="alert">{error}</View>}{notice && <View className="hint">{notice}</View>}
      {!client && <View className="alert">尚未配置街坊味服务，请联系维护者配置后再使用。</View>}
      {client && !client.restoreSession() && <View className="login-panel">{process.env.TARO_ENV === "h5" && <Text className="hint">请在微信小程序中登录，浏览器不能完成微信登录。</Text>}<Button className="primary" disabled={busy} onClick={() => void run(async () => { await client!.login(); if (!draft) await read(); else setDishes(await client!.getDishes()); })}>微信登录</Button></View>}
      {!loaded && client?.restoreSession() && <Button disabled={busy} onClick={() => void run(read)}>读取本周菜单</Button>}
      {blocked && pending?.kind !== "week" && <View className="recovery"><Text>菜品池有待核对的保存，请先返回处理。</Text><Button disabled={busy} onClick={() => void Taro.reLaunch({ url: "/pages/dishes/index" })}>返回核对菜品保存</Button></View>}
      {(blocked && pending?.kind === "week" || conflict) && <View className="recovery"><Text>{conflict ? "另一处已保存新版本，当前草稿仍保留。请读取并核对，不能直接覆盖。" : "上次保存结果未确认，草稿仍保留。请先重试同一请求。"}</Text>
        {blocked && !needsReview && <Button disabled={busy || cooling} onClick={() => void run(async () => acceptWrite(await client!.retryPendingWrite()))}>{cooling ? "稍后重试" : "重试原保存请求"}</Button>}
        {(conflict || needsReview) && <Button disabled={busy || cooling} onClick={() => void run(async () => setReview(await client!.getWeek(week)))}>读取服务器菜单核对</Button>}
        {review !== undefined && <><Text>服务器：{review ? `版本${review.version}，${review.confirmedAt ? "已确认" : "未确认"}` : "尚未保存"}</Text>
          {review?.meals.map((meal, i) => <Text key={i}>{meal.date} {meal.mealType === "lunch" ? "午" : "晚"}：{[...meal.meat, ...meal.vegetable, ...(meal.soupOmitted ? [] : meal.soup)].map((d) => d.name).join("、") || "不安排"}</Text>)}
          <Button disabled={busy} onClick={() => void run(async () => {
            if (!(await Taro.showModal({ title: "载入核对后的服务器菜单？", content: "这会放弃当前未保存草稿，请确认已核对保存结果。" })).confirm) return;
            if (blocked) client!.discardPendingAfterReview(); adopt(review ?? null);
          })}>核对完成，载入服务器版本</Button></>}
      </View>}
      {sharing && <View className="copy-screen">
        {menu?.meals.some((meal) => meal.enabled) ? <View className="share-card"><View className="share-card-main">
          <MealPicker menu={menu} index={copyMeal ?? 0} disabled={busy || blocked || cooling} onChange={(index) => void run(() => openCopy(index))} />
          <View className="copy-panel">
            {(dirty || settingsDirty) && screen !== "meal" && !copyText ? <><Text className="muted">{settingsDirty ? "餐次或数量尚未重新生成，请返回周设置生成菜单，或明确放弃修改。" : "还有未保存修改，请先保存或明确放弃，再读取已保存菜单。"}</Text>
              {settingsDirty ? <Button className="secondary" disabled={busy || blocked} onClick={() => { closeCopy(); setScreen("settings"); setSettings(true); }}>返回周设置</Button>
                : <Button className="secondary" disabled={busy || blocked || cooling || conflict} onClick={() => void run(async () => { await save(false); await previewCopy(copyMeal!, true); })}>保存后预览</Button>}
              <Button className="text-button" disabled={busy || blocked || cooling || conflict} onClick={() => void run(async () => { if (await discard()) await previewCopy(copyMeal!, true); })}>放弃修改后预览</Button></>
              : !copyText && <Button className="secondary" disabled={busy || blocked || cooling} onClick={() => void run(() => previewCopy(copyMeal!))}>{busy ? "正在读取保存菜单" : "重新读取本餐文字"}</Button>}
            {(copyText || screen === "meal" && dirty) && <>
              <Text className="input-label">接龙说明（可修改）</Text>
              <View className="copy-preview">{process.env.TARO_ENV === "h5" ? <textarea className="copy-textarea" aria-label="接龙说明"
                rows={Math.max(7, (visibleCopyText ?? "").split("\n").length)} value={visibleCopyText ?? ""} disabled={disabled || dirty || settingsDirty || !!soupSelection}
                onInput={(event) => { setCopyDraft(event.currentTarget.value); setCopyStatus(""); }} />
                : <Textarea className="copy-textarea" ariaLabel="接龙说明" autoHeight maxlength={-1} value={visibleCopyText ?? ""}
                  disabled={disabled || dirty || settingsDirty || !!soupSelection} onInput={(event) => { setCopyDraft(event.detail.value); setCopyStatus(""); }} />}</View>
              <Text className="input-label">填写示例</Text>
              <View className="copy-example">
                {process.env.TARO_ENV === "h5" ? <input className="copy-example-input" aria-label="填写示例" value={examplePayload ?? ""}
                  disabled={disabled || dirty || settingsDirty || !!soupSelection} onInput={(event) => { setExampleDraft(event.currentTarget.value); setCopyStatus(""); }} />
                  : <Input className="copy-example-input" ariaLabel="填写示例" maxlength={-1} value={examplePayload ?? ""}
                    disabled={disabled || dirty || settingsDirty || !!soupSelection} onInput={(event) => { setExampleDraft(event.detail.value); setCopyStatus(""); }} />}
                <Button ariaLabel="复制示例" disabled={disabled || dirty || settingsDirty || !!soupSelection || !examplePayload?.trim()} onClick={() => void run(() => copy("example"))}>
                  <View role="status">{copyStatus === "已复制" && copiedPart === "example" ? "✓ 已复制" : "复制示例"}</View>
                </Button>
              </View>
            </>}
          </View>
        </View></View>
          : <View className="hint">本周没有已安排的餐次，请返回周菜单调整。</View>}
        {menu && screen === "meal" && (copyText || dirty) && <View className="meal-adjustment">
          {menu.structure.soup > 0 ? <View className="setting-row"><Text>本餐做汤</Text>{process.env.TARO_ENV === "h5" ? <input className="meal-soup-switch" type="checkbox" aria-label="本餐做汤" checked={!menu.meals[mealIndex]!.soupOmitted} disabled={disabled || cooling || !!soupSelection} onChange={() => void run(() => soup(mealIndex))} /> : <Switch ariaLabel="本餐做汤" checked={!menu.meals[mealIndex]!.soupOmitted} disabled={disabled || cooling || !!soupSelection} onChange={() => void run(() => soup(mealIndex))} />}</View> : <Text className="muted">本餐未安排汤</Text>}
          {dirty && <Button className="secondary" disabled={disabled || cooling || conflict || !!soupSelection} onClick={() => void run(() => save(false))}>保存本餐调整</Button>}
        </View>}
        {copyText && <Button className="primary" ariaLabel="复制接龙说明" disabled={busy || blocked || dirty || settingsDirty || !!soupSelection || !copyPayload?.trim()} onClick={() => void run(() => copy("description"))}><View role="status">{copyStatus === "已复制" && copiedPart === "description" ? "✓ 已复制" : "复制接龙说明"}</View></Button>}
        {copyStatus && copyStatus !== "已复制" && <View className="muted" role="status">{copyStatus}</View>}
        <Button className="secondary" ariaLabel="关闭菜单文字" disabled={busy} onClick={() => void run(async () => {
          if (screen === "meal" && dirty && !blocked) { if (!await discard()) return; adopt(saved); }
          else if (!await discardCopyDraft()) return;
          closeCopy();
        })}>返回周菜单</Button>
      </View>}
      {loaded && !sharing && <>
        {!menu && !dishes.some((dish) => dish.active) && <View className="first-preparation"><Text className="detail-kicker">首次准备 · 1 / 2</Text><Text className="detail-title">先把拿手菜放进来</Text><Text className="muted">建立自己的菜品池，再选择本周餐次和荤素汤搭配。</Text><Button className="primary" disabled={disabled} onClick={() => void Taro.reLaunch({ url: "/pages/dishes/index" })}>建立我的菜品池</Button></View>}
        {arranging && <View className="week-settings compact-settings">
          <View className="settings-section"><View className="settings-summary"><View><Text className="settings-label">安排餐次</Text><Text className="settings-value">{mealSummary}</Text></View><Button className="text-button" ariaLabel="修改安排餐次" ariaExpanded={mealsExpanded} disabled={disabled} onClick={() => setMealsExpanded(!mealsExpanded)}>{mealsExpanded ? "收起" : "修改"}</Button></View>
          {mealsExpanded && <View className="settings-details">{dayNames.map((day, i) => <View key={day} className="setting-row"><Text>{day} · {meals[i * 2]?.date.slice(5)}</Text>
            {[0, 1].map((offset) => <View key={offset}><Text>{offset ? "晚餐" : "午餐"}</Text><Switch ariaLabel={`${day}${offset ? "晚餐" : "午餐"}`} color="#1e5d45" checked={meals[i * 2 + offset]!.enabled} disabled={disabled}
              onChange={(event) => setMeals(meals.map((meal, index) => index === i * 2 + offset ? { ...meal, enabled: event.detail.value } : meal))} /></View>)}</View>)}</View>}
          </View>
          <View className="settings-section"><View className="settings-summary"><View><Text className="settings-label">每餐搭配</Text><Text className="settings-value">{structure.meat} 荤 · {structure.vegetable} 素 · {structure.soup} 汤</Text></View><Button className="text-button" ariaLabel="修改每餐搭配" ariaExpanded={structureExpanded} disabled={disabled} onClick={() => setStructureExpanded(!structureExpanded)}>{structureExpanded ? "收起" : "修改"}</Button></View>
          {structureExpanded && <View className="structure-fields">{categories.map((category) => <View key={category}><Text className="input-label">{labels[category]}菜数量</Text><Input className="dish-input" type="number" ariaLabel={`${labels[category]}菜数量`} value={String(structure[category])} disabled={disabled}
            onInput={(event) => setStructure({ ...structure, [category]: Number(event.detail.value) })} /></View>)}</View>
          }</View>
          {menu && settingsDirty && <Button className="text-button" disabled={disabled} onClick={cancelSettings}>取消修改，继续调整</Button>}
        </View>}
        {menu && screen === "home" && <View className="schedule-home">
          {saved && homeMeal?.enabled ? <View className="home-meal-card">
            <MealPicker menu={saved} index={homePreviewIndex} disabled={disabled} onChange={setHomeMealIndex} compactDates />
            {(dirty || settingsDirty) && <Text className="home-preview-state">已保存的菜单</Text>}
            <View className="home-meal-dishes">{categories.map((category) => category === "soup" && (homeMeal.soupOmitted || !homeMeal.soup.length)
              ? <View className="home-meal-row" key={category}><Text className="home-meal-category">汤</Text><Text className="home-meal-empty">本餐不做汤</Text></View>
              : homeMeal[category].length > 0 && <View className="home-meal-row" key={category}><Text className="home-meal-category">{labels[category]}</Text><DishName name={homeMeal[category].map((dish) => dish.name).join("、")} /></View>)}</View>
            <Button className="primary" disabled={disabled || cooling} onClick={() => void run(() => openCopy(homePreviewIndex))}>复制{homeMeal.mealType === "lunch" ? "午餐" : "晚餐"}菜单</Button>
          </View> : <View className="muted">{saved ? "本周没有已安排的餐次" : "菜单尚未保存"}</View>}
          <Button className={saved ? "secondary" : "primary"} disabled={disabled} onClick={() => void run(edit)}>{dirty || settingsDirty ? "继续调整菜单" : "查看并调整这一周"}</Button>
          {dirty && <Button className="secondary" disabled={disabled} onClick={() => void run(async () => { if (await discard()) adopt(saved); })}>放弃本次调整</Button>}
        </View>}
        {menu && screen === "review" && <View className="review-screen"><View className="review-hero"><Text>{weekRange(menu)}</Text><Text>确认后保存本周菜单</Text></View><WeekBoard menu={menu} readonly /></View>}
        {menu && editing && <><WeekBoard menu={menu} selected={selected} showAll={showAll} disabled={disabled} onSelect={(position) => { setSelected(position); setTarget(null); setSoupSelection(null); }} onFilter={setShowAll} />
          {selected && selectedMeal && <View className="selected-dish meal-block"><View className="selected-target"><View><Text className="selection-label">{dayNames[Math.floor(selected.meal / 2)]}{selected.meal % 2 ? "晚饭" : "午饭"}{selectedDish ? ` · ${selected.category === "soup" ? "汤" : `${labels[selected.category]}菜`}` : ""}</Text><DishName className="selected-name" interactive={Boolean(selectedDish)} name={selectedDish?.name ?? (selectedMeal.enabled ? "本餐不做汤" : "本餐不安排")} /></View>
            {selectedDish && <View className="replacement-actions"><Button disabled={disabled} onClick={() => void run(() => openCandidates("swap"))}>换一道</Button>
              <Button disabled={disabled} onClick={() => void run(() => openCandidates("pick"))}>自己选</Button></View>}</View>
          </View>}
        </>}
        {target && menu && (screen === "swap" || screen === "pick") && <View className="swap-screen">
          {screen === "swap" && <><View className="swap-heading"><Text className="selection-label">只换这一道</Text><DishName className="swap-name" name={menu.meals[target.meal]![target.category][target.index]!.name} /></View>
            <View className="locked-week"><Image src={greenCheckIcon} className="flow-icon" /><Text>其他 {menu.meals.reduce((count, meal) => count + meal.meat.length + meal.vegetable.length + (meal.soupOmitted ? 0 : meal.soup.length), 0) - 1} 道菜保持不变</Text></View></>}
          {screen === "pick" && <View className="picking-banner"><Image src={mixerIcon} className="flow-icon" /><Text>手选一道{target.category === "soup" ? "汤" : `${labels[target.category]}菜`}</Text></View>}
          {screen === "pick" && <View className="candidate-search"><Image src={searchIcon} className="flow-icon" /><Input ariaLabel="搜索候选菜名" placeholder="搜索菜名" value={query} disabled={disabled} onInput={(event) => setQuery(event.detail.value)} /></View>}
          <View className={screen === "pick" ? "candidate-pick-list" : "candidate-list"}>{candidates.map((dish) => <View className="dish-choice-row" key={dish.id}><Button ariaLabel={dish.name} className={candidate === dish.id ? "selected" : ""} ariaPressed={candidate === dish.id} disabled={disabled} onClick={() => setCandidate(dish.id)}>
            {screen === "pick" ? <><View className={`kind-dot ${dish.category}`} /><View><DishName className="pick-name" name={dish.name} interactive={false} /><Text className="pick-kind">{dish.category === "soup" ? "汤羹" : `${labels[dish.category]}菜`}</Text></View><Image src={nextIcon} className="flow-icon" /></>
              : <><View className="candidate-radio">{candidate === dish.id && <Image src={checkIcon} className="flow-icon" />}</View><DishName name={dish.name} interactive={false} /></>}
          </Button><DishName name={dish.name} icon /></View>)}</View>
          {!candidates.length && <Text className="muted">{query ? "没有匹配的菜名" : "没有其他同类可用菜，请先补充菜品池。"}</Text>}
          {screen === "swap" && <Button className="browse-library" disabled={disabled} onClick={() => { setScreen("pick"); setQuery(""); }}><Image src={archiveIcon} className="flow-icon" /><Text>在菜品池里自己选</Text><Image src={nextIcon} className="flow-icon" /></Button>}
        </View>}

      </>}
        {soupSelection && menu && <View className="candidate-sheet"><View className="sheet-head"><Text>重新选齐 {menu.structure.soup} 道汤</Text><Button disabled={disabled} onClick={() => { setSoupSelection(null); setNotice(""); }}>取消</Button></View><View className="candidate-list">
          {dishes.filter((dish) => dish.active && dish.category === "soup" && ![...menu.meals[soupSelection.meal]!.meat, ...menu.meals[soupSelection.meal]!.vegetable].some((item) => item.dishId === dish.id)).map((dish) => <View className="dish-choice-row" key={dish.id}><Button className="soup-choice" disabled={disabled} onClick={() => setSoupSelection({ ...soupSelection, ids: soupSelection.ids.includes(dish.id) ? soupSelection.ids.filter((id) => id !== dish.id) : [...soupSelection.ids, dish.id] })}><Text>{soupSelection.ids.includes(dish.id) ? "✓" : ""}</Text><DishName name={dish.name} interactive={false} /></Button><DishName name={dish.name} icon /></View>)}
          <Button className="primary" disabled={disabled || soupSelection.ids.length !== menu.structure.soup} onClick={() => void run(async () => { const pool = await client!.getDishes(); setDishes(pool); setDraft(restoreSoup(menu, soupSelection.meal, soupSelection.ids, pool)); setCopyDraft(null); setExampleDraft(null); setSoupSelection(null); setNotice(""); })}>选齐并恢复汤</Button></View></View>}
    </ScrollView>
      {arranging && <View className="flow-dock"><Button className="primary" disabled={disabled || cooling || !enabledMeals.length} onClick={() => menu && !settingsDirty ? cancelSettings() : void run(generate)}>{menu ? settingsDirty ? "重新生成菜单" : "继续调整菜单" : "生成本周菜单"}</Button></View>}
      {!sharing && menu && screen !== "home" && screen !== "settings" && <View className="flow-dock">
        {editing && <Button className="primary" disabled={disabled || cooling || conflict || settings} onClick={() => setScreen("review")}>确认菜单</Button>}
        {screen === "review" && <Button className="primary green" disabled={disabled || cooling || conflict} onClick={() => void run(() => save(true))}>保存本周菜单<Image src={checkIcon} className="flow-icon" /></Button>}
        {(screen === "swap" || screen === "pick") && <Button className="primary" disabled={disabled || !candidate || !candidates.some((dish) => dish.id === candidate)} onClick={() => void run(applyCandidate)}>保存这次替换<Image src={checkIcon} className="flow-icon" /></Button>}
      </View>}
    </View>
    <MainNav active="week" disabled={!client || busy || blocked} onNavigate={(page) => void run(async () => { if (await discard()) await Taro.reLaunch({ url: `/pages/${page}/index` }); })} />
  </View></DishNameProvider>;
}
