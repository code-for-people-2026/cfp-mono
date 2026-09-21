import { useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { ScrollView, Text, View } from "@tarojs/components";
import type { WeekPlan, WeekSummary } from "@cfp/kith-inn-contracts";
import { getKithInnClient } from "../../lib/api";
import { MainNav } from "../../lib/main-nav";
import { WeekBoard } from "../../lib/week-board";
import { Button } from "../../lib/button";

export default function HistoryPage() {
  const [items, setItems] = useState<WeekSummary[]>([]), [before, setBefore] = useState<string | null>(null);
  const [week, setWeek] = useState<WeekPlan | null>(null), [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  const [client] = useState(() => { try { return getKithInnClient(); } catch { return null; } });
  const [pending, setPending] = useState(() => client?.pendingWrite() ?? null);
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
    setWeek(result); setIndex(at);
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
  return <View className="dish-app history-app flow-page">
    {process.env.TARO_ENV === "h5" && <View className="app-heading">历史</View>}
    <View className="dish-page"><ScrollView scrollY className="flow-scroll">
      {error && <View className="alert" role="alert">{error}</View>}
      {week && <><View className="week-toolbar"><Button ariaLabel="上一保存周" disabled={busy || blocked || index + 1 >= items.length && !before} onClick={() => void run(() => move(true))}>‹</Button>
        <View className="week-range"><Text className="range-title">{week.weekStart}—{week.meals[13]!.date.slice(5)}</Text><Text>{week.confirmedAt ? "已确认" : "已保存"}</Text></View>
        <Button ariaLabel="下一保存周" disabled={busy || blocked || index === 0} onClick={() => void run(() => move(false))}>›</Button></View>
        <WeekBoard menu={week} readonly /></>}
      {loaded && !items.length && <View className="empty-history"><Text>还没有保存过菜单</Text><Button className="secondary" disabled={busy || blocked} onClick={() => void Taro.reLaunch({ url: "/pages/week/index" })}>去安排本周菜单</Button></View>}
      <Button className="text-button" disabled={busy || blocked} onClick={() => void run(load)}>重新读取</Button>
      {blocked && <View className="recovery"><Text>上次保存尚待核对，请先返回处理。</Text><Button disabled={busy}
        onClick={() => void Taro.reLaunch({ url: pending.kind === "week" ? `/pages/week/index?weekStart=${pending.weekStart}` : "/pages/dishes/index" })}>返回核对保存</Button></View>}
    </ScrollView>{week && <View className="flow-dock"><Button className="secondary" disabled={busy || blocked} onClick={() => void Taro.reLaunch({ url: `/pages/week/index?weekStart=${week.weekStart}&view=edit` })}>调整这一周</Button></View>}</View>
    <MainNav active="history" disabled={busy || blocked} onNavigate={(page) => void Taro.reLaunch({ url: `/pages/${page}/index` })} />
  </View>;
}
