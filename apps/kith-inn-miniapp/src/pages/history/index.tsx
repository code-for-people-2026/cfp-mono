import { useEffect, useState } from "react";
import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import type { WeekSummary } from "@cfp/kith-inn-contracts";
import { getKithInnClient } from "../../lib/api";
import { Button } from "../../lib/button";

export default function HistoryPage() {
  const [items, setItems] = useState<WeekSummary[]>([]), [before, setBefore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState("");
  async function load(more = false) {
    setBusy(true); setError("");
    try {
      const result = await getKithInnClient().listWeeks(more && before ? { before } : {});
      setItems((old) => more ? [...old, ...result.items] : result.items); setBefore(result.nextBefore); setLoaded(true);
    } catch (value) { setError(value instanceof Error ? value.message : "读取失败，请重试"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  return <View className="dish-app">
    {process.env.TARO_ENV === "h5" && <View className="app-heading">历史菜单</View>}
    <View className="dish-page"><View className="detail-head"><View><Text className="detail-kicker">保存后，随时回来看看</Text><Text className="detail-title">历史菜单</Text></View></View>
      {error && <View className="alert">{error}</View>}
      <Button className="text-button" disabled={busy} onClick={() => void load()}>重新读取</Button>
      {loaded && !items.length && <View className="menu-rule">还没有保存的菜单，先安排一周吧。</View>}
      <View className="week-plans">{items.map((week) => <Button key={week.weekStart} className="day-toggle" disabled={busy}
        onClick={() => void Taro.navigateTo({ url: `/pages/week/index?weekStart=${week.weekStart}` })}>
        <View className="day-head"><Text>{week.weekStart} 这一周</Text><Text>{week.confirmedAt ? "已确认" : "已保存"} · 查看</Text></View>
      </Button>)}</View>
      {before && <Button className="secondary" disabled={busy} onClick={() => void load(true)}>更早的菜单</Button>}
      <Button className="primary" disabled={busy} onClick={() => void Taro.navigateTo({ url: "/pages/week/index" })}>安排一周</Button>
      <Button className="text-button" onClick={() => void Taro.reLaunch({ url: "/pages/dishes/index" })}>回到菜品池</Button>
    </View>
  </View>;
}
