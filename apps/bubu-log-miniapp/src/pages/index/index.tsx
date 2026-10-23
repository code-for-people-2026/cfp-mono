import { Button, Input, Picker, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { DiaryNavigation, type DiaryView } from "../../navigation/DiaryNavigation";
import { profileUpdatedEvent, sessionExpiredEvent } from "../../navigation/events";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { ActivityDetail, DayTimeline, Heatmap, TrendCharts, WeekCalendar } from "../../components";
import {
  activityLabel, addDays, dateLabel, dayBounds, filterActivities, formatDuration,
  layoutDayTimeline, mondayOfWeek, previousEvening, sortActivities, statCards, summarizeHomeDay, summarizeRecordList,
  timeLabel, timestamp, todayKey, weekdayLabel,
  type Activity, type AuthContext, type Baby, type DailyStat, type SortField, type StatFilter,
} from "../../model";

const calendarViews = [
  { key: "day", label: "日历" }, { key: "week", label: "周历" }, { key: "month", label: "月历" },
] as const;
type Loaded = { key: string; activities: Activity[]; evening: Activity[]; latest: Activity[]; stats: DailyStat[]; complete: boolean };
const message = (error: unknown): string => error instanceof Error ? error.message : "暂时无法连接，请稍后重试";
const isUnauthorized = (error: unknown): boolean => !!error && typeof error === "object" && "status" in error && error.status === 401;
const iso = (value: number) => new Date(value).toISOString();

export default function DiaryPage() {
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const [context, setContext] = useState<AuthContext | null>(null);
  const [booting, setBooting] = useState(true);
  const [accountError, setAccountError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [mode, setMode] = useState<DiaryView>("day");
  const [date, setDate] = useState(todayKey);
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [filters, setFilters] = useState<StatFilter[]>([]);
  const [sort, setSort] = useState<SortField>("endTime");
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dataError, setDataError] = useState("");
  const [detail, setDetail] = useState<Activity | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const detailVersion = useRef(0);
  const babyId = context?.baby?.id || "";
  const weekStart = mondayOfWeek(date);
  const dataKey = `${babyId}:${mode}:${date}:${days}:${revision}`;
  const data = loaded?.key === dataKey ? loaded : null;

  const clearPrivateView = useCallback(() => {
    setMenuOpen(false); setLoaded(null); setDetail(null); setDetailError("");
    setDetailBusy(false); detailVersion.current++;
  }, []);

  const restore = useCallback(async () => {
    setBooting(true); setAccountError("");
    try { setContext(await api.getContext()); }
    catch (error) { setAccountError(message(error)); }
    finally { setBooting(false); }
  }, []);
  useEffect(() => { void restore(); }, [restore]);
  useEffect(() => {
    const updateProfile = (baby: Baby) => setContext((current) => current ? {
      ...current, baby: current.baby?.id === baby.id ? baby : current.baby,
      babies: current.babies.map((item) => item.id === baby.id ? baby : item),
    } : current);
    const expire = () => { clearPrivateView(); setContext(null); setAccountError("登录已过期，请重新登录"); };
    Taro.eventCenter.on(profileUpdatedEvent, updateProfile);
    Taro.eventCenter.on(sessionExpiredEvent, expire);
    return () => { Taro.eventCenter.off(profileUpdatedEvent, updateProfile); Taro.eventCenter.off(sessionExpiredEvent, expire); };
  }, [clearPrivateView]);

  useEffect(() => {
    if (!babyId || !context?.authenticated) return;
    let cancelled = false;
    setDataError("");
    const load = async (): Promise<Loaded> => {
      if (mode === "trend" || mode === "month") {
        const startDate = mode === "trend" ? addDays(date, 1 - days) : addDays(weekStart, -21);
        const endDate = mode === "trend" ? date : addDays(weekStart, 6);
        const stats = await api.getDailyStats({ babyId, startDate, endDate });
        return { key: dataKey, activities: [], evening: [], latest: [], stats, complete: true };
      }
      if (mode === "week") {
        const result = await api.getActivities({ babyId,
          startTimeGte: iso(dayBounds(weekStart).start),
          startTimeLt: iso(dayBounds(addDays(weekStart, 7)).start),
          crossStartTime: true, crossEndTime: true,
        });
        return { key: dataKey, ...result, evening: [], latest: [], stats: [] };
      }
      const result = await api.getActivities({ babyId, date });
      let evening: Activity[] = [];
      let complete = result.complete;
      if (mode === "day") {
        const previous = await api.getActivities({ babyId,
          startTimeGte: iso(dayBounds(date).start - 6 * 3600000), startTimeLt: iso(dayBounds(date).start),
        });
        evening = previous.activities;
        complete = complete && previous.complete;
      }
      const latest = mode === "day" && date === todayKey() ? (await Promise.all([api.getLatestActivity(babyId, ["SLEEP"]), api.getLatestActivity(babyId, ["BREASTFEED", "BOTTLE"])] )).filter((activity): activity is Activity => activity !== null) : [];
      return { key: dataKey, ...result, complete, evening, latest, stats: [] };
    };
    void load().then((next) => { if (!cancelled) setLoaded(next); }).catch((error: unknown) => {
      if (cancelled) return;
      if (isUnauthorized(error)) { clearPrivateView(); setContext(null); setAccountError("登录已过期，请重新登录"); }
      else setDataError(message(error));
    });
    return () => { cancelled = true; };
  }, [babyId, context?.authenticated, mode, date, days, weekStart, dataKey, clearPrivateView]);

  const login = async () => {
    if (!username.trim() || !password) { setAccountError("请输入账号和密码"); return; }
    setAuthBusy(true); setAccountError("");
    try { const next = await api.login({ username: username.trim(), password }); setPassword(""); setContext(next); clearPrivateView(); }
    catch (error) { setAccountError(message(error)); }
    finally { setAuthBusy(false); }
  };
  const logout = async () => {
    setAuthBusy(true); setAccountError("");
    clearPrivateView();
    try { await api.logout(); setContext(null); }
    catch (error) { setContext(null); setAccountError(message(error)); }
    finally { setAuthBusy(false); }
  };
  const changeBaby = async (index: number) => {
    const selected = context?.babies[index];
    if (!selected || selected.id === babyId) return;
    clearPrivateView(); setBooting(true); setAccountError("");
    try { setContext(await api.getContext(selected.id)); setFilters([]); }
    catch (error) { setContext(null); setAccountError(message(error)); }
    finally { setBooting(false); }
  };
  const openDetail = async (activity: Activity) => {
    const version = ++detailVersion.current;
    setDetail(null); setDetailError(""); setDetailBusy(true);
    try {
      const current = await api.getActivity(babyId, activity.id);
      if (version === detailVersion.current) setDetail(current);
    } catch (error) {
      if (version !== detailVersion.current) return;
      if (isUnauthorized(error)) { clearPrivateView(); setContext(null); setAccountError("登录已过期，请重新登录"); }
      else setDetailError(message(error));
    } finally { if (version === detailVersion.current) setDetailBusy(false); }
  };

  const summary = useMemo(() => mode === "list"
    ? summarizeRecordList(data?.activities || [], date)
    : summarizeHomeDay(data?.activities || [], date), [data, date, mode]);
  const visible = useMemo(() => filterActivities(data?.activities || [], filters), [data, filters]);
  const navigate = (direction: number) => {
    const distance = mode === "trend" ? days : mode === "week" || mode === "month" ? 7 : 1;
    const next = addDays(date, direction * distance);
    setDate(next > todayKey() ? todayKey() : next);
  };
  const periodLabel = mode === "week" ? `${dateLabel(weekStart)} — ${dateLabel(addDays(weekStart, 6))}`
    : mode === "month" ? `${dateLabel(addDays(weekStart, -21))} — ${dateLabel(addDays(weekStart, 6))}`
    : mode === "trend" ? `${dateLabel(addDays(date, 1 - days))} — ${dateLabel(date)}`
    : `${dateLabel(date)} · ${weekdayLabel(date)}`;
  const openDay = (selected: string) => { setDate(selected); setMode("list"); setFilters([]); };

  if (booting) return <View className="diary-shell"><DiaryNavigation /><View className="page"><View className="state-panel">正在打开哺哺日记…</View></View></View>;
  if (!context?.authenticated) return <View className="diary-shell"><DiaryNavigation /><View className="page login-page">
    <View className="brand-mark">日</View><Text className="eyebrow">BUBU DIARY</Text>
    <Text className="welcome-title">每一天，都值得记住</Text>
    <Text className="muted">登录哺哺日记，看看宝宝的日常与成长。</Text>
    <View className="login-card">
      <Text className="section-title">登录已有账号</Text>
      <Text className="field-label">用户名或邮箱</Text>
      <Input className="login-input" value={username} placeholder="请输入用户名或邮箱" onInput={(e) => setUsername(e.detail.value)} disabled={authBusy || undefined} />
      <Text className="field-label">密码</Text>
      <Input className="login-input" value={password} password placeholder="请输入密码" onInput={(e) => setPassword(e.detail.value)} onConfirm={() => { void login(); }} disabled={authBusy || undefined} />
      {accountError && <Text className="error-text">{accountError}</Text>}
      <Button className="primary-button" loading={authBusy} disabled={authBusy || undefined} onClick={() => { void login(); }}>登录</Button>
      <Text className="login-note">使用原宝宝日记的账号与密码</Text>
    </View>
    <Button className="text-button" disabled={authBusy || undefined} onClick={() => { void restore(); }}>重新连接</Button>
  </View></View>;

  return <View className="diary-shell">
    <DiaryNavigation context={context} mode={mode} title={mode === "list" ? "历史数据" : mode === "trend" ? "趋势统计" : "哺哺日记"}
      open={menuOpen} busy={authBusy} onOpen={() => { setViewMenuOpen(false); setMenuOpen(true); }} onClose={closeMenu}
      onSelect={(next) => { setMode(next); setDetailError(""); setFilters([]); if (next === "day") setDate(todayKey()); closeMenu(); }}
      onBabyChange={(index) => { void changeBaby(index); }}
      onSettings={() => { closeMenu(); void Taro.navigateTo({ url: `/pages/settings/index?babyId=${encodeURIComponent(babyId)}` }); }}
      onRefresh={() => { setLoaded(null); setRevision((value) => value + 1); closeMenu(); }}
      onLogout={() => { void logout(); }} />
    <View className="page diary-content">
    {accountError && <Text className="error-text">{accountError}</Text>}
    {!context.hasBaby ? <View className="state-panel"><Text className="section-title">还没有关联宝宝</Text><Text className="muted">请先在原宝宝日记中关联宝宝，再回来查看。</Text><Button className="text-button" onClick={() => { void restore(); }}>刷新</Button></View> : <>
      <View className="calendar-toolbar">
        <Button className="arrow-button" ariaLabel="上一段日期" onClick={() => navigate(-1)}>‹</Button>
        <Picker className="date-picker" mode="date" value={date} end={todayKey()} onChange={(event) => setDate(event.detail.value)}><View className="date-title">{periodLabel}<Text className="date-dropdown">⌄</Text></View></Picker>
        <Button className="arrow-button" ariaLabel="下一段日期" disabled={(mode === "week" || mode === "month" ? weekStart >= mondayOfWeek(todayKey()) : date >= todayKey()) || undefined} onClick={() => navigate(1)}>›</Button>
        {mode !== "list" && mode !== "trend" && <View className={`calendar-view-control ${viewMenuOpen ? "view-menu-open" : ""}`}>
          <Button className="calendar-view-select" ariaLabel="切换日历视图" onClick={() => setViewMenuOpen((value) => !value)}>{calendarViews.find((item) => item.key === mode)?.label}<Text> ⌄</Text></Button>
          {viewMenuOpen && <>
            <View className="calendar-view-backdrop" onClick={() => setViewMenuOpen(false)} />
            <View className="calendar-view-popover">{calendarViews.map((item) => <Button key={item.key} className={`calendar-view-option ${item.key === mode ? "current" : ""}`} onClick={() => { setMode(item.key); setFilters([]); setViewMenuOpen(false); }}>{item.label}</Button>)}</View>
          </>}
        </View>}
        {date !== todayKey() && <Button className="text-button today-button" onClick={() => setDate(todayKey())}>今天</Button>}
      </View>
      {dataError ? <View className="state-panel"><Text className="error-text">{dataError}</Text><Button className="text-button" onClick={() => setRevision((value) => value + 1)}>重试</Button></View>
        : !data ? <View className="state-panel">正在读取记录…</View> : <>
          {!data.complete && <View className="notice">记录数量达到读取上限，当前展示可能不完整。可切换到单日查看。</View>}
          {mode === "day" && <DayTimeline latestActivities={data.latest} activities={visible} date={date} onActivityClick={(activity) => { void openDetail(activity); }} />}
          {(mode === "day" || mode === "list") && <View className="daily-summary">
            <View className="section-heading"><Text className="section-title">当日汇总</Text><Text className="muted">{layoutDayTimeline(visible, date).length} 条记录</Text></View>
            <View className="stats-grid">{statCards(summary).map((card) => <View key={card.key} className={`stat-card ${filters.includes(card.key) ? "active" : ""}`} onClick={() => setFilters((old) => old.includes(card.key) ? old.filter((key) => key !== card.key) : [...old, card.key])}>
              <Text className="stat-label" style={{ color: card.color }}>{card.label}</Text><Text className="stat-value">{card.value}</Text>
            </View>)}</View>
            <View className="filter-caption"><Text>轻点上方卡片筛选记录</Text>{filters.length > 0 && <Text className="inline-action" onClick={() => setFilters([])}>显示全部</Text>}</View>
          </View>}
          {mode === "day" && <PreviousEvening activities={data.evening} date={date} />}
          {mode === "week" && <WeekCalendar activities={data.activities} weekStart={weekStart} onActivityClick={(activity) => { void openDetail(activity); }} onDateClick={openDay} />}
          {mode === "month" && <Heatmap stats={data.stats} endDate={date} onDateClick={(selected, metric) => { setDate(selected); setMode("list"); setFilters(metric === "sleep" ? ["sleep"] : ["bottle", "breastfeed", "pump"]); }} />}
          {mode === "trend" && <TrendCharts stats={data.stats} days={days} endDate={date} onDaysChange={setDays} />}
          {(mode === "month" || mode === "trend") && <View className="data-note">展示已保存的每日统计。缺少统计的日期不代表当天没有记录；刷新会重新读取已有统计。</View>}
          {mode === "list" && <>
            <View className="section-heading"><Text className="section-title">{visible.length} 条记录</Text><Picker mode="selector" range={["按活动时间", "按创建时间", "按更新时间"]} value={["endTime", "createdAt", "updatedAt"].indexOf(sort)} onChange={(e) => setSort((["endTime", "createdAt", "updatedAt"] as const)[Number(e.detail.value)]!)}><Text className="inline-action">{{ endTime: "按活动时间", createdAt: "按创建时间", updatedAt: "按更新时间" }[sort]} ⌄</Text></Picker></View>
            {sortActivities(visible, sort).map((activity) => <View className="record-row" key={activity.id} onClick={() => { void openDetail(activity); }}>
              <Text className="record-time">{timeLabel(activity.startTime)}</Text><View className="record-copy"><Text className="record-title">{activityLabel(activity)}</Text>{activity.notes && <Text className="record-note">{activity.notes}</Text>}</View><Text className="record-chevron">›</Text>
            </View>)}
            {!visible.length && <View className="state-panel">这一天还没有{filters.length ? "符合筛选的" : ""}记录</View>}
          </>}
        </>}
      {(detailBusy || detailError) && <View className="detail-notice"><Text>{detailBusy ? "正在读取详情…" : detailError}</Text><Text className="inline-action" onClick={() => { detailVersion.current++; setDetailBusy(false); setDetailError(""); }}>关闭</Text></View>}
      <ActivityDetail activity={detail} onClose={() => { setDetail(null); detailVersion.current++; }} />
    </>}
    </View>
  </View>;
}

function PreviousEvening({ activities, date }: { activities: Activity[]; date: string }) {
  const start = dayBounds(date).start;
  const { feeding, sleep } = previousEvening(activities, date);
  if (!feeding && !sleep) return null;
  return <View className="evening-card"><Text className="evening-heading">昨晚的衔接</Text>
    {feeding && <Text className="evening-line">{timeLabel(feeding.startTime)} · {activityLabel(feeding)}</Text>}
    {sleep && <Text className="evening-line">{timeLabel(sleep.startTime)} 入睡 · {sleep.endTime ? `${timestamp(sleep.endTime) >= start ? "今天 " : ""}${timeLabel(sleep.endTime)} 醒来，睡了 ${formatDuration(Math.max(0, Math.trunc((timestamp(sleep.endTime) - timestamp(sleep.startTime)) / 60000)))}` : "睡眠尚未结束"}</Text>}
  </View>;
}
