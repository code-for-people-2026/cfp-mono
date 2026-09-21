import mixerIcon from "../../assets/mixer.svg";
import searchIcon from "../../assets/search.svg";
import greenCheckIcon from "../../assets/check-green.svg";
import checkIcon from "../../assets/check.svg";
import backIcon from "../../assets/back.svg";
import nextIcon from "../../assets/next.svg";
import archiveIcon from "../../assets/archive.svg";
import { useEffect, useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { Image, Input, Picker, Switch, ScrollView, Text, View } from "@tarojs/components";
import { CategorySchema, StructureSchema, WeekStartSchema, type Category, type Dish, type GenerateInput, type MenuPreview, type WeekPlan } from "@cfp/kith-inn-contracts";
import { ClientError, getKithInnClient, type WriteResult } from "../../lib/api";
import { WeekEditError, randomReplaceDish, replacementCandidates, replaceDish, restoreSoup, setSoupOmitted, toWeekWriteInput } from "../../lib/week-editor";
import { Button } from "../../lib/button";
import { labels } from "../../lib/classify";
import { formatMealText } from "../../lib/menu-text";
import { MainNav } from "../../lib/main-nav";
import { weekRange, WeekBoard, firstPosition, type DishPosition } from "../../lib/week-board";
import logo from "../../assets/kith-inn-logo.png";

const categories = CategorySchema.options;
const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
function addDays(date: string, count: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10); }
function thisMonday() {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
}
function selections(date: string): GenerateInput["meals"] {
  return Array.from({ length: 14 }, (_, i) => ({ date: addDays(date, Math.floor(i / 2)), mealType: i % 2 ? "dinner" : "lunch", enabled: true }));
}

export default function WeekPage() {
  const [client] = useState(() => { try { return getKithInnClient(); } catch { return null; } });
  const [week, setWeek] = useState(() => { const value = client?.pendingWrite()?.weekStart ?? Taro.getCurrentInstance().router?.params.weekStart; return WeekStartSchema.safeParse(value).success ? value! : thisMonday(); });
  const [saved, setSaved] = useState<WeekPlan | null>(null), [draft, setDraft] = useState<MenuPreview | null>(null);
  const [loaded, setLoaded] = useState(false), [screen, setScreen] = useState<"home" | "edit" | "swap" | "pick" | "review">("home"), [rebuild, setRebuild] = useState(false);
  const editing = screen === "edit";
  function setEditing(value: boolean) { setScreen(value ? "edit" : "home"); }
  const [dishes, setDishes] = useState<Dish[]>([]), [settings, setSettings] = useState(false);
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
  const [sharing, setSharing] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const blocked = !!pending && pending.state !== "rejected", disabled = busy || blocked || sharing;
  const dirty = !!draft && (rebuild || JSON.stringify({ structure: draft.structure, meals: draft.meals }) !== JSON.stringify(saved && { structure: saved.structure, meals: saved.meals }));
  const needsReview = !!pending && (pending.state === "review" || now - pending.createdAt >= 86400000);
  const cooling = now < retryAt;
  const menu = draft;
  const selectedMeal = selected && menu?.meals[selected.meal];
  const selectedDish = selected && selectedMeal?.enabled && !(selected.category === "soup" && selectedMeal.soupOmitted) ? selectedMeal?.[selected.category][selected.index] : null;
  const settingsDirty = settings && JSON.stringify({ structure, meals }) !== JSON.stringify({ structure: draft?.structure ?? { meat: 2, vegetable: 2, soup: 1 }, meals: draft?.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled })) ?? selections(week) });

  const title = sharing ? "复制菜单" : ({ home: "本周菜单", edit: "修改菜单", swap: "替换菜品", pick: "手选替换菜", review: "确认菜单" })[screen];
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
    if (!dirty && !settingsDirty && !blocked) return;
    if (process.env.TARO_ENV === "weapp") {
      Taro.enableAlertBeforeUnload({ message: "还有未保存的菜单，请先确认保存结果" });
      return () => Taro.disableAlertBeforeUnload();
    }
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, settingsDirty, blocked]);
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
    setNotice(""); void Taro.pageScrollTo({ scrollTop: 0, duration: 0 });
    setSaved(value); setDraft(value); setRebuild(false); setEditing(false); setSettings(!value);
    setStructure(value?.structure ?? { meat: 2, vegetable: 2, soup: 1 });
    setMeals(value?.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled })) ?? selections(week));
    setSelected(value ? firstPosition(value) : null); setShowAll(value?.structure.meat === 0);
    setConflict(false); setReview(undefined); setTarget(null); setSoupSelection(null); setLoaded(true);
  }
  async function read() {
    const value = await client!.getWeek(week);
    const pool = await client!.getDishes();
    setDishes(pool); adopt(value);
    if (value && Taro.getCurrentInstance().router?.params.view === "edit") beginEditing();
  }
  useEffect(() => { if (client?.restoreSession()) void run(read); }, [week, client]);
  async function discard() {
    return !(dirty || settingsDirty) || (await Taro.showModal({ title: "放弃未保存菜单？", content: "当前调整还没有保存，离开后只保留上次成功保存的内容。", confirmText: "放弃修改", cancelText: "继续编辑" })).confirm;
  }
  async function move(date: string) {
    if (disabled || !await discard()) return;
    setLoaded(false); setDraft(null); setSaved(null); setSelected(null); setNotice(""); setWeek(date);
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
    adopt(result.week); setScreen(result.week.confirmedAt ? "home" : "edit"); setNotice(result.week.confirmedAt ? "周菜单已保存并确认" : "菜单已保存，可继续调整或确认");
  }
  async function save(confirm: boolean) {
    if (!draft) return;
    acceptWrite(await client!.saveWeek(week, toWeekWriteInput(draft, saved?.version ?? 0, rebuild, confirm)));
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
      setCopyText(text);
    } catch (value) {
      setCopyStatus("读取已保存菜单失败，请重试；未生成可复制文字。");
      throw value;
    }
  }
  async function openCopy(mealIndex = menu?.meals.findIndex((meal) => meal.enabled) ?? -1) {
    setSharing(true); setNotice("");
    if (mealIndex < 0) { setCopyMeal(null); setCopyText(null); return; }
    setCopyMeal(mealIndex); setCopyText(null); setCopyStatus("");
    await previewCopy(mealIndex);
  }
  async function copy() {
    if (copyText === null) return;
    setCopyStatus("");
    try {
      // Taro 4.2 H5 ignores execCommand's false result; the native Promise reports failures.
      if (process.env.TARO_ENV === "h5") await navigator.clipboard.writeText(copyText);
      else await Taro.setClipboardData({ data: copyText });
      setCopyStatus("已复制，请到微信粘贴发送");
    }
    catch { setCopyStatus("复制失败，文字已保留，请重试复制。"); }
  }
  function beginEditing() {
    setEditing(true); setNotice("");
  }
  async function edit() { setDishes(await client!.getDishes()); if (settings) setScreen("home"); else beginEditing(); }
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
  function back() {
    setTarget(null); setSoupSelection(null);
    setScreen(screen === "edit" ? "home" : "edit");
  }
  async function soup(mealIndex: number) {
    if (!draft) return;
    const pool = await client!.getDishes(); setDishes(pool);
    try { setDraft(setSoupOmitted(draft, mealIndex, !draft.meals[mealIndex]!.soupOmitted, pool)); }
    catch (value) {
      if (value instanceof WeekEditError && value.code === "SOUP_RESELECTION_REQUIRED") {
        setSoupSelection({ meal: mealIndex, ids: [] }); setNotice("原汤已有停用或改类，请选齐本餐汤后一起恢复。");
      } else throw value;
    }
  }
  function closeCopy() { setScreen("home"); setSharing(false); setCopyMeal(null); setCopyText(null); setCopyStatus(""); setError(""); }
  const copyDays = dayNames.map((day, i) => ({ label: `${day} · ${addDays(week, i)}`, index: i }))
    .filter(({ index }) => menu?.meals.slice(index * 2, index * 2 + 2).some((meal) => meal.enabled));
  const selectedDay = Math.floor((copyMeal ?? 0) / 2);
  function chooseDay(day: number) { const index = day * 2; void run(() => openCopy(menu!.meals[index]!.enabled ? index : index + 1)); }
  const candidates = target && menu ? replacementCandidates(menu.meals[target.meal]!, target.category, target.index, dishes).filter((dish) => screen === "swap" ? suggested.includes(dish.id) : dish.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
  return <View className={`dish-app week-app flow-page screen-${screen} ${sharing ? "sharing" : ""}`}>
    {process.env.TARO_ENV === "h5" ? <View className="app-heading flow-heading">{!sharing && screen !== "home" && <Button ariaLabel={screen === "edit" ? "返回本周菜单" : "返回编辑"} disabled={disabled} onClick={back}><Image src={backIcon} className="flow-icon" /></Button>}<Text>{title}</Text></View>
      : !sharing && screen !== "home" && <Button className="flow-return" disabled={disabled} onClick={back}>{screen === "edit" ? "返回本周菜单" : "返回编辑"}</Button>}
    <View className="dish-page"><ScrollView scrollY className="flow-scroll" key={`${sharing ? "copy" : screen}-${settings}`}>

      {!sharing && screen === "home" && <View className="week-toolbar"><Button ariaLabel="上一周" disabled={disabled} onClick={() => void move(addDays(week, -7))}>‹</Button>
        <View className="week-range"><Text className="range-title">{week}—{WeekStartSchema.safeParse(week).success ? addDays(week, 6).slice(5) : "日期无效"}</Text></View>
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
        <View className="detail-head"><View><Text className="detail-kicker">确认与分享</Text><Text className="detail-title">复制一餐菜单</Text></View><Text className="detail-meta">本周已安排</Text></View>
        <View className="menu-rule"><Text className="rule-title">选一餐，核对后复制到微信</Text>复制已保存的菜单文字，请到微信粘贴发送。</View>
        {copyDays.length ? <View className="share-card"><View className="share-card-main">
          <View className="share-card-brand"><Image src={logo} className="mini-logo" mode="aspectFill" />街坊味 · 桃子的家常饭</View>
          {process.env.TARO_ENV === "h5" ? <select className="copy-date" aria-label="选择日期" value={selectedDay} disabled={busy || blocked || cooling} onChange={(event) => chooseDay(Number(event.target.value))}>
            {copyDays.map((day) => <option key={day.index} value={day.index}>{day.label}</option>)}
          </select> : <Picker mode="selector" range={copyDays.map((day) => day.label)} value={Math.max(0, copyDays.findIndex((day) => day.index === selectedDay))} disabled={busy || blocked || cooling}
            onChange={(event) => chooseDay(copyDays[Number(event.detail.value)]!.index)}>
            <View className="copy-date">{copyDays.find((day) => day.index === selectedDay)?.label ?? "选择日期"}<Text>选择日期 ▾</Text></View>
          </Picker>}
          <View className="menu-detail-actions">{[selectedDay * 2, selectedDay * 2 + 1].filter((index) => menu?.meals[index]?.enabled).map((index) =>
            <Button key={index} className="menu-detail-button" ariaExpanded={copyMeal === index} disabled={busy || blocked || cooling} onClick={() => void run(() => openCopy(index))}>{index % 2 ? "晚餐" : "午餐"}</Button>)}</View>
          <View className="copy-panel">
            {(dirty || settingsDirty) && !copyText ? <><Text className="muted">{settingsDirty ? "餐次或数量尚未重新生成，请返回周设置生成菜单，或明确放弃修改。" : "还有未保存修改，请先保存或明确放弃，再读取已保存菜单。"}</Text>
              {settingsDirty ? <Button className="secondary" disabled={busy || blocked} onClick={() => { closeCopy(); setEditing(false); setSettings(true); }}>返回周设置</Button>
                : <Button className="secondary" disabled={busy || blocked || cooling || conflict} onClick={() => void run(async () => { await save(false); await previewCopy(copyMeal!, true); })}>保存后预览</Button>}
              <Button className="text-button" disabled={busy || blocked || cooling || conflict} onClick={() => void run(async () => { if (await discard()) await previewCopy(copyMeal!, true); })}>放弃修改后预览</Button></>
              : !copyText && <Button className="secondary" disabled={busy || blocked || cooling} onClick={() => void run(() => previewCopy(copyMeal!))}>{busy ? "正在读取保存菜单" : "重新读取本餐文字"}</Button>}
            {copyText && <View className="copy-preview"><Text selectable>{copyText}</Text></View>}
          </View>
        </View><View className="share-card-foot"><Text>{copyText ? "已保存的一餐" : "保存后可复制"}</Text><Text>复制后仍可修改</Text></View></View>
          : <View className="hint">本周没有已安排的餐次，请返回周菜单调整。</View>}
        {copyText && <Button className="primary" disabled={busy || blocked} onClick={() => void run(copy)}>复制菜单文字</Button>}
        {copyStatus && <View className="muted" role="status">{copyStatus}</View>}
        <Button className="secondary" ariaLabel="关闭菜单文字" disabled={busy} onClick={closeCopy}>返回周菜单</Button>
        <Button className="text-button" disabled={busy || blocked} onClick={() => void run(async () => { closeCopy(); await edit(); })}>继续编辑</Button>
      </View>}
      {loaded && !sharing && <>
        {screen === "home" && <View className="plan-state"><Text>7 天 · {(menu?.meals ?? meals).filter((meal) => meal.enabled).length} 餐{menu ? ` · ${menu.meals.reduce((count, meal) => count + meal.meat.length + meal.vegetable.length + (meal.soupOmitted ? 0 : meal.soup.length), 0)} 道菜` : "待安排"}</Text><Text className="state-badge">{dirty || settingsDirty ? "未保存" : saved ? saved.confirmedAt ? "已确认" : "已保存" : "待生成"}</Text></View>}
        {!menu && !dishes.some((dish) => dish.active) && <View className="first-preparation"><Text className="detail-kicker">首次准备 · 1 / 2</Text><Text className="detail-title">先把拿手菜放进来</Text><Text className="muted">建立自己的菜品池，再选择本周餐次和荤素汤搭配。</Text><Button className="primary" disabled={disabled} onClick={() => void Taro.reLaunch({ url: "/pages/dishes/index" })}>建立我的菜品池</Button></View>}
        {settings && screen === "home" && (menu || dishes.some((dish) => dish.active)) && <View className="week-settings"><View className="detail-head"><View><Text className="detail-kicker">{menu ? "重新安排" : "准备排菜单 · 2 / 2"}</Text><Text className="detail-title">这周怎么安排</Text></View><Text className="detail-meta">{dishes.filter((dish) => dish.active).length} 道菜可用</Text></View><View className="menu-rule"><Text className="rule-title">本周统一荤素汤数量</Text>同一道菜近期尽量不重复 · 只用菜品池里的菜</View>
          <View className="structure-fields">{categories.map((category) => <View key={category}><Text className="input-label">{labels[category]}菜数量</Text><Input className="dish-input" type="number" ariaLabel={`${labels[category]}菜数量`} value={String(structure[category])} disabled={disabled}
            onInput={(event) => setStructure({ ...structure, [category]: Number(event.detail.value) })} /></View>)}</View>
          {dayNames.map((day, i) => <View key={day} className="setting-row"><Text>{day} · {meals[i * 2]?.date.slice(5)}</Text>
            {[0, 1].map((offset) => <View key={offset}><Text>{offset ? "晚餐" : "午餐"}</Text><Switch ariaLabel={`${day}${offset ? "晚餐" : "午餐"}`} checked={meals[i * 2 + offset]!.enabled} disabled={disabled}
              onChange={(event) => setMeals(meals.map((meal, index) => index === i * 2 + offset ? { ...meal, enabled: event.detail.value } : meal))} /></View>)}</View>)}
          <Button className="primary" disabled={disabled || cooling} onClick={() => void run(generate)}>{menu ? "按新设置重新生成" : "生成本周菜单"}</Button>
          {menu && <Button className="text-button" disabled={disabled} onClick={() => setSettings(false)}>取消设置，保留原菜单</Button>}
        </View>}
        {menu && screen === "home" && <View className="schedule-home">
          {!settings && <><View className="rule-card"><Text className="home-structure">每餐 {menu.structure.meat} 荤 {menu.structure.vegetable} 素 {menu.structure.soup} 汤</Text></View>
          <Button className="primary" disabled={disabled} onClick={() => void run(edit)}>{dirty ? "继续调整菜单" : "查看并调整这一周"}</Button>
          <Button className="secondary" disabled={disabled} onClick={() => { setStructure(menu.structure); setMeals(menu.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled }))); setSettings(true); }}>修改周设置</Button>
          <Button className="secondary" disabled={disabled || cooling || conflict} onClick={() => void run(() => save(false))}>保存调整</Button>
          {dirty && <Button className="secondary" disabled={disabled} onClick={() => void run(async () => { if (await discard()) adopt(saved); })}>放弃本次调整</Button>}</>}
          <Button className="secondary" disabled={disabled || cooling} onClick={() => void run(() => openCopy())}>去复制菜单</Button>
        </View>}
        {menu && screen === "review" && <View className="review-screen"><View className="review-hero"><Text>{weekRange(menu)}</Text><Text>确认后保存本周菜单</Text></View><WeekBoard menu={menu} readonly /></View>}
        {menu && editing && <><WeekBoard menu={menu} selected={selected} showAll={showAll} disabled={disabled} onSelect={(position) => { setSelected(position); setTarget(null); setSoupSelection(null); }} onFilter={setShowAll} />
          {selected && selectedMeal && <View className="selected-dish meal-block"><View className="selected-target"><View><Text className="selection-label">{dayNames[Math.floor(selected.meal / 2)]}{selected.meal % 2 ? "晚饭" : "午饭"}{selectedDish ? ` · ${selected.category === "soup" ? "汤" : `${labels[selected.category]}菜`}` : ""}</Text><Text className="selected-name">{selectedDish?.name ?? (selectedMeal.enabled ? "本餐已去汤" : "本餐不安排")}</Text></View>
            {selectedDish && <View className="replacement-actions"><Button disabled={disabled} onClick={() => void run(() => openCandidates("swap"))}>换一道</Button>
              <Button disabled={disabled} onClick={() => void run(() => openCandidates("pick"))}>自己选</Button></View>}</View>
            {selected.category === "soup" && selectedMeal.enabled && menu.structure.soup > 0 && <View className="soup-options"><Button className="secondary" disabled={disabled} onClick={() => void run(() => soup(selected.meal))}>{selectedMeal.soupOmitted ? "恢复本餐汤" : "去掉本餐汤"}</Button></View>}
          </View>}
        </>}
        {target && menu && (screen === "swap" || screen === "pick") && <View className="swap-screen">
          {screen === "swap" && <><View className="swap-heading"><Text className="selection-label">只换这一道</Text><Text className="swap-name">{menu.meals[target.meal]![target.category][target.index]!.name}</Text></View>
            <View className="locked-week"><Image src={greenCheckIcon} className="flow-icon" /><Text>其他 {menu.meals.reduce((count, meal) => count + meal.meat.length + meal.vegetable.length + (meal.soupOmitted ? 0 : meal.soup.length), 0) - 1} 道菜保持不变</Text></View></>}
          {screen === "pick" && <View className="picking-banner"><Image src={mixerIcon} className="flow-icon" /><Text>手选一道{target.category === "soup" ? "汤" : `${labels[target.category]}菜`}</Text></View>}
          {screen === "pick" && <View className="candidate-search"><Image src={searchIcon} className="flow-icon" /><Input ariaLabel="搜索候选菜名" placeholder="搜索菜名" value={query} disabled={disabled} onInput={(event) => setQuery(event.detail.value)} /></View>}
          <View className={screen === "pick" ? "candidate-pick-list" : "candidate-list"}>{candidates.map((dish) => <Button key={dish.id} ariaLabel={dish.name} className={candidate === dish.id ? "selected" : ""} ariaPressed={candidate === dish.id} disabled={disabled} onClick={() => setCandidate(dish.id)}>
            {screen === "pick" ? <><View className={`kind-dot ${dish.category}`} /><View><Text className="pick-name">{dish.name}</Text><Text className="pick-kind">{dish.category === "soup" ? "汤羹" : `${labels[dish.category]}菜`}</Text></View><Image src={nextIcon} className="flow-icon" /></>
              : <><View className="candidate-radio">{candidate === dish.id && <Image src={checkIcon} className="flow-icon" />}</View><Text>{dish.name}</Text></>}
          </Button>)}</View>
          {!candidates.length && <Text className="muted">{query ? "没有匹配的菜名" : "没有其他同类可用菜，请先补充菜品池。"}</Text>}
          {screen === "swap" && <Button className="browse-library" disabled={disabled} onClick={() => { setScreen("pick"); setQuery(""); }}><Image src={archiveIcon} className="flow-icon" /><Text>在菜品池里自己选</Text><Image src={nextIcon} className="flow-icon" /></Button>}
        </View>}
        {soupSelection && menu && <View className="candidate-sheet"><View className="sheet-head"><Text>重新选齐 {menu.structure.soup} 道汤</Text><Button onClick={() => setSoupSelection(null)}>取消</Button></View><View className="candidate-list">
          {dishes.filter((dish) => dish.active && dish.category === "soup" && ![...menu.meals[soupSelection.meal]!.meat, ...menu.meals[soupSelection.meal]!.vegetable].some((item) => item.dishId === dish.id)).map((dish) => <Button key={dish.id} disabled={disabled} onClick={() => setSoupSelection({ ...soupSelection, ids: soupSelection.ids.includes(dish.id) ? soupSelection.ids.filter((id) => id !== dish.id) : [...soupSelection.ids, dish.id] })}>{soupSelection.ids.includes(dish.id) ? "✓ " : ""}{dish.name}</Button>)}
          <Button className="primary" disabled={disabled || soupSelection.ids.length !== menu.structure.soup} onClick={() => void run(() => { setDraft(restoreSoup(menu, soupSelection.meal, soupSelection.ids, dishes)); setSoupSelection(null); })}>选齐并恢复汤</Button></View></View>}
      </>}
    </ScrollView>
      {!sharing && menu && screen !== "home" && <View className="flow-dock">
        {editing && <Button className="primary" disabled={disabled || cooling || conflict || settings} onClick={() => setScreen("review")}>确认 {menu.meals.filter((meal) => meal.enabled).length} 餐菜单<Image src={checkIcon} className="flow-icon" /></Button>}
        {screen === "review" && <Button className="primary green" disabled={disabled || cooling || conflict} onClick={() => void run(() => save(true))}>保存本周菜单<Image src={checkIcon} className="flow-icon" /></Button>}
        {(screen === "swap" || screen === "pick") && <Button className="primary" disabled={disabled || !candidate || !candidates.some((dish) => dish.id === candidate)} onClick={() => void run(applyCandidate)}>保存这次替换<Image src={checkIcon} className="flow-icon" /></Button>}
      </View>}
    </View>
    {!sharing && <MainNav active="week" disabled={!client || disabled} onNavigate={(page) => void run(async () => { if (await discard()) await Taro.reLaunch({ url: `/pages/${page}/index` }); })} />}
  </View>;
}
