import { SafetyNotices } from "../../privacy/SafetyNotices";
import { Choice, PolicyDocuments, PrivacyCenter } from "../../privacy/PrivacyCenter";
import type { PrivacyPolicy } from "../../privacy/contracts";
import { DiaryChat, type ChatSelection } from "../../chat/Chat";
import { chatDrafts } from "../../chat/storage";
import { clearImageFiles } from "../../chat/files";
import { Button, Image, Input, Picker, Text, View } from "@tarojs/components";
import brandIcon from "../../assets/branding/bubu-avatar-borderless-v1.png";
import Taro, { useDidShow } from "@tarojs/taro";
import { DiaryNavigation, type DiaryView } from "../../navigation/DiaryNavigation";
import { CalendarNavigation } from "../../navigation/CalendarNavigation";
import { identityUpdatedEvent, profileUpdatedEvent, sessionExpiredEvent } from "../../navigation/events";
import { useTodayKey } from "../../navigation/useToday";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, identityEnabled, wechatIdentityEnabled } from "../../api";
import { IdentitySetup } from "../../components/IdentitySetup";
import { ActivityDetail, DayTimeline, Heatmap, TrendCharts, WeekCalendar } from "../../components";
import type { DetailProvenanceState } from "../../components";
import { CollapsibleDaySummary } from "../../components/CollapsibleDaySummary";
import { DEFAULT_CARE_PREFERENCES, getCarePreferences, type CarePreferences } from "../../preferences/care-preferences";
import { carePreferencesScope, carePreferencesUpdatedEvent } from "../../preferences/runtime";
import {
  activityLabel, addDays, calendarPeriod, dayBounds, filterActivities, formatDuration,
  layoutDayTimeline, previousEvening, sortActivities, statCards, stepPeriod, summarizeHomeDay, summarizeRecordList,
  timeLabel, timestamp, todayKey, coverageMessage, recordStatCards, syncStatusLines,
  type Activity, type AuthContext, type Baby, type SortField, type StatFilter,
  type RecordEvent, type RecordSyncStatus,
} from "../../model";
import { loadTimeline, type TimelineLoaded, type TimelineMode } from "../../api/timeline";
import {
  TimelineCacheStaleError,
  TimelinePrefetchCache,
  timelineCacheKey,
  timelineDisplayKey,
  timelinePeriodDate,
  type TimelineCacheContext,
} from "../../navigation/timeline-cache";

type Loaded = TimelineLoaded;
type CarePreferencesState = { babyId: string; preferences: CarePreferences; error: string };
const message = (error: unknown): string => error instanceof Error ? error.message : "暂时无法连接，请稍后重试";
const isUnauthorized = (error: unknown): boolean => !!error && typeof error === "object" && "status" in error && error.status === 401;
const isForbidden = (error: unknown): boolean => !!error && typeof error === "object" && "status" in error && error.status === 403;
const iso = (value: number) => new Date(value).toISOString();
const readCarePreferences = (babyId: string): CarePreferencesState => {
  try {
    const result = getCarePreferences(carePreferencesScope(babyId));
    return {
      babyId,
      preferences: result.preferences,
      error: result.storageState === "corrupt" ? "本地照护环设置已损坏，已使用默认参考。" : "",
    };
  } catch {
    return {
      babyId,
      preferences: DEFAULT_CARE_PREFERENCES,
      error: "照护环设置暂时不可读取，已使用默认参考。",
    };
  }
};

export default function DiaryPage() {
  const [privacyReadyKey, setPrivacyReadyKey] = useState("");
  const [privacyPolicy, setPrivacyPolicy] = useState<PrivacyPolicy>();
  const [policyLoading, setPolicyLoading] = useState(identityEnabled);
  const [policyError, setPolicyError] = useState("");
  const policyGeneration = useRef(0);
  const [loginNotice, setLoginNotice] = useState(false);
  const [privacyCheck, setPrivacyCheck] = useState(0);
  const [chatSelection, setChatSelection] = useState<ChatSelection>();
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
  const timelineCache = useRef(new TimelinePrefetchCache(5));
  const [cacheVersion, setCacheVersion] = useState(0);
  const [carePreferences, setCarePreferences] = useState<CarePreferencesState | null>(null);
  const [dataError, setDataError] = useState("");
  const [detail, setDetail] = useState<Activity | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [provenance, setProvenance] = useState<DetailProvenanceState>({ status: "idle" });
  const [detailPhotos, setDetailPhotos] = useState<string[]>([]);
  const [detailEvent, setDetailEvent] = useState<RecordEvent | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [photoLoading, setPhotoLoading] = useState(false);
  const photoPaths = useRef<string[]>([]);
  const [sync, setSync] = useState<{ babyId: string; jobs: RecordSyncStatus[]; error?: string } | null>(null);
  const [summaryHidden, setSummaryHidden] = useState(false);
  const [summaryHeight, setSummaryHeight] = useState(0);
  const detailVersion = useRef(0);
  const provenanceVersion = useRef(0);
  const identityEpoch = useRef(0);
  const identityKey = useRef("");
  const mounted = useRef(true);
  const contextVersion = useRef(0);
  const authInFlight = useRef(false);
  const babyId = context?.baby?.id || "";
  const privacyKey = `${context?.identityId || ""}:${babyId}`;
  const privacyReady = !identityEnabled || privacyReadyKey === privacyKey;
  // A native picker/preview also triggers onShow. Revalidate the same scope
  // without destroying its in-flight upload and chat state on every return.
  useDidShow(() => { setPrivacyCheck(value => value + 1); });
  const loadLoginPolicy = useCallback(async () => {
    if (!identityEnabled) return;
    const generation = ++policyGeneration.current;
    setPolicyLoading(true); setPolicyError(""); setPrivacyPolicy(undefined); setLoginNotice(false);
    try {
      const next = await api.privacyPolicy();
      if (generation === policyGeneration.current) {
        setPrivacyPolicy(next);
        if (!next.ready) setPolicyError("服务暂未就绪，请稍后重试。");
      }
    } catch {
      if (generation === policyGeneration.current) setPolicyError("隐私说明暂时无法加载，请检查网络后重试。");
    } finally {
      if (generation === policyGeneration.current) setPolicyLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadLoginPolicy();
    return () => { policyGeneration.current++; };
  }, [loadLoginPolicy]);
  useEffect(() => {
    if (!identityEnabled || !context?.authenticated) return;
    let active = true;
    void api.privacyStatus(babyId || undefined).then(status => {
      if (active) setPrivacyReadyKey(status.consentCurrent && (!babyId || status.guardianCurrent) ? privacyKey : "");
    }).catch(() => { if (active) setPrivacyReadyKey(""); });
    return () => { active = false; };
  }, [context?.authenticated, babyId, privacyKey, privacyCheck]);
  const weekStart = calendarPeriod("week", date).start;
  const dataKey = mode === "day" || mode === "week"
    ? timelineDisplayKey({ identity: { epoch: identityEpoch.current, babyId, revision, today }, mode, date })
    : `${babyId}:${mode}:${date}:${days}:${revision}`;
  const data = loaded?.key === dataKey ? loaded : null;

  const releaseDetailPhotos = useCallback(() => {
    photoPaths.current.forEach(path => api.releasePhotoUrl(path));
    photoPaths.current = [];
    setDetailPhotos([]);
    setDetailEvent(null);
    setPhotoCount(0);
    setPhotoLoading(false);
  }, []);

  const clearPrivateView = useCallback(() => {
    setPrivacyReadyKey("");
    setChatSelection(undefined); setMenuOpen(false); setLoaded(null); setDetail(null); setDetailError("");
    setDetailBusy(false); setDataError(""); setSync(null); detailVersion.current++;
    setViewMenuOpen(false); setReturnPeriod(null);
    releaseDetailPhotos();
    setProvenance({ status: "idle" }); provenanceVersion.current++;
    timelineCache.current.reset();
    setCacheVersion((version) => version + 1);
  }, [releaseDetailPhotos]);
  useEffect(() => {
    const nextIdentity = `${context?.authenticated ? "authenticated" : "guest"}:${context?.authenticated ? babyId : ""}`;
    if (!identityKey.current) {
      identityKey.current = nextIdentity;
      return;
    }
    if (identityKey.current !== nextIdentity) {
      identityEpoch.current++;
      identityKey.current = nextIdentity;
    }
  }, [babyId, context?.authenticated]);

  const timelineContext = useCallback((targetMode: TimelineMode, targetDate: string): TimelineCacheContext => ({
    identity: { epoch: identityEpoch.current, babyId, revision, today },
    mode: targetMode,
    date: targetDate,
  }), [babyId, revision, today]);

  const requestTimeline = useCallback((target: TimelineCacheContext) => timelineCache.current.load(target, () => loadTimeline({
    babyId: target.identity.babyId,
    mode: target.mode,
    date: target.date,
    today: target.identity.today,
    key: timelineDisplayKey(target),
  })), []);

  const expireForIdentity = useCallback((
    identity: TimelineCacheContext["identity"],
    error: unknown,
    requestContextVersion: number,
  ) => {
    if (!isUnauthorized(error) || !mounted.current) return;
    // Authentication and baby boundaries advance the epoch. Date, view, refresh,
    // and rollover changes remain the same session; a late 401 still expires it.
    if (
      identityEpoch.current !== identity.epoch
      || babyId !== identity.babyId
      || contextVersion.current !== requestContextVersion
    ) return;
    clearPrivateView();
    setContext(null);
    setAccountError("登录已过期，请重新登录");
  }, [babyId, clearPrivateView]);

  const prefetchAdjacent = useCallback((base: TimelineCacheContext, requestContextVersion: number) => {
    const targets: Array<"prev" | "next"> = ["prev", "next"];
    const periodDate = timelinePeriodDate(base.mode, base.date);
    for (const direction of targets) {
      const distance = base.mode === "week" ? 7 : 1;
      const targetDate = addDays(periodDate, direction === "prev" ? -distance : distance);
      if (base.mode === "day" ? targetDate > today : calendarPeriod("week", targetDate).start > calendarPeriod("week", today).start) continue;
      const next = { ...base, date: targetDate };
      void requestTimeline(next).then(() => {
        if (!mounted.current
          || identityEpoch.current !== base.identity.epoch
          || babyId !== base.identity.babyId
          || revision !== base.identity.revision
          || today !== base.identity.today
          || contextVersion.current !== requestContextVersion) return;
        // adjacentPages is memoized over the cache; completion must re-render it.
        setCacheVersion((version) => version + 1);
      }).catch((error: unknown) => expireForIdentity(next.identity, error, requestContextVersion));
    }
  }, [babyId, expireForIdentity, requestTimeline, revision, today]);

  const showCachedTimeline = useCallback((targetMode: TimelineMode, targetDate: string) => {
    const cached = timelineCache.current.peek(timelineContext(targetMode, targetDate));
    if (cached) setLoaded(cached);
    return cached;
  }, [timelineContext]);

  const navigateTimeline = useCallback((direction: "prev" | "next") => {
    if (mode !== "day" && mode !== "week") return;
    const targetDate = stepPeriod(mode, date, direction === "prev" ? -1 : 1, today);
    if (targetDate === date) return;
    showCachedTimeline(mode, targetDate);
    setReturnPeriod(null);
    setDate(targetDate);
  }, [date, mode, showCachedTimeline, today]);

  const navigateTimelineReady = useCallback((direction: "prev" | "next") => {
    if (mode !== "day" && mode !== "week") return false;
    const targetDate = stepPeriod(mode, date, direction === "prev" ? -1 : 1, today);
    if (timelineCache.current.peek(timelineContext(mode, targetDate))) return true;
    // Recoil is not permanent: a failed/absent prefetch is retried when ready is polled.
    const target = timelineContext(mode, targetDate);
    const requestContextVersion = contextVersion.current;
    void requestTimeline(target).then(() => {
      if (contextVersion.current === requestContextVersion) setCacheVersion((version) => version + 1);
    }).catch((error: unknown) => expireForIdentity(target.identity, error, requestContextVersion));
    return false;
  }, [date, expireForIdentity, mode, requestTimeline, timelineContext, today]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      // Unmount is another context boundary: stop a multi-page audit scan and
      // keep late unauthorized responses from writing to an unmounted page.
      mounted.current = false;
      detailVersion.current++; provenanceVersion.current++;
    };
  }, []);
  useEffect(() => () => {
    photoPaths.current.forEach(path => api.releasePhotoUrl(path));
    detailVersion.current++; provenanceVersion.current++;
  }, []);

  const restore = useCallback(async () => {
    const version = ++contextVersion.current;
    clearPrivateView(); setContext(null); setBooting(true); setAccountError("");
    try { const next = await api.getContext(); if (version === contextVersion.current) setContext(next); }
    catch (error) { if (version === contextVersion.current) setAccountError(message(error)); }
    finally { if (version === contextVersion.current) setBooting(false); }
  }, [clearPrivateView]);
  const identityUpdated = useCallback((next: AuthContext) => {
    contextVersion.current++; clearPrivateView(); setContext(next); setAccountError(""); setBooting(false);
  }, [clearPrivateView]);
  useEffect(() => { clearImageFiles(); void restore(); }, [restore]);
  useEffect(() => {
    if (!identityEnabled || !context) return;
    if (context.authenticated && context.identityId) chatDrafts.reconcile(context.identityId, context.babies.map(baby => baby.id));
    else chatDrafts.clear();
  }, [context]);
  useEffect(() => {
    const updateProfile = (baby: Baby) => setContext((current) => current ? {
      ...current, baby: current.baby?.id === baby.id ? baby : current.baby,
      babies: current.babies.map((item) => item.id === baby.id ? baby : item),
    } : current);
    const expire = () => { contextVersion.current++; clearPrivateView(); setContext(null); setBooting(false); setAccountError("登录已过期，请重新登录"); };
    Taro.eventCenter.on(profileUpdatedEvent, updateProfile);
    Taro.eventCenter.on(sessionExpiredEvent, expire);
    Taro.eventCenter.on(identityUpdatedEvent, identityUpdated);
    return () => { Taro.eventCenter.off(profileUpdatedEvent, updateProfile); Taro.eventCenter.off(sessionExpiredEvent, expire); Taro.eventCenter.off(identityUpdatedEvent, identityUpdated); };
  }, [clearPrivateView, identityUpdated]);

  useEffect(() => {
    if (!babyId || !context?.authenticated) {
      setCarePreferences(null);
      return;
    }
    if (!privacyReady) return;
    setCarePreferences(readCarePreferences(babyId));
    const updatePreferences = (changedBaby: unknown) => {
      if (changedBaby === babyId) setCarePreferences(readCarePreferences(babyId));
    };
    Taro.eventCenter.on(carePreferencesUpdatedEvent, updatePreferences);
    return () => {
      Taro.eventCenter.off(carePreferencesUpdatedEvent, updatePreferences);
    };
  }, [babyId, context?.authenticated, privacyReady]);

  useEffect(() => {
    if (!babyId || !context?.authenticated || !privacyReady) return;
    if (mode === "day" || mode === "week") {
      const request = timelineContext(mode, date);
      const requestIdentity = request.identity;
      const requestCacheKey = timelineCacheKey(request);
      const requestContextVersion = contextVersion.current;
      let cancelled = false;
      setDataError("");
      const cached = timelineCache.current.peek(request);
      if (cached) {
        setLoaded(cached);
        prefetchAdjacent(request, requestContextVersion);
        return () => { cancelled = true; };
      }
      void requestTimeline(request).then((next) => {
        const currentKey = timelineCacheKey(timelineContext(mode, date));
        if (
          !cancelled &&
          mounted.current &&
          identityEpoch.current === requestIdentity.epoch &&
          contextVersion.current === requestContextVersion &&
          currentKey === requestCacheKey
        ) {
          setLoaded(next);
          prefetchAdjacent(request, requestContextVersion);
        }
        if (contextVersion.current === requestContextVersion && currentKey === requestCacheKey) {
          setCacheVersion((version) => version + 1);
        }
      }).catch((error: unknown) => {
        expireForIdentity(requestIdentity, error, requestContextVersion);
        if (cancelled || !mounted.current || error instanceof TimelineCacheStaleError) return;
        if (
          identityEpoch.current !== requestIdentity.epoch ||
          contextVersion.current !== requestContextVersion ||
          timelineCacheKey(timelineContext(mode, date)) !== requestCacheKey
        ) return;
        if (isUnauthorized(error)) return;
        if (isForbidden(error)) { void restore(); return; }
        setDataError(message(error));
      });
      return () => { cancelled = true; };
    }

    const requestIdentityEpoch = identityEpoch.current;
    const requestContextVersion = contextVersion.current;
    let cancelled = false;
    setDataError("");
    const load = async (): Promise<Loaded> => {
      if (mode === "trend" || mode === "month") {
        const month = calendarPeriod("month", date);
        const startDate = mode === "trend" ? addDays(date, 1 - days) : month.start;
        const endDate = mode === "trend" ? date : month.end;
        if (mode === "trend") {
          const stats = await api.getDailyStats({ babyId, startDate, endDate });
          return { key: dataKey, activities: [], evening: [], latest: [], stats, complete: true };
        }

        const bounds = dayBounds(month.start);
        const endBounds = dayBounds(month.end);
        const [statsResult, activitiesResult, profileResult] = await Promise.allSettled([
          api.getDailyStats({ babyId, startDate, endDate }),
          api.getActivities({
            babyId,
            startTimeGte: iso(bounds.start),
            startTimeLt: iso(endBounds.next),
            crossStartTime: true,
            crossEndTime: true,
          }),
          api.getBabyProfile(babyId),
        ]);
        const failures = [statsResult, activitiesResult, profileResult].filter((result) => result.status === "rejected");
        const unauthorized = failures.find((result) => result.status === "rejected" && isUnauthorized(result.reason));
        if (unauthorized) throw (unauthorized as PromiseRejectedResult).reason;
        const requiredFailure = [statsResult, activitiesResult].find((result) => result.status === "rejected");
        if (requiredFailure) throw (requiredFailure as PromiseRejectedResult).reason;
        if (activitiesResult.status !== "fulfilled" || statsResult.status !== "fulfilled") throw new Error("暂时无法连接，请稍后重试");

        let birthDate: string | null = null;
        let profileError = "";
        if (profileResult.status === "fulfilled") birthDate = profileResult.value.birthDate ?? null;
        else profileError = "宝宝资料读取失败，年龄参考不可用；月历仍展示记录。";
        return {
          key: dataKey,
          activities: activitiesResult.value.activities,
          evening: [],
          latest: [],
          stats: statsResult.value,
          complete: activitiesResult.value.complete,
          birthDate,
          profileError,
        };
      }
      if (mode === "list") {
        const snapshot = identityEnabled ? await api.getSnapshot(babyId, date) : null;
        if (snapshot) {
          return {
            key: dataKey,
            activities: snapshot.activities,
            complete: true,
            recordSummary: snapshot.summary,
            evening: [],
            latest: [],
            stats: [],
          };
        }
        const result = await api.getActivities({ babyId, date });
        return { key: dataKey, ...result, evening: [], latest: [], stats: [] };
      }
      throw new Error("暂时无法连接，请稍后重试");
    };
    void load().then((next) => {
      if (
        !cancelled &&
        mounted.current &&
        identityEpoch.current === requestIdentityEpoch &&
        contextVersion.current === requestContextVersion
      ) setLoaded(next);
    }).catch((error: unknown) => {
      if (isUnauthorized(error)) {
        // A view/date change is not an identity change: a late 401 still
        // expires the current session. Baby/session changes advance the epoch;
        // their old responses must not clear the newly selected view.
        if (
          mounted.current &&
          identityEpoch.current === requestIdentityEpoch &&
          contextVersion.current === requestContextVersion
        ) {
          clearPrivateView(); setContext(null); setAccountError("登录已过期，请重新登录");
        }
        return;
      }
      if (isForbidden(error)) {
        if (
          !cancelled &&
          mounted.current &&
          identityEpoch.current === requestIdentityEpoch &&
          contextVersion.current === requestContextVersion
        ) void restore();
        return;
      }
      if (cancelled || !mounted.current) return;
      setDataError(message(error));
    });
    return () => { cancelled = true; };
  }, [babyId, context?.authenticated, privacyReady, mode, date, days, weekStart, dataKey, today,
    clearPrivateView, restore, expireForIdentity, prefetchAdjacent, requestTimeline, timelineContext]);

  useEffect(() => {
    if (!identityEnabled || !babyId || !context?.authenticated || !privacyReady) return;
    const requestIdentityEpoch = identityEpoch.current;
    const requestContextVersion = contextVersion.current;
    let cancelled = false;
    void api.getSyncStatus(babyId).then(jobs => {
      if (
        !cancelled &&
        identityEpoch.current === requestIdentityEpoch &&
        contextVersion.current === requestContextVersion
      ) setSync({ babyId, jobs });
    }).catch((error: unknown) => {
      if (
        cancelled ||
        !mounted.current ||
        identityEpoch.current !== requestIdentityEpoch ||
        contextVersion.current !== requestContextVersion
      ) return;
      if (isUnauthorized(error)) { clearPrivateView(); setContext(null); setAccountError("登录已过期，请重新登录"); }
      else if (isForbidden(error)) void restore();
      else setSync({ babyId, jobs: [], error: "同步状态暂时不可用，当前仅显示已保存记录" });
    });
    return () => { cancelled = true; };
  }, [babyId, context?.authenticated, privacyReady, revision, clearPrivateView, restore]);

  const login = async () => {
    if (authInFlight.current) return;
    if (identityEnabled && (policyLoading || !privacyPolicy?.ready)) { setAccountError("请先成功加载隐私说明，再继续登录。"); return; }
    if (identityEnabled && !loginNotice) { setAccountError("请阅读说明并主动选择同意本次登录。"); return; }
    if (!wechatIdentityEnabled && (!username.trim() || !password)) { setAccountError("请输入账号和密码"); return; }
    authInFlight.current = true;
    const version = ++contextVersion.current;
    clearPrivateView(); setAuthBusy(true); setAccountError("");
    try {
      const next = wechatIdentityEnabled ? await api.loginWithWechat(privacyPolicy?.version) : await api.login({ username: username.trim(), password });
      if (version === contextVersion.current) setContext(next);
    } catch (error) { if (version === contextVersion.current) setAccountError(message(error)); }
    finally { authInFlight.current = false; setPassword(""); setAuthBusy(false); }
  };
  const logout = async () => {
    if (authInFlight.current) return;
    setLoginNotice(false);
    chatDrafts.clear(); clearImageFiles();
    authInFlight.current = true;
    const version = ++contextVersion.current;
    setAuthBusy(true); setAccountError(""); clearPrivateView(); setContext(null);
    try { await api.logout(); }
    catch (error) { if (version === contextVersion.current) setAccountError(message(error)); }
    finally { authInFlight.current = false; setAuthBusy(false); }
  };
  const changeBaby = async (index: number) => {
    const selected = context?.babies[index];
    if (!selected || selected.id === babyId) return;
    const version = ++contextVersion.current;
    identityEpoch.current++;
    identityKey.current = `authenticated:${selected.id}`;
    clearPrivateView(); setContext(null); setBooting(true); setAccountError("");
    try { const next = await api.getContext(selected.id); if (version === contextVersion.current) { setContext(next); setFilters([]); } }
    catch (error) {
      if (version !== contextVersion.current) return;
      if (isForbidden(error)) { void restore(); }
      else setAccountError(message(error));
    } finally { if (version === contextVersion.current) setBooting(false); }
  };
  const openDetail = async (activity: Activity) => {
    closeDetail();
    const version = ++detailVersion.current;
    provenanceVersion.current++;
    const requestIdentityEpoch = identityEpoch.current;
    const requestContextVersion = contextVersion.current;
    setProvenance({ status: "idle" });
    setDetail(null); setDetailError(""); setDetailBusy(true);
    try {
      const [current, event] = await Promise.all([api.getActivity(babyId, activity.id), identityEnabled ? api.getRecordEvent(babyId, activity.id) : Promise.resolve(null)]);
      if (version !== detailVersion.current) return;
      setDetail(current); setDetailEvent(event); setDetailBusy(false);
      const urls = [...new Set([...(current.poopPhotoUrl ? [current.poopPhotoUrl] : []), ...(event?.attachmentIds.map(id => `/api/app/attachments/${id}?babyId=${encodeURIComponent(babyId)}`) ?? [])])];
      setPhotoCount(urls.length);
      if (urls.length) {
        setPhotoLoading(true);
        for (const url of urls) {
          const photo = await api.resolvePhotoUrl(url, babyId);
          if (version !== detailVersion.current) { api.releasePhotoUrl(photo); return; }
          photoPaths.current.push(photo);
          setDetailPhotos([...photoPaths.current]);
        }
      }
    } catch (error) {
      // A current-session 401 expires the private view even if this detail was
      // closed meanwhile; a replaced session surfaces as 409 SESSION_CHANGED
      // from the client instead, so it can never reach this branch.
      if (isUnauthorized(error)) {
        if (
          mounted.current &&
          identityEpoch.current === requestIdentityEpoch &&
          contextVersion.current === requestContextVersion
        ) { clearPrivateView(); setContext(null); setAccountError("登录已过期，请重新登录"); }
        return;
      }
      if (version !== detailVersion.current) return;
      if (isForbidden(error)) { void restore(); }
      else setDetailError(message(error));
    } finally { if (version === detailVersion.current) { setDetailBusy(false); setPhotoLoading(false); } }
  };
  const fetchProvenance = useCallback(async () => {
    const activity = detail;
    if (!activity || !babyId) return;
    const version = ++provenanceVersion.current;
    const requestIdentityEpoch = identityEpoch.current;
    const requestContextVersion = contextVersion.current;
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
        if (
          mounted.current &&
          identityEpoch.current === requestIdentityEpoch &&
          contextVersion.current === requestContextVersion
        ) { clearPrivateView(); setContext(null); setAccountError("登录已过期，请重新登录"); }
        return;
      }
      if (version !== provenanceVersion.current) return;
      setProvenance({ status: "error", message: message(error) });
    }
  }, [babyId, detail, clearPrivateView]);
  const closeDetail = () => {
    setDetail(null); setDetailError(""); setDetailBusy(false); detailVersion.current++;
    provenanceVersion.current++; setProvenance({ status: "idle" });
    releaseDetailPhotos();
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

  const refreshAfterChat = useCallback(() => { setLoaded(null); setRevision(value => value + 1); }, []);
  const chatRevoked = useCallback((error: { status: number }) => {
    clearPrivateView();
    if (error.status === 401) { setContext(null); setAccountError("登录已过期，请重新登录"); }
    else void restore();
  }, [clearPrivateView, restore]);

  const summary = useMemo(() => mode === "list"
    ? summarizeRecordList(data?.activities || [], date)
    : summarizeHomeDay(data?.activities || [], date), [data, date, mode]);
  const cards = useMemo(() => data?.recordSummary ? recordStatCards(data.recordSummary) : statCards(summary), [data, summary]);
  const visible = useMemo(() => filterActivities(data?.activities || [], filters), [data, filters]);
  const revealSummary = useCallback(() => setSummaryHidden(false), []);
  const handleSummaryHeight = useCallback((height: number) => {
    setSummaryHeight((previous) => (Math.abs(previous - height) <= 0.5 ? previous : height));
  }, []);
  const handleScrollIntent = useCallback((intent: "hide" | "show") => {
    setSummaryHidden(intent === "hide");
  }, []);
  const navigate = (direction: number) => {
    revealSummary();
    if (mode === "trend") {
      const next = addDays(date, direction * days);
      setDate(next > today ? today : next);
      return;
    }
    if (mode === "day" || mode === "week") {
      const next = stepPeriod(mode === "week" ? "week" : "day", date, direction, today);
      if (next !== date) showCachedTimeline(mode, next);
      setDate(next);
      return;
    }
    const period = mode === "month" ? "month" : "day";
    setDate(stepPeriod(period, date, direction, today));
  };
  const adjacentPages = useMemo(() => {
    if (mode !== "day" && mode !== "week") return undefined;
    const distance = mode === "week" ? 7 : 1;
    const result: Partial<Record<"prev" | "next", Loaded>> = {};
    for (const direction of ["prev", "next"] as const) {
      const targetDate = addDays(date, direction === "prev" ? -distance : distance);
      if (mode === "day" ? targetDate > today : calendarPeriod("week", targetDate).start > calendarPeriod("week", today).start) continue;
      const target = timelineCache.current.peek(timelineContext(mode, targetDate));
      if (!target) continue;
      result[direction] = mode === "day"
        ? { ...target, activities: filterActivities(target.activities, filters) }
        : target;
    }
    return result;
  }, [cacheVersion, date, filters, mode, today, timelineContext]);
  const openDay = (selected: string) => {
    if (selected > today) return;
    revealSummary();
    showCachedTimeline("day", selected);
    setReturnPeriod({ mode, date }); setDate(selected); setMode("day"); setFilters([]);
  };
  const gesturesDisabled = menuOpen || viewMenuOpen || detailBusy || !!detail || !!detailError;

  if (booting) return <View className="diary-shell"><DiaryNavigation /><View className="page"><View className="state-panel">正在打开卜卜日记…</View></View></View>;
  if (!context?.authenticated) return <View className="diary-shell"><DiaryNavigation /><View className="page login-page">
    <Image className="brand-mark" src={brandIcon} mode="aspectFit" ariaLabel="卜卜日记图标" /><Text className="eyebrow">BUBU DIARY</Text>
    <Text className="welcome-title">每一天，都值得记住</Text>
    <Text className="muted">登录卜卜日记，看看宝宝的日常与成长。</Text>
    <View className="login-card">
      <Text className="section-title">{wechatIdentityEnabled ? "微信登录" : "登录已有账号"}</Text>
      {!wechatIdentityEnabled && <><Text className="field-label">用户名或邮箱</Text>
      <Input className="login-input" value={username} placeholder="请输入用户名或邮箱" onInput={(e) => setUsername(e.detail.value)} disabled={authBusy || undefined} />
      <Text className="field-label">密码</Text>
      <Input className="login-input" value={password} password placeholder="请输入密码" onInput={(e) => setPassword(e.detail.value)} onConfirm={() => { void login(); }} disabled={authBusy || undefined} /></>}
      {identityEnabled && <>
        {policyLoading && <Text className="muted">正在读取隐私说明…</Text>}
        {privacyPolicy && <PolicyDocuments policy={privacyPolicy} />}
        {policyError && <><Text className="error-text">{policyError}</Text><Button className="text-button" onClick={() => { void loadLoginPolicy(); }}>重试读取说明</Button></>}
        <Choice label="我已阅读说明，同意用微信或已有账号完成登录" value={loginNotice} disabled={policyLoading || !privacyPolicy?.ready || authBusy} onChange={value => { setLoginNotice(value); setAccountError(""); }} />
        <Text className="muted">登录后再分别选择敏感信息、AI、图片和监护授权。</Text>
      </>}
      {accountError && <Text className="error-text">{accountError}</Text>}
      <Button className="primary-button" loading={authBusy} disabled={authBusy || (identityEnabled && (policyLoading || !privacyPolicy?.ready || !loginNotice)) || undefined} onClick={() => { void login(); }}>{wechatIdentityEnabled ? "微信登录并继续" : "登录"}</Button>
      <Text className="login-note">{wechatIdentityEnabled ? "登录后可创建宝宝、绑定已有账号或加入家人" : "使用原宝宝日记的账号与密码"}</Text>
    </View>
    <Button className="text-button" disabled={authBusy || policyLoading || undefined} onClick={() => { void restore(); void loadLoginPolicy(); }}>重新连接</Button>
  </View></View>;

  if (!privacyReady) return <View className="diary-shell"><DiaryNavigation context={context} restricted open={menuOpen} onOpen={() => setMenuOpen(true)} onClose={closeMenu} onBabyChange={index => { void changeBaby(index); }} onRefresh={() => { void restore(); }} onLogout={() => { void logout(); }} /><View className="page"><PrivacyCenter key={privacyKey} babyId={babyId || undefined} onReady={() => { setPrivacyCheck(value => value + 1); void restore(); }} /><Button className="text-button" onClick={() => { void logout(); }}>退出登录</Button></View></View>;

  return <View className="diary-shell">
    <DiaryNavigation context={context} mode={mode} title={mode === "list" ? "历史数据" : mode === "trend" ? "趋势统计" : "卜卜日记"}
      open={menuOpen} busy={authBusy} onOpen={() => { setViewMenuOpen(false); setMenuOpen(true); }} onClose={closeMenu} onAccessRevoked={restore}
      onSelect={(next) => {
        revealSummary();
        if (next === "day" || next === "week") showCachedTimeline(next, date);
        setMode(next); setReturnPeriod(null); setDetailError(""); setFilters([]); closeMenu();
      }}
      onBabyChange={(index) => { revealSummary(); void changeBaby(index); }}
      onSettings={() => { closeMenu(); void Taro.navigateTo({ url: `/pages/settings/index?babyId=${encodeURIComponent(babyId)}` }); }}
      onRefresh={() => { timelineCache.current.reset(); setLoaded(null); setRevision((value) => value + 1); setCacheVersion((version) => version + 1); closeMenu(); }}
      onLogout={() => { void logout(); }}>
      {context.hasBaby && <CalendarNavigation date={date} mode={mode} days={days} open={viewMenuOpen} today={today}
        onToggle={() => setViewMenuOpen((value) => !value)} onClose={closeViewMenu}
        onNavigate={(direction) => { closeViewMenu(); setReturnPeriod(null); navigate(direction); }}
        onDateChange={(next) => {
          revealSummary();
          if (mode === "day" || mode === "week") showCachedTimeline(mode, next);
          setDate(next); setReturnPeriod(null);
        }}
        onModeChange={(next) => {
          revealSummary();
          if (next === "day" || next === "week") showCachedTimeline(next, date);
          setMode(next); setFilters([]); setReturnPeriod(null);
        }} />}
    </DiaryNavigation>
    <View className="page diary-content">
    {accountError && <Text className="error-text">{accountError}</Text>}
    {!context.hasBaby ? identityEnabled ? <IdentitySetup context={context} onComplete={identityUpdated} /> : <View className="state-panel"><Text className="section-title">还没有关联宝宝</Text><Text className="muted">请先在原宝宝日记中关联宝宝，再回来查看。</Text><Button className="text-button" onClick={() => { void restore(); }}>刷新</Button></View> : <>
      {identityEnabled && <SafetyNotices key={`${context.identityId}:${babyId}`} babyId={babyId} revision={revision + privacyCheck} />}
      {returnPeriod && <Button className="text-button period-back" onClick={() => {
        revealSummary();
        if (returnPeriod.mode === "day" || returnPeriod.mode === "week") showCachedTimeline(returnPeriod.mode, returnPeriod.date);
        setMode(returnPeriod.mode); setDate(returnPeriod.date); setFilters([]); setReturnPeriod(null);
      }}>‹ 返回{returnPeriod.mode === "week" ? "周历" : "月历"}</Button>}
      {dataError ? <View className="state-panel"><Text className="error-text">{dataError}</Text><Button className="text-button" onClick={() => setRevision((value) => value + 1)}>重试</Button></View>
        : !data ? <View className="state-panel">正在读取记录…</View> : <>
          {!data.complete && <View className="notice">记录数量达到读取上限，当前展示可能不完整。可切换到单日查看。</View>}
          {mode === "list" && <View className="daily-summary">
            <View className="section-heading"><Text className="section-title">当日汇总</Text><Text className="muted">{data.recordSummary?.coverage.recordedEvents ?? layoutDayTimeline(visible, date).length} 条记录</Text></View>
            <View className="stats-grid">{cards.map((card) => <View key={card.key} className={`stat-card ${filters.includes(card.key) ? "active" : ""}`} onClick={() => setFilters((old) => old.includes(card.key) ? old.filter((key) => key !== card.key) : [...old, card.key])}>
              <Text className="stat-label" style={{ color: card.color }}>{card.label}</Text><Text className="stat-value">{card.value}</Text>
            </View>)}</View>
            <View className="filter-caption"><Text>轻点上方卡片筛选记录</Text>{filters.length > 0 && <Text className="inline-action" onClick={() => setFilters([])}>显示全部</Text>}</View>
            {data.recordSummary && <View className="data-note">
              {data.recordSummary.metrics.diaperCount > 0 && <Text>尿布 {data.recordSummary.metrics.diaperCount} 次 · 明确有尿 {data.recordSummary.metrics.peeCount} 次 · 明确有便 {data.recordSummary.metrics.poopCount} 次。 </Text>}
              <Text>{coverageMessage(data.recordSummary.coverage) || "汇总仅包含已记录的事实。"}</Text>
            </View>}
          </View>}
          {mode === "day" && <>
            <CollapsibleDaySummary
              collapsed={summaryHidden}
              measurementKey={`${dataKey}:${filters.join(",")}`}
              onHeightChange={handleSummaryHeight}
            >
              <View className="daily-summary">
                <View className="section-heading"><Text className="section-title">当日汇总</Text><Text className="muted">{data.recordSummary?.coverage.recordedEvents ?? layoutDayTimeline(visible, date).length} 条记录</Text></View>
                <View className="stats-grid">{cards.map((card) => <View key={card.key} className={`stat-card ${filters.includes(card.key) ? "active" : ""}`} onClick={() => setFilters((old) => old.includes(card.key) ? old.filter((key) => key !== card.key) : [...old, card.key])}>
                  <Text className="stat-label" style={{ color: card.color }}>{card.label}</Text><Text className="stat-value">{card.value}</Text>
                </View>)}</View>
                <View className="filter-caption"><Text>轻点上方卡片筛选记录</Text>{filters.length > 0 && <Text className="inline-action" onClick={() => setFilters([])}>显示全部</Text>}</View>
                {data.recordSummary && <View className="data-note">
                  {data.recordSummary.metrics.diaperCount > 0 && <Text>尿布 {data.recordSummary.metrics.diaperCount} 次 · 明确有尿 {data.recordSummary.metrics.peeCount} 次 · 明确有便 {data.recordSummary.metrics.poopCount} 次。 </Text>}
                  <Text>{coverageMessage(data.recordSummary.coverage) || "汇总仅包含已记录的事实。"}</Text>
                </View>}
              </View>
              <PreviousEvening activities={data.evening} date={date} sidecar={identityEnabled} />
            </CollapsibleDaySummary>
            <DayTimeline latestActivities={data.latest} activities={visible} date={date} today={today}
              recordCoverage={data.recordSummary?.coverage}
              foldAvatarUrl={context.baby?.avatarUrl}
              scale={timeScale} onScaleChange={setTimeScale}
              gesturesDisabled={gesturesDisabled} gestureResetKey={`${babyId}:day:${date}`}
              onScrollIntent={handleScrollIntent}
              viewportExpansion={summaryHidden ? summaryHeight : 0}
              onActivityClick={(activity) => { void openDetail(activity); }}
              onNavigate={navigateTimeline} onNavigateReady={navigateTimelineReady} adjacentPages={adjacentPages} />
          </>}
          {mode === "week" && <WeekCalendar activities={data.activities} weekStart={weekStart} today={today}
            foldAvatarUrl={context.baby?.avatarUrl}
            scale={timeScale} onScaleChange={setTimeScale}
            gesturesDisabled={gesturesDisabled} gestureResetKey={`${babyId}:week:${date}`}
            onActivityClick={(activity) => { void openDetail(activity); }} onDateClick={openDay}
            onNavigate={navigateTimeline} onNavigateReady={navigateTimelineReady} adjacentPages={adjacentPages} />}
          {mode === "month" && (
            <Heatmap
              stats={data.stats}
              activities={data.activities}
              complete={data.complete}
              birthDate={data.birthDate}
              preferences={carePreferences?.babyId === babyId ? carePreferences.preferences : DEFAULT_CARE_PREFERENCES}
              preferencesError={carePreferences?.babyId === babyId ? carePreferences.error : ""}
              profileError={data.profileError}
              endDate={date}
              today={today}
              onDateClick={openDay}
            />
          )}
          {mode === "trend" && <TrendCharts stats={data.stats} days={days} endDate={date} onDaysChange={setDays} />}
          {(mode === "month" || mode === "trend") && (
            <View className="data-note">
              {mode === "month"
                ? "月环读取已保存统计和当月记录；缺少统计不代表当天没有记录。未知数值与未结束时长不当作零。"
                : identityEnabled
                  ? "按已保存记录统一计算。未知数值与未结束时长不当作零，疑似重复待核对期间不重复计入；暂无记录不代表实际没有发生。"
                  : "展示已保存的每日统计。缺少统计的日期不代表当天没有记录；刷新会重新读取已有统计。"}
            </View>
          )}
          {mode === "list" && <>
            <View className="section-heading"><Text className="section-title">{visible.length} 条记录</Text><Picker mode="selector" range={["按活动时间", "按创建时间", "按更新时间"]} value={["endTime", "createdAt", "updatedAt"].indexOf(sort)} onChange={(e) => setSort((["endTime", "createdAt", "updatedAt"] as const)[Number(e.detail.value)]!)}><Text className="inline-action">{{ endTime: "按活动时间", createdAt: "按创建时间", updatedAt: "按更新时间" }[sort]} ⌄</Text></Picker></View>
            {sortActivities(visible, sort).map((activity) => <View className="record-row" key={activity.id} onClick={() => { void openDetail(activity); }}>
              <Text className="record-time">{timeLabel(activity.startTime)}</Text><View className="record-copy"><Text className="record-title">{activityLabel(activity)}</Text>{activity.notes && <Text className="record-note">{activity.notes}</Text>}</View><Text className="record-chevron">›</Text>
            </View>)}
            {!visible.length && <View className="state-panel">这一天还没有{filters.length ? "符合筛选的" : ""}记录</View>}
          </>}
        </>}
      {identityEnabled && sync?.babyId === babyId && <View className="data-note sync-status"><Text className="section-title">采集同步</Text>{(sync.error ? [sync.error] : syncStatusLines(sync.jobs)).map(line => <View key={line}><Text>{line}</Text></View>)}</View>}
      {(detailBusy || detailError) && <View className="detail-notice"><Text>{detailBusy ? "正在读取详情…" : detailError}</Text><Text className="inline-action" onClick={closeDetail}>关闭</Text></View>}
      <ActivityDetail key={`${babyId}:${detail?.id ?? "none"}:${detailVersion.current}`} activity={detail} provenance={provenance}
        photoUrls={detailPhotos} photoCount={photoCount} recordEvent={detailEvent} photoLoading={photoLoading}
        onMoreInfoToggle={toggleMoreInfo} onRetryProvenance={() => { void fetchProvenance(); }} onClose={closeDetail}
        onChat={identityEnabled ? () => { if (!detail) return; setChatSelection({ eventId: detailEvent?.id || detail.id, label: `${timeLabel(detail.startTime)} ${activityLabel(detail)}`, nonce: Date.now() }); closeDetail(); } : undefined} />
      {!identityEnabled && <Text className="bubu-chat-legacy">旧服务兼容模式仅查看记录，程序内对话暂未开放。</Text>}
    </>}
    </View>
    {identityEnabled && context.identityId && context.baby && <DiaryChat key={`${context.identityId}:${babyId}`} identityId={context.identityId} babyId={babyId} babyName={context.baby.name} viewedDate={date} revision={revision} selection={chatSelection} onRefresh={refreshAfterChat} onRevoked={chatRevoked} />}
  </View>;
}

function PreviousEvening({ activities, date, sidecar = false }: { activities: Activity[]; date: string; sidecar?: boolean }) {
  const start = dayBounds(date).start;
  const { feeding, sleep } = previousEvening(activities, date);
  if (!feeding && !sleep) return null;
  return <View className="evening-card"><Text className="evening-heading">昨晚</Text>
    {feeding && <Text className="evening-line">{timeLabel(feeding.startTime)} · {activityLabel(feeding)}</Text>}
    {sleep && <Text className="evening-line">{timeLabel(sleep.startTime)} 入睡 · {sleep.endTime ? `${timestamp(sleep.endTime) >= start ? "今天 " : ""}${timeLabel(sleep.endTime)} 醒来，睡了 ${formatDuration(Math.max(0, Math.trunc((timestamp(sleep.endTime) - timestamp(sleep.startTime)) / 60000)))}` : sidecar ? "结束时间尚未确定" : "睡眠尚未结束"}</Text>}
  </View>;
}
