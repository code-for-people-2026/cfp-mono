import { useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { Image, ScrollView, Text, View } from "@tarojs/components";
import type { WeekPlan, WeekSummary } from "@cfp/kith-inn-contracts";
import { getKithInnClient } from "../../lib/api";
import { MainNav } from "../../lib/main-nav";
import archiveIcon from "../../assets/archive.svg";
import { weekRange, WeekBoard } from "../../lib/week-board";
import { Button } from "../../lib/button";
import { DishNameProvider } from "../../lib/dish-name";

export default function HistoryPage() {
  const [items, setItems] = useState<WeekSummary[]>([]), [before, setBefore] = useState<string | null>(null);
  const [week, setWeek] = useState<WeekPlan | null>(null), [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  const [client] = useState(() => { try { return getKithInnClient(); } catch { return null; } });
  const [pending, setPending] = useState(() => client?.pendingWrite() ?? null);
  const [copyTarget, setCopyTarget] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(true);
  const shiftWeek = (date: string, days: number) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
  const blocked = !!pending && pending.state !== "rejected";
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (value) { setError(value instanceof Error ? value.message : "读取失败，请重试"); }
    finally { setBusy(false); }
  }
  async function show(list: WeekSummary[], at: number) {
    const result = await getKithInnClient().getWeek(list[at]!.weekStart);
    if (!result) throw new Error("这周菜单暂时无法读取，请重新读取。");
    setWeek(result); setIndex(at); setCopyTarget(null);
  }
  async function load() {
    const result = await getKithInnClient().listWeeks();
    if (result.items.length) await show(result.items, 0);
    else { setWeek(null); setIndex(0); }
    setItems(result.items); setBefore(result.nextBefore); setLoaded(true);
  }
  useDidShow(() => { setPending(client?.pendingWrite() ?? null); void run(load); });
  async function move(older: boolean) {
    const at = index + (older ? 1 : -1);
    if (at < items.length) { await show(items, at); return; }
    if (!before) return;
    const result = await getKithInnClient().listWeeks({ before });
    const next = [...items, ...result.items]; setItems(next); setBefore(result.nextBefore);
    if (result.items.length) await show(next, at);
  }
  return <DishNameProvider><View className="dish-app history-app flow-page">
    {process.env.TARO_ENV === "h5" && <View className="app-heading">历史</View>}
    <View className="dish-page">
      {error && <View className="alert" role="alert">{error}<Button className="text-button" disabled={busy || blocked} onClick={() => void run(load)}>重试</Button></View>}
      {week && <><View className="week-toolbar"><Button ariaLabel="上一保存周" disabled={busy || blocked || index + 1 >= items.length && !before} onClick={() => void run(() => move(true))}>‹</Button>
        <View className="week-range"><Text className="range-title">{weekRange(week, week.weekStart.slice(0, 4) !== String(new Date(Date.now() + 8 * 3600000).getUTCFullYear()))}</Text></View>
        <Button ariaLabel="下一保存周" disabled={busy || blocked || index === 0} onClick={() => void run(() => move(false))}>›</Button></View>
        </>}
      <ScrollView scrollY className="flow-scroll">{week && <WeekBoard menu={week} readonly showMealCount={false} showAll={showAll} onFilter={setShowAll} disabled={busy || blocked} />}
      {loaded && !items.length && <View className="empty-history"><Text>还没有保存过菜单</Text><Button className="secondary" disabled={busy || blocked} onClick={() => void Taro.reLaunch({ url: "/pages/week/index" })}>去安排本周菜单</Button></View>}
      {blocked && <View className="recovery"><Text>上次保存尚待核对，请先返回处理。</Text><Button disabled={busy}
        onClick={() => void Taro.reLaunch({ url: pending.kind === "week" ? `/pages/week/index?weekStart=${pending.weekStart}` : "/pages/dishes/index" })}>返回核对保存</Button></View>}
    </ScrollView>{week && <View className="flow-dock">{copyTarget ? <>
      <View className="sheet-head"><Text>复制到哪一周？</Text><Button onClick={() => setCopyTarget(null)}>取消</Button></View>
      <View className="week-toolbar"><Button ariaLabel="上一个目标周" onClick={() => setCopyTarget(shiftWeek(copyTarget, -7))}>‹</Button>
        <Text>{copyTarget} — {shiftWeek(copyTarget, 6).slice(5)}</Text>
        <Button ariaLabel="下一个目标周" onClick={() => setCopyTarget(shiftWeek(copyTarget, 7))}>›</Button></View>
      <Button className="primary green" disabled={busy || blocked || copyTarget === week.weekStart} onClick={() => void Taro.reLaunch({ url: `/pages/week/index?weekStart=${copyTarget}&copyFrom=${week.weekStart}` })}>复制到所选周</Button>
    </> : <Button className="primary green" disabled={busy || blocked} onClick={() => setCopyTarget(shiftWeek(week.weekStart, 7))}>复制这周菜单<Image className="flow-icon" src={archiveIcon} /></Button>}</View>}</View>
    <MainNav active="history" disabled={busy || blocked} onNavigate={(page) => void Taro.reLaunch({ url: `/pages/${page}/index` })} />
  </View></DishNameProvider>;
}
