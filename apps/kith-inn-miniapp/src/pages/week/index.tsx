import { useEffect, useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { Image, Input, Switch, Text, View } from "@tarojs/components";
import { CategorySchema, StructureSchema, WeekStartSchema, type Category, type Dish, type GenerateInput, type MenuPreview, type WeekPlan } from "@cfp/kith-inn-contracts";
import { ClientError, getKithInnClient, type WriteResult } from "../../lib/api";
import { WeekEditError, randomReplaceDish, replacementCandidates, replaceDish, restoreSoup, setSoupOmitted, toWeekWriteInput } from "../../lib/week-editor";
import { Button } from "../../lib/button";
import { labels } from "../../lib/classify";
import { formatMealText } from "../../lib/menu-text";
import refreshIcon from "../../assets/refresh-cw.svg";

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
function summary(meal: MenuPreview["meals"][number]) {
  if (!meal.enabled) return "不安排";
  const names = [...meal.meat, ...meal.vegetable, ...(meal.soupOmitted ? [] : meal.soup)].map((dish) => dish.name);
  return `${names.slice(0, 2).join("、")}等${names.length}道`;
}

export default function WeekPage() {
  const [client] = useState(() => { try { return getKithInnClient(); } catch { return null; } });
  const [week, setWeek] = useState(() => { const value = client?.pendingWrite()?.weekStart ?? Taro.getCurrentInstance().router?.params.weekStart; return WeekStartSchema.safeParse(value).success ? value! : thisMonday(); });
  const [saved, setSaved] = useState<WeekPlan | null>(null), [draft, setDraft] = useState<MenuPreview | null>(null);
  const [loaded, setLoaded] = useState(false), [editing, setEditing] = useState(false), [rebuild, setRebuild] = useState(false);
  const [dishes, setDishes] = useState<Dish[]>([]), [settings, setSettings] = useState(false);
  const [structure, setStructure] = useState({ meat: 2, vegetable: 2, soup: 1 });
  const [meals, setMeals] = useState(() => selections(WeekStartSchema.safeParse(week).success ? week : thisMonday()));
  const [expanded, setExpanded] = useState<number | null>(null);
  const [target, setTarget] = useState<{ meal: number; category: Category; index: number } | null>(null);
  const [soupSelection, setSoupSelection] = useState<{ meal: number; ids: string[] } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [pending, setPending] = useState(() => client?.pendingWrite() ?? null), [review, setReview] = useState<WeekPlan | null | undefined>();
  const [conflict, setConflict] = useState(false), [retryAt, setRetryAt] = useState(0), [now, setNow] = useState(Date.now);
  const [copyMeal, setCopyMeal] = useState<number | null>(null), [copyText, setCopyText] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const blocked = !!pending && pending.state !== "rejected", disabled = busy || blocked || copyMeal !== null;
  const dirty = !!draft && (rebuild || JSON.stringify({ structure: draft.structure, meals: draft.meals }) !== JSON.stringify(saved && { structure: saved.structure, meals: saved.meals }));
  const needsReview = !!pending && (pending.state === "review" || now - pending.createdAt >= 86400000);
  const cooling = now < retryAt;
  const menu = draft;

  useDidShow(() => setPending(client?.pendingWrite() ?? null));
  useEffect(() => {
    if (!blocked && !cooling) return;
    const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [blocked, cooling]);
  useEffect(() => {
    if (!dirty && !blocked) return;
    if (process.env.TARO_ENV === "weapp") {
      Taro.enableAlertBeforeUnload({ message: "还有未保存的菜单，请先确认保存结果" });
      return () => Taro.disableAlertBeforeUnload();
    }
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, blocked]);
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
    setSaved(value); setDraft(value); setRebuild(false); setEditing(false); setSettings(!value);
    setStructure(value?.structure ?? { meat: 2, vegetable: 2, soup: 1 });
    setMeals(value?.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled })) ?? selections(week));
    setConflict(false); setReview(undefined); setTarget(null); setSoupSelection(null); setLoaded(true);
  }
  async function read() {
    const value = await client!.getWeek(week);
    const pool = await client!.getDishes();
    setDishes(pool); adopt(value);
  }
  useEffect(() => { if (client?.restoreSession()) void run(read); }, [week, client]);
  async function discard() {
    return !dirty || (await Taro.showModal({ title: "放弃未保存菜单？", content: "当前调整还没有保存，离开后只保留上次成功保存的内容。", confirmText: "放弃修改", cancelText: "继续编辑" })).confirm;
  }
  async function move(date: string) {
    if (disabled || !await discard()) return;
    setLoaded(false); setDraft(null); setSaved(null); setExpanded(null); setNotice(""); setWeek(date);
  }
  async function generate() {
    if (!StructureSchema.safeParse(structure).success) throw new Error("每类请填0～10，总数需为1～20道");
    if (draft && !(await Taro.showModal({ title: "重新安排整周？", content: "这会覆盖整周的换菜和去汤调整。取消或生成失败会保留原菜单；生成后仍需保存。", confirmText: "确认重排" })).confirm) return;
    const result = await client!.generateWeek(week, { structure, meals });
    setDraft(result); setRebuild(true); setEditing(true); setSettings(false); setTarget(null); setSoupSelection(null); setNotice("");
  }
  function acceptWrite(result: WriteResult) {
    if (result.kind !== "week") throw new Error("请回到菜品池核对上次写入");
    if (result.week.weekStart !== week) { setWeek(result.week.weekStart); setLoaded(false); return; }
    adopt(result.week); setEditing(!result.week.confirmedAt); setNotice(result.week.confirmedAt ? "周菜单已保存并确认" : "菜单已保存，可继续调整或确认");
  }
  async function save(confirm: boolean) {
    if (!draft) return;
    acceptWrite(await client!.saveWeek(week, toWeekWriteInput(draft, saved?.version ?? 0, rebuild, confirm)));
  }
  async function previewCopy(mealIndex: number, discardDraft = false) {
    setCopyText(null); setCopyStatus("");
    if (dirty && !discardDraft) return;
    try {
      const latest = await client!.getWeek(week);
      if (!latest) throw new Error("这一周尚未保存，请先保存菜单。");
      const text = formatMealText(latest.meals[mealIndex]!);
      adopt(latest);
      if (text === null) { setCopyMeal(null); throw new Error("这餐已改为不安排，不能复制。已读取最新菜单。"); }
      setCopyText(text);
    } catch (value) {
      setCopyStatus("读取已保存菜单失败，请重试；未生成可复制文字。");
      throw value;
    }
  }
  async function openCopy(mealIndex: number) {
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
  async function edit() {
    setDishes(await client!.getDishes()); setEditing(true);
    setNotice("如之前已发到微信，请自行通知邻居，旧消息不会自动更新。");
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
  return <View className="dish-app week-app">
    {process.env.TARO_ENV === "h5" && <View className="app-heading">本周菜单</View>}
    <View className="dish-page">
      <View className="week-toolbar"><Button ariaLabel="上一周" disabled={disabled} onClick={() => void move(addDays(week, -7))}>‹</Button>
        <View className="week-range"><Text className="range-title">{week}—{WeekStartSchema.safeParse(week).success ? addDays(week, 6).slice(5) : "日期无效"}</Text><Text>七天十四餐 · 点击某天展开</Text></View>
        <Button ariaLabel="下一周" disabled={disabled} onClick={() => void move(addDays(week, 7))}>›</Button></View>
      {error && <View className="alert" role="alert">{error}</View>}{notice && <View className="hint">{notice}</View>}
      {!client?.restoreSession() && <Button className="primary" disabled={busy} onClick={() => void run(async () => { await client!.login(); if (!draft) await read(); else setDishes(await client!.getDishes()); })}>微信登录</Button>}
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
      {loaded && <>
        <View className="plan-state"><Text>{dirty ? "未保存" : saved ? saved.confirmedAt ? "周菜单已确认" : "周菜单已保存" : "本周还没有菜单"}</Text><Text className="state-badge">{(menu?.meals ?? meals).filter((m) => m.enabled).length} 餐{menu ? "已安排" : "待安排"}</Text></View>
        {settings && <View className="week-settings"><View className="menu-rule"><Text className="rule-title">本周统一荤素汤数量</Text>同一道菜近期尽量不重复 · 只用菜品池里的菜</View>
          <View className="structure-fields">{categories.map((category) => <View key={category}><Text className="input-label">{labels[category]}菜数量</Text><Input className="dish-input" type="number" ariaLabel={`${labels[category]}菜数量`} value={String(structure[category])} disabled={disabled}
            onInput={(event) => setStructure({ ...structure, [category]: Number(event.detail.value) })} /></View>)}</View>
          {dayNames.map((day, i) => <View key={day} className="setting-row"><Text>{day} · {meals[i * 2]?.date.slice(5)}</Text>
            {[0, 1].map((offset) => <View key={offset}><Text>{offset ? "晚餐" : "午餐"}</Text><Switch ariaLabel={`${day}${offset ? "晚餐" : "午餐"}`} checked={meals[i * 2 + offset]!.enabled} disabled={disabled}
              onChange={(event) => setMeals(meals.map((meal, index) => index === i * 2 + offset ? { ...meal, enabled: event.detail.value } : meal))} /></View>)}</View>)}
          <Button className="primary" disabled={disabled || cooling} onClick={() => void run(generate)}>{menu ? "按新设置重新生成" : "生成本周菜单"}</Button>
          {menu && <Button className="text-button" disabled={disabled} onClick={() => setSettings(false)}>取消设置，保留原菜单</Button>}
        </View>}
        {menu && <View className="week-plans">{dayNames.map((day, dayIndex) => <View className={`day-plan ${expanded === dayIndex ? "open" : ""}`} key={day}>
          <Button className="day-toggle" disabled={busy || copyMeal !== null} ariaExpanded={expanded === dayIndex} onClick={() => setExpanded(expanded === dayIndex ? null : dayIndex)}>
            <View className="day-head"><Text>{day} · {menu.meals[dayIndex * 2]!.date.slice(5).replace("-", "月")}日</Text><Text>{expanded === dayIndex ? "收起" : "展开"}</Text></View>
            <View className="day-summary"><Text>午：{summary(menu.meals[dayIndex * 2]!)}</Text><Text>晚：{summary(menu.meals[dayIndex * 2 + 1]!)}</Text></View></Button>
          {expanded === dayIndex && <View className="day-detail">{[dayIndex * 2, dayIndex * 2 + 1].map((mealIndex) => {
            const meal = menu.meals[mealIndex]!;
            return <View className="meal-block" key={mealIndex}><View className="meal-title"><Text>{meal.mealType === "lunch" ? "午餐" : "晚餐"}</Text><Text>{meal.enabled ? `${menu.structure.meat}荤${menu.structure.vegetable}素${meal.soupOmitted ? 0 : menu.structure.soup}汤` : "不安排"}</Text></View>
              <View className="mini-dishes">{meal.enabled && categories.flatMap((category) => category === "soup" && meal.soupOmitted ? [] : meal[category].map((dish, index) => <View className="mini-dish" key={`${category}-${index}`}>
                <Button className="dish-choice" disabled={!editing || disabled} ariaLabel={`选择其他菜：${dish.name}`} onClick={() => void run(async () => { setDishes(await client!.getDishes()); setTarget({ meal: mealIndex, category, index }); })}>{dish.name}</Button><Text className={`mini-kind ${category}`}>{labels[category]}</Text>
                {editing && <Button className="rotate-dish" disabled={disabled} ariaLabel={`随机换菜：${dish.name}`} onClick={() => void run(async () => { const pool = await client!.getDishes(); setDishes(pool); setDraft(randomReplaceDish(menu, mealIndex, category, index, pool)); })}><Image src={refreshIcon} mode="scaleToFill" className="refresh-icon" /></Button>}
              </View>))}</View>
              {meal.enabled && <Button className="text-button" disabled={disabled || cooling || conflict || settings} onClick={() => void run(() => openCopy(mealIndex))}>预览本餐文字</Button>}
              {copyMeal === mealIndex && <View className="copy-panel">
                <View className="sheet-head"><Text>复制本餐菜单</Text><Button ariaLabel="关闭菜单文字" disabled={busy} onClick={() => { setCopyMeal(null); setCopyText(null); setCopyStatus(""); }}>×</Button></View>
                {dirty && !copyText ? <><Text className="muted">还有未保存修改，请先保存或明确放弃，再读取已保存菜单。</Text>
                  <Button className="secondary" disabled={busy || blocked || cooling || conflict} onClick={() => void run(async () => { await save(false); await previewCopy(mealIndex, true); })}>保存后预览</Button>
                  <Button className="text-button" disabled={busy || blocked || cooling || conflict} onClick={() => void run(async () => { if (await discard()) await previewCopy(mealIndex, true); })}>放弃修改后预览</Button></>
                  : !copyText && <Button className="secondary" disabled={busy || blocked || cooling} onClick={() => void run(() => previewCopy(mealIndex))}>{busy ? "正在读取保存菜单" : "重新读取本餐文字"}</Button>}
                {copyText && <><View className="copy-preview"><Text selectable>{copyText}</Text></View><Button className="secondary" disabled={busy || blocked} onClick={() => void run(copy)}>复制菜单文字</Button></>}
                {copyStatus && <View className="muted" role="status">{copyStatus}</View>}
                <Text className="evidence-note">之前发出的微信消息不会自动更新，请自行通知邻居。</Text>
              </View>}
              {editing && meal.enabled && menu.structure.soup > 0 && <Button className="text-button" disabled={disabled} onClick={() => void run(() => soup(mealIndex))}>{meal.soupOmitted ? "恢复本餐汤" : "去掉本餐汤"}</Button>}
            </View>;
          })}</View>}
        </View>)}</View>}
        {menu && copyMeal === null && <>{editing ? <><View className="plan-action"><Button className="primary" disabled={disabled || cooling || conflict} onClick={() => void run(() => save(true))}>确认周菜单</Button></View>
          <Button className="secondary" disabled={disabled || cooling || conflict} onClick={() => void run(() => save(false))}>保存调整</Button>
          <Button className="text-button" disabled={disabled} onClick={() => { setStructure(menu.structure); setMeals(menu.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled }))); setSettings(true); }}>修改周设置</Button>
          <Button className="text-button" disabled={disabled} onClick={() => void run(async () => { if (await discard()) adopt(saved); })}>取消编辑</Button>
        </> : <View className="plan-action"><Button className="primary" disabled={disabled} onClick={() => void run(edit)}>继续编辑</Button></View>}</>}
        {target && menu && <View className="candidate-sheet"><View className="sheet-head"><Text>选择替换菜品</Text><Button ariaLabel="关闭候选列表" onClick={() => setTarget(null)}>×</Button></View><View className="candidate-list">
          {replacementCandidates(menu.meals[target.meal]!, target.category, target.index, dishes).map((dish) => <Button key={dish.id} disabled={disabled} onClick={() => void run(() => { setDraft(replaceDish(menu, target.meal, target.category, target.index, dish.id, dishes)); setTarget(null); })}>{dish.name}</Button>)}
          {!replacementCandidates(menu.meals[target.meal]!, target.category, target.index, dishes).length && <Text className="muted">没有其他同类可用菜，请先补充菜品池。</Text>}</View></View>}
        {soupSelection && menu && <View className="candidate-sheet"><View className="sheet-head"><Text>重新选齐 {menu.structure.soup} 道汤</Text><Button onClick={() => setSoupSelection(null)}>取消</Button></View><View className="candidate-list">
          {dishes.filter((dish) => dish.active && dish.category === "soup" && ![...menu.meals[soupSelection.meal]!.meat, ...menu.meals[soupSelection.meal]!.vegetable].some((item) => item.dishId === dish.id)).map((dish) => <Button key={dish.id} disabled={disabled} onClick={() => setSoupSelection({ ...soupSelection, ids: soupSelection.ids.includes(dish.id) ? soupSelection.ids.filter((id) => id !== dish.id) : [...soupSelection.ids, dish.id] })}>{soupSelection.ids.includes(dish.id) ? "✓ " : ""}{dish.name}</Button>)}
          <Button className="primary" disabled={disabled || soupSelection.ids.length !== menu.structure.soup} onClick={() => void run(() => { setDraft(restoreSoup(menu, soupSelection.meal, soupSelection.ids, dishes)); setSoupSelection(null); })}>选齐并恢复汤</Button></View></View>}
      </>}
      <View className="week-navigation"><Button className="text-button" disabled={disabled} onClick={() => void run(async () => { if (await discard()) await Taro.reLaunch({ url: "/pages/dishes/index" }); })}>菜品池</Button>
        <Button className="text-button" disabled={disabled} onClick={() => void run(async () => { if (await discard()) await Taro.redirectTo({ url: "/pages/history/index" }); })}>历史菜单</Button></View>
      {dirty && <Text className="evidence-note">未保存的调整只保留在当前页面，关闭后无法恢复。</Text>}
    </View>
  </View>;
}
