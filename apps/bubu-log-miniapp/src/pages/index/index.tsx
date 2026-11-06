import brandIcon from "../../assets/branding/bubu-avatar-borderless-v1.png";
import { Button, Image, Input, Picker, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { DiaryNavigation, type DiaryView } from "../../navigation/DiaryNavigation";
import { CalendarNavigation } from "../../navigation/CalendarNavigation";
import { profileUpdatedEvent, sessionExpiredEvent } from "../../navigation/events";
import { useTodayKey } from "../../navigation/useToday";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { ActivityDetail, DayTimeline, Heatmap, TrendCharts, WeekCalendar } from "../../components";
import type { DetailProvenanceState } from "../../components";
import {
  activityLabel, addDays, calendarPeriod, dayBounds, filterActivities, formatDuration,
  previousEvening, sortActivities, statCards, stepPeriod, summarizeHomeDay, summarizeRecordList,
  timeLabel, timestamp, todayKey,
  type Activity, type AuthContext, type Baby, type DailyStat, type SortField, type StatFilter,
} from "../../model";

type Loaded = { key: string; activities: Activity[]; evening: Activity[]; latest: Activity[]; stats: DailyStat[]; complete: boolean };
const message = (error: unknown): string => error instanceof Error ? error.message : "暂时无法连接，请稍后重试";
const isUnauthorized = (error: unknown): boolean => !!error && typeof error === "object" && "status" in error && error.status === 401;
const iso = (value: number) => new Date(value).toISOString();

export default function DiaryPage() {
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const closeViewMenu = useCallback(() => setViewMenuOpen(false), []);
  const [returnPeriod, setReturnPeriod] = useState<{ mode: DiaryView; date: string } | null>(null);
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
  const [timeScale, setTimeScale] = useState(1);
  const today = useTodayKey();
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [filters, setFilters] = useState<StatFilter[]>([]);
  const [sort, setSort] = useState<SortField>("endTime");
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dataError, setDataError] = useState("");
  const [detail, setDetail] = useState<Activity | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [provenance, setProvenance] = useState<DetailProvenanceState>({ status: "idle" });
  const detailVersion = useRef(0);
  const provenanceVersion = useRef(0);
  const mounted = useRef(true);
  const babyId = context?.baby?.id || "";
  const weekStart = calendarPeriod("week", date).start;
  const dataKey = `${babyId}:${mode}:${date}:${days}:${revision}`;
  const data = loaded?.key === dataKey ? loaded : null;

  const clearPrivateView = useCallback(() => {
    setMenuOpen(false); setViewMenuOpen(false); setReturnPeriod(null); setLoaded(null); setDetail(null); setDetailError("");
    setDetailBusy(false); setProvenance({ status: "idle" }); detailVersion.current++; provenanceVersion.current++;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      // Unmount is another context boundary: stop a multi-page audit scan and
      // keep late unauthorized responses from writing to an unmounted page.
      mounted.current = false;
      detailVersion.current++; provenanceVersion.current++;
    };
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
        const month = calendarPeriod("month", date);
        const startDate = mode === "trend" ? addDays(date, 1 - days) : month.start;
        const endDate = mode === "trend" ? date : month.end;
        const stats = await api.getDailyStats({ babyId, startDate, endDate });
        return { key: dataKey, activities: [], evening: [], latest: [], stats, complete: true };
      }
      if (mode === "week") {
        const week = calendarPeriod("week", date);
        const result = await api.getActivities({ babyId,
          startTimeGte: iso(dayBounds(week.start).start),
          startTimeLt: iso(dayBounds(week.end).next),
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
      const latest = mode === "day" && date === today ? (await Promise.all([api.getLatestActivity(babyId, ["SLEEP"]), api.getLatestActivity(babyId, ["BREASTFEED", "BOTTLE"])] )).filter((activity): activity is Activity => activity !== null) : [];
      return { key: dataKey, ...result, complete, evening, latest, stats: [] };
    };
    void load().then((next) => { if (!cancelled) setLoaded(next); }).catch((error: unknown) => {
      if (cancelled) return;
      if (isUnauthorized(error)) { clearPrivateView(); setContext(null); setAccountError("登录已过期，请重新登录"); }
      else setDataError(message(error));
    });
    return () => { cancelled = true; };
  }, [babyId, context?.authenticated, mode, date, days, weekStart, dataKey, today, clearPrivateView]);

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
    provenanceVersion.current++;
    setProvenance({ status: "idle" });
    setDetail(null); setDetailError(""); setDetailBusy(true);
    try {
      const current = await api.getActivity(babyId, activity.id);
      if (version === detailVersion.current) setDetail(current);
    } catch (error) {
      // A current-session 401 expires the private view even if this detail was
      // closed meanwhile; a replaced session surfaces as 409 SESSION_CHANGED
      // from the client instead, so it can never reach this branch.
      if (isUnauthorized(error)) {
        if (mounted.current) { clearPrivateView(); setContext(null); setAccountError("登录已过期，请重新登录"); }
        return;
      }
      if (version !== detailVersion.current) return;
      setDetailError(message(error));
    } finally { if (version === detailVersion.current) setDetailBusy(false); }
  };
  const fetchProvenance = useCallback(async () => {
    const activity = detail;
    if (!activity || !babyId) return;
    const version = ++provenanceVersion.current;
    setProvenance({ status: "loading" });
    try {
      const result = await api.getActivityProvenance(babyId, activity.id, () => version !== provenanceVersion.current);
      if (version !== provenanceVersion.current) return;
      if (result.provenance) setProvenance({ status: "found", provenance: result.provenance });
      else setProvenance({ status: result.complete ? "absent" : "incomplete" });
    } catch (error) {
      // Unauthorized is checked before the version guard: closing or collapsing
      // this optional section must not shield a genuinely expired session, while
      // late successes stay ignored. Old-session responses arrive as 409
      // SESSION_CHANGED (see the client generation guard), never as 401 here.
      if (isUnauthorized(error)) {
        if (mounted.current) { clearPrivateView(); setContext(null); setAccountError("登录已过期，请重新登录"); }
        return;
      }
      if (version !== provenanceVersion.current) return;
      setProvenance({ status: "error", message: message(error) });
    }
  }, [babyId, detail, clearPrivateView]);
  const closeDetail = () => {
    setDetail(null); setDetailError(""); detailVersion.current++;
    provenanceVersion.current++; setProvenance({ status: "idle" });
  };
  const toggleMoreInfo = (expanded: boolean) => {
    if (expanded) {
      // Only the first expansion of this open detail requests the audit endpoint.
      if (provenance.status === "idle") void fetchProvenance();
      return;
    }
    if (provenance.status === "loading") {
      provenanceVersion.current++;
      setProvenance({ status: "idle" });
    }
  };

  const summary = useMemo(() => mode === "list"
    ? summarizeRecordList(data?.activities || [], date)
    : summarizeHomeDay(data?.activities || [], date), [data, date, mode]);
  const visible = useMemo(() => filterActivities(data?.activities || [], filters), [data, filters]);
  const navigate = (direction: number) => {
    if (mode === "trend") {
      const next = addDays(date, direction * days);
      setDate(next > today ? today : next);
      return;
    }
    const period = mode === "week" ? "week" : mode === "month" ? "month" : "day";
    setDate(stepPeriod(period, date, direction, today));
  };
  const openDay = (selected: string) => {
    if (selected > today) return;
    setReturnPeriod({ mode, date }); setDate(selected); setMode("day"); setFilters([]);
  };
  const gesturesDisabled = menuOpen || viewMenuOpen || detailBusy || !!detail || !!detailError;

  if (booting) return <View className="diary-shell"><DiaryNavigation /><View className="page"><View className="state-panel">正在打开卜卜日记…</View></View></View>;
  if (!context?.authenticated) return <View className="diary-shell"><DiaryNavigation /><View className="page login-page">
    <Image className="brand-mark" src={brandIcon} mode="aspectFit" ariaLabel="卜卜日记图标" /><Text className="eyebrow">BUBU DIARY</Text>
    <Text className="welcome-title">每一天，都值得记住</Text>
    <Text className="muted">登录卜卜日记，看看宝宝的日常与成长。</Text>
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
    <DiaryNavigation context={context} mode={mode} title={mode === "list" ? "历史数据" : mode === "trend" ? "趋势统计" : "卜卜日记"}
      open={menuOpen} busy={authBusy} onOpen={() => { setViewMenuOpen(false); setMenuOpen(true); }} onClose={closeMenu}
      onSelect={(next) => { setMode(next); setReturnPeriod(null); setDetailError(""); setFilters([]); closeMenu(); }}
      onBabyChange={(index) => { void changeBaby(index); }}
      onSettings={() => { closeMenu(); void Taro.navigateTo({ url: `/pages/settings/index?babyId=${encodeURIComponent(babyId)}` }); }}
      onRefresh={() => { setLoaded(null); setRevision((value) => value + 1); closeMenu(); }}
      onLogout={() => { void logout(); }}>
      {context.hasBaby && <CalendarNavigation date={date} mode={mode} days={days} open={viewMenuOpen} today={today}
        onToggle={() => setViewMenuOpen((value) => !value)} onClose={closeViewMenu}
        onNavigate={(direction) => { closeViewMenu(); setReturnPeriod(null); navigate(direction); }}
        onDateChange={(next) => { setDate(next); setReturnPeriod(null); }}
        onModeChange={(next) => { setMode(next); setFilters([]); setReturnPeriod(null); }} />}
    </DiaryNavigation>
    <View className="page diary-content">
    {accountError && <Text className="error-text">{accountError}</Text>}
    {!context.hasBaby ? <View className="state-panel"><Text className="section-title">还没有关联宝宝</Text><Text className="muted">请先在原宝宝日记中关联宝宝，再回来查看。</Text><Button className="text-button" onClick={() => { void restore(); }}>刷新</Button></View> : <>
      {returnPeriod && <Button className="text-button period-back" onClick={() => { setMode(returnPeriod.mode); setDate(returnPeriod.date); setFilters([]); setReturnPeriod(null); }}>‹ 返回{returnPeriod.mode === "week" ? "周历" : "月历"}</Button>}
      {dataError ? <View className="state-panel"><Text className="error-text">{dataError}</Text><Button className="text-button" onClick={() => setRevision((value) => value + 1)}>重试</Button></View>
        : !data ? <View className="state-panel">正在读取记录…</View> : <>
          {!data.complete && <View className="notice">记录数量达到读取上限，当前展示可能不完整。可切换到单日查看。</View>}
          {(mode === "day" || mode === "list") && <View className="daily-summary">
            <View className="stats-grid">{statCards(summary).map((card) => <View key={card.key} className={`stat-card ${filters.includes(card.key) ? "active" : ""}`} onClick={() => setFilters((old) => old.includes(card.key) ? old.filter((key) => key !== card.key) : [...old, card.key])}>
              <Text className="stat-label" style={{ color: card.color }}>{card.label}</Text><Text className="stat-value">{card.value}</Text>
            </View>)}</View>
            {filters.length > 0 && <View className="filter-caption"><Text className="inline-action" onClick={() => setFilters([])}>显示全部</Text></View>}
          </View>}
          {mode === "day" && <>
            <PreviousEvening activities={data.evening} date={date} />
            <DayTimeline latestActivities={data.latest} activities={visible} date={date} today={today}
              scale={timeScale} onScaleChange={setTimeScale}
              gesturesDisabled={gesturesDisabled} gestureResetKey={`${babyId}:day:${date}`}
              onActivityClick={(activity) => { void openDetail(activity); }}
              onNavigate={(direction) => { setReturnPeriod(null); navigate(direction === "prev" ? -1 : 1); }} />
          </>}
          {mode === "week" && <WeekCalendar activities={data.activities} weekStart={weekStart} today={today}
            scale={timeScale} onScaleChange={setTimeScale}
            gesturesDisabled={gesturesDisabled} gestureResetKey={`${babyId}:week:${date}`}
            onActivityClick={(activity) => { void openDetail(activity); }} onDateClick={openDay}
            onNavigate={(direction) => { setReturnPeriod(null); navigate(direction === "prev" ? -1 : 1); }} />}
          {mode === "month" && <Heatmap stats={data.stats} endDate={date} today={today} onDateClick={(selected, metric) => { setReturnPeriod({ mode, date }); setDate(selected); setMode("list"); setFilters(metric === "sleep" ? ["sleep"] : ["bottle", "breastfeed", "pump"]); }} />}
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
      <ActivityDetail key={`${babyId}:${detail?.id ?? "none"}:${detailVersion.current}`} activity={detail} provenance={provenance}
        onMoreInfoToggle={toggleMoreInfo} onRetryProvenance={() => { void fetchProvenance(); }} onClose={closeDetail} />
    </>}
    </View>
  </View>;
}

function PreviousEvening({ activities, date }: { activities: Activity[]; date: string }) {
  const start = dayBounds(date).start;
  const { feeding, sleep } = previousEvening(activities, date);
  if (!feeding && !sleep) return null;
  return <View className="evening-card"><Text className="evening-heading">昨晚</Text>
    {feeding && <Text className="evening-line">{timeLabel(feeding.startTime)} · {activityLabel(feeding)}</Text>}
    {sleep && <Text className="evening-line">{timeLabel(sleep.startTime)} 入睡 · {sleep.endTime ? `${timestamp(sleep.endTime) >= start ? "今天 " : ""}${timeLabel(sleep.endTime)} 醒来，睡了 ${formatDuration(Math.max(0, Math.trunc((timestamp(sleep.endTime) - timestamp(sleep.startTime)) / 60000)))}` : "睡眠尚未结束"}</Text>}
  </View>;
}
