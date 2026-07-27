import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";
import type {
  BookingBatchDetailResponse,
  BookingBatchListResponse,
  BookingShareTarget,
  MealSlot,
  ServiceClosure
} from "@cfp/kith-inn-v1-shared";
import {
  applyBulkBookingStatus,
  batchCloseText,
  bookingBatchSharePayload,
  bookingBatchStatusText,
  bookingDetailRefreshDelay,
  bookingSlotLiveStatusText,
  bookingConfigContext,
  bookingDeadlineInputValue,
  bookingMenuUrl,
  bookingReturnMode,
  bookingShareSelection,
  bookingShareTargetText,
  bookingWeekDates,
  buildBookingConfig,
  copyBookingBatchPath,
  createBookingWriteGuard,
  effectiveServiceClosure,
  sortBookingBatchHistory,
  summarizeBookingBatch,
  toggleOperationalSelection,
  type BookingConfigContext
} from "@/logic/bookingBatches";
import { merchantRoute } from "@/logic/login";
import { ApiError, createApiClient, type RequestAdapter } from "@/services/api";
import { createSessionStore, type Storage } from "@/store/session";

const storage: Storage = {
  get: (key) => Taro.getStorageSync(key) || null,
  set: (key, value) => Taro.setStorageSync(key, value),
  remove: (key) => Taro.removeStorageSync(key)
};
const sessions = createSessionStore(storage);
const request: RequestAdapter = async (options) => {
  const response = await Taro.request(options);
  return { statusCode: response.statusCode, data: response.data };
};
const api = createApiClient({
  request,
  sessions,
  onAuthFailure: (status) => {
    const reason = status === 403 ? "?reason=membership-inactive" : "";
    void Taro.redirectTo({ url: `/pages/merchant/login/index${reason}` });
  }
});

const handledAuthFailure = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);
const occasionText = (occasion: MealSlot["occasion"]) => occasion === "lunch" ? "午餐" : "晚餐";
type BatchEntry = BookingBatchListResponse["docs"][number];
type SlotConfig = { priceYuan: string; orderDeadline: string };

const priceInputValue = (priceCents: number): string =>
  (priceCents / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");

function initialConfig(slot: MealSlot, defaultPriceCents?: number): SlotConfig {
  const priceCents = slot.priceCents ?? defaultPriceCents;
  return {
    priceYuan: priceCents === undefined ? "" : priceInputValue(priceCents),
    orderDeadline: bookingDeadlineInputValue(slot.orderDeadline)
  };
}

function WeappShareLifecycle() {
  Taro.useShareAppMessage(({ target }) => {
    const dataset = (target as { dataset?: { title?: unknown; path?: unknown } } | undefined)?.dataset;
    return bookingBatchSharePayload(dataset);
  });
  return null;
}

export default function MerchantBatches() {
  const [initialContext] = useState(() =>
    bookingConfigContext(Taro.getCurrentInstance().router?.params ?? {}));
  const [date, setDate] = useState(initialContext?.weekStart ?? "");
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [weekDays, setWeekDays] = useState<string[]>([]); const [closures, setClosures] = useState<ServiceClosure[]>([]);
  const [defaultPriceYuan, setDefaultPriceYuan] = useState(""); const [priceOverrides, setPriceOverrides] = useState<Set<string>>(() => new Set());
  const [configs, setConfigs] = useState<Record<string, SlotConfig>>({});
  const [selected, setSelected] = useState<Array<string | number>>([]);
  const [shareTarget, setShareTarget] = useState<BookingShareTarget | null>(() => initialContext?.target
    ? { kind: "meal", ...initialContext.target }
    : null);
  const [title, setTitle] = useState("");
  const [batches, setBatches] = useState<BatchEntry[]>([]);
  const [activeDetail, setActiveDetail] = useState<BookingBatchDetailResponse | null>(null);
  const [detailMode, setDetailMode] = useState<"created" | "history">("history");
  const [detailFailedId, setDetailFailedId] = useState<string | number | null>(null);
  const [closingId, setClosingId] = useState<string | number | null>(null);
  const [detailNow, setDetailNow] = useState(() => new Date().toISOString());
  const [pending, setPending] = useState<string | null>(initialContext ? null : "settings-load"); const [failures, setFailures] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false); const [loadFailed, setLoadFailed] = useState(false);
  const [settingsFailed, setSettingsFailed] = useState(false); const [closuresFailed, setClosuresFailed] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const loadRevision = useRef(0);
  const [writeGuard] = useState(createBookingWriteGuard);

  const loadBatches = async () => {
    setHistoryLoading(true);
    setHistoryFailed(false);
    try {
      setBatches(sortBookingBatchHistory(await api.listBookingBatches()));
    } catch (error) {
      if (!handledAuthFailure(error)) setHistoryFailed(true);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadSlots = async (context?: BookingConfigContext) => {
    const days = bookingWeekDates(context?.weekStart ?? date);
    if (days.length === 0) {
      await Taro.showToast({ title: "请输入工作周的周一日期", icon: "none" });
      return;
    }
    const revision = ++loadRevision.current;
    const range = { from: days[0]!, to: days.at(-1)! };
    setLoading(true);
    setLoadFailed(false);
    setSettingsFailed(false);
    setClosuresFailed(false);
    setSlots([]);
    setWeekDays(days);
    setClosures([]);
    setConfigs({});
    setPriceOverrides(new Set());
    setSelected([]);
    setShareTarget(context?.target ? { kind: "meal", ...context.target } : null);
    setFailures({});
    try {
      const [loadedSlots, settings, loadedClosures] = await Promise.allSettled([
        api.listMealSlots(range.from, range.to), api.getBookingSettings(), api.listServiceClosures(range.from, range.to)]);
      if (revision !== loadRevision.current) return;
      const authError = [loadedSlots, settings, loadedClosures].find((result) =>
        result.status === "rejected" && handledAuthFailure(result.reason));
      setClosures(loadedClosures.status === "fulfilled" ? loadedClosures.value : []); setClosuresFailed(loadedClosures.status === "rejected");
      if (authError || loadedSlots.status === "rejected") {
        if (!authError) {
          setLoadFailed(true);
          await Taro.showToast({ title: "餐次加载失败", icon: "none" });
        }
        return;
      }
      const docs = loadedSlots.value;
      const defaultPriceCents = settings.status === "fulfilled" ? settings.value.defaultPriceCents : undefined;
      setSlots(docs);
      setSettingsFailed(settings.status === "rejected");
      const defaultYuan = defaultPriceCents === undefined ? "" : priceInputValue(defaultPriceCents);
      setDefaultPriceYuan(defaultYuan);
      setConfigs(Object.fromEntries(docs.map((slot) => [String(slot.id), initialConfig(slot, defaultPriceCents)])));
    } catch (error) {
      if (revision !== loadRevision.current || handledAuthFailure(error)) return;
      setLoadFailed(true);
      await Taro.showToast({ title: "预订配置加载失败", icon: "none" });
      return;
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
      return;
    }
    if (initialContext) void loadSlots(initialContext);
    else {
      void api.getBookingSettings()
        .then(({ defaultPriceCents }) => setDefaultPriceYuan(priceInputValue(defaultPriceCents)))
        .catch((error: unknown) => { if (!handledAuthFailure(error)) setSettingsFailed(true); })
        .finally(() => setPending(null));
    }
    void loadBatches();
  }, []);

  useEffect(() => {
    if (!activeDetail) return;
    const delay = bookingDetailRefreshDelay(activeDetail.slots, new Date().toISOString());
    if (delay === null) return;
    const timer = setTimeout(() => setDetailNow(new Date().toISOString()), delay);
    return () => clearTimeout(timer);
  }, [activeDetail, detailNow]);

  useEffect(() => {
    if (!activeDetail) return;
    const timer = setTimeout(() => void Taro.pageScrollTo({ scrollTop: 0, duration: 0 }), 0);
    return () => clearTimeout(timer);
  }, [activeDetail?.doc.id]);

  const configure = (slot: MealSlot, orderStatus: "open" | "closed") => writeGuard.run(async () => {
    const config = configs[String(slot.id)] ?? initialConfig(slot);
    const input = orderStatus === "closed"
      ? { orderStatus } as const
      : buildBookingConfig({ ...config, orderStatus });
    if (!input || (orderStatus === "open" && (!("priceCents" in input) || input.priceCents == null ||
      !("orderDeadline" in input) || input.orderDeadline === null))) {
      await Taro.showToast({ title: "价格或截止时间无效", icon: "none" });
      return;
    }
    setPending(`slot:${slot.id}`);
    try {
      const doc = await api.updateMealSlotBookingConfig(slot.id, input);
      setSlots((current) => current.map((item) => String(item.id) === String(doc.id) ? doc : item));
      setFailures((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== String(doc.id))));
      if (doc.orderStatus !== "open") {
        setSelected((current) => current.filter((id) => String(id) !== String(doc.id)));
      }
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: error instanceof Error ? error.message : "配置失败", icon: "none" });
    } finally {
      setPending(null);
    }
  });

  const saveDefaultPrice = () => writeGuard.run(async () => {
    if (!/^\d+(?:\.\d{1,2})?$/.test(defaultPriceYuan.trim())) {
      await Taro.showToast({ title: "请输入有效默认价格", icon: "none" });
      return;
    }
    setPending("settings");
    try {
      const settings = await api.updateBookingSettings({ defaultPriceCents: Math.round(Number(defaultPriceYuan) * 100) });
      const nextDefault = priceInputValue(settings.defaultPriceCents);
      setConfigs((current) => Object.fromEntries(Object.entries(current).map(([id, config]) => {
        const slot = slots.find((item) => String(item.id) === id);
        return [id, slot?.orderStatus === "draft" && slot.priceCents === null && !priceOverrides.has(id)
          ? { ...config, priceYuan: nextDefault }
          : config];
      })));
      setDefaultPriceYuan(nextDefault);
      setSettingsFailed(false);
      await Taro.showToast({ title: "默认价格已保存", icon: "none" });
    } catch (error) {
      if (!handledAuthFailure(error)) await Taro.showToast({ title: "默认价格保存失败", icon: "none" });
    } finally {
      setPending(null);
    }
  });

  const bulkStatus = (action: "open" | "stop") => writeGuard.run(async () => {
    if (selected.length === 0) {
      await Taro.showToast({ title: "请先选择餐次", icon: "none" });
      return;
    }
    setPending(`bulk:${action}`);
    const localFailures: Record<string, string> = {};
    let targetIds = [...selected];
    let workingSlots = slots;
    try {
      if (action === "open") {
        const ready: Array<string | number> = [];
        for (const id of selected) {
          const current = slots.find((slot) => String(slot.id) === String(id));
          if (!current) continue;
          if (current.orderStatus === "open") { ready.push(id); continue; }
          const config = configs[String(id)] ?? initialConfig(current);
          const input = buildBookingConfig({ ...config, orderStatus: current.orderStatus });
          if (!input || input.priceCents === null || input.orderDeadline === null) {
            localFailures[String(id)] = "价格或截止时间无效";
            continue;
          }
          try {
            const saved = await api.updateMealSlotBookingConfig(id, input);
            workingSlots = workingSlots.map((item) => String(item.id) === String(id) ? saved : item);
            setSlots(workingSlots);
            ready.push(id);
          } catch (error) {
            if (handledAuthFailure(error)) throw error;
            localFailures[String(id)] = error instanceof Error ? error.message : "配置保存失败";
          }
        }
        targetIds = ready;
      }
      if (targetIds.length > 0) {
        const merged = applyBulkBookingStatus(workingSlots, await api.bulkUpdateMealSlotBookingStatus(targetIds, action));
        setSlots(merged.slots);
        Object.assign(localFailures, merged.failures);
      }
      const failedIds = selected.filter((id) => Object.hasOwn(localFailures, String(id)));
      setSelected(failedIds);
      setFailures(localFailures);
      await Taro.showToast({ title: failedIds.length ? `${failedIds.length} 个餐次未完成` :
        action === "open" ? "预订已开放" : "预订已停止", icon: "none" });
    } catch (error) {
      if (!handledAuthFailure(error)) await Taro.showToast({ title: "批量操作失败", icon: "none" });
    } finally {
      setPending(null);
    }
  });

  const reloadClosures = async () => {
    if (weekDays.length === 0) return; setPending("closures");
    try {
      setClosures(await api.listServiceClosures(weekDays[0]!, weekDays.at(-1)!)); setClosuresFailed(false);
    } catch (error) {
      if (!handledAuthFailure(error)) await Taro.showToast({ title: "打烊安排加载失败", icon: "none" });
    } finally { setPending(null); }
  };

  const toggleClosure = (
    date: string,
    occasion: MealSlot["occasion"] | null,
    closure?: ServiceClosure
  ) => writeGuard.run(async () => {
    setPending(`closure:${date}:${occasion ?? "day"}`);
    try {
      if (closure) {
        await api.deleteServiceClosure(closure.id);
        setClosures((items) => items.filter(({ id }) => String(id) !== String(closure.id)));
      } else {
        const doc = await api.createServiceClosure({ date, occasion, note: null });
        setClosures((items) => [...items, doc]);
      }
    } catch (error) {
      if (!handledAuthFailure(error)) await Taro.showToast({
        title: error instanceof Error ? error.message : "打烊设置失败", icon: "none" });
    } finally {
      setPending(null);
    }
  });

  const createBatch = () => writeGuard.run(async () => {
    const selection = shareTarget ? bookingShareSelection(shareTarget, slots, new Date().toISOString()) : null;
    if (!selection) {
      await Taro.showToast({ title: "请先选择仍在预订中的一天或一餐", icon: "none" });
      return;
    }
    setPending("create");
    try {
      const entry = await api.createBookingBatch({
        ...(title.trim() ? { title: title.trim() } : {}),
        ...selection
      });
      setBatches((current) => sortBookingBatchHistory([entry, ...current.filter(({ doc }) =>
        String(doc.id) !== String(entry.doc.id))]));
      setShareTarget(null);
      setTitle("");
      try {
        setActiveDetail(await api.getBookingBatch(entry.doc.id));
        setDetailNow(new Date().toISOString());
        setDetailMode("created");
        setDetailFailedId(null);
      } catch (error) {
        if (handledAuthFailure(error)) return;
        setDetailFailedId(entry.doc.id);
        await Taro.showToast({ title: "入口已创建，请重试实时详情", icon: "none" });
      }
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: error instanceof Error ? error.message : "创建失败", icon: "none" });
    } finally {
      setPending(null);
    }
  });

  const openDetail = async (id: string | number) => {
    setPending(`detail:${id}`);
    setDetailFailedId(null);
    try {
      setActiveDetail(await api.getBookingBatch(id));
      setClosingId(null);
      setDetailNow(new Date().toISOString());
      setDetailMode("history");
    } catch (error) {
      if (!handledAuthFailure(error)) setDetailFailedId(id);
    } finally {
      setPending(null);
    }
  };

  const copyShare = async (entry: BatchEntry) => {
    try {
      await copyBookingBatchPath(entry.share, (options) => Taro.setClipboardData(options));
      await Taro.showToast({ title: "入口已复制", icon: "none" });
    } catch {
      await Taro.showToast({ title: "复制失败，请重试", icon: "none" });
    }
  };

  const toggleSelection = async (id: string | number) => {
    const next = toggleOperationalSelection(selected, id);
    if (next.limitReached) {
      await Taro.showToast({ title: "单次最多选择 20 个餐次", icon: "none" });
      return;
    }
    setSelected(next.selected);
  };

  const closeBatch = (id: string | number) => writeGuard.run(async () => {
    setPending(`batch:${id}`);
    try {
      const entry = await api.closeBookingBatch(id);
      setActiveDetail((current) => current && String(current.doc.id) === String(id)
        ? { ...current, ...entry }
        : current);
      const applyClosedEntry = (current: BatchEntry[]) => sortBookingBatchHistory([
        entry,
        ...current.filter(({ doc }) => String(doc.id) !== String(entry.doc.id))
      ]);
      setBatches(applyClosedEntry);
      setClosingId(null);
      await loadBatches();
      setBatches(applyClosedEntry);
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: error instanceof Error ? error.message : "关闭失败", icon: "none" });
    } finally {
      setPending(null);
    }
  });

  const returnToMenu = () => {
    const mode = bookingReturnMode({
      hasContext: initialContext !== null,
      platform: process.env.TARO_ENV,
      pageCount: Taro.getCurrentPages().length
    });
    const menuUrl = initialContext?.source === "home" ? "/pages/merchant/home/index" :
      initialContext ? bookingMenuUrl(initialContext) : "/pages/merchant/menu/index";
    if (mode === "navigate-to") {
      void Taro.navigateTo({ url: menuUrl });
    } else if (mode === "redirect-to") {
      void Taro.redirectTo({ url: menuUrl });
    } else {
      void Taro.navigateBack();
    }
  };

  const shareSelection = shareTarget
    ? bookingShareSelection(shareTarget, slots, new Date().toISOString())
    : null;
  const detailSummary = activeDetail ? summarizeBookingBatch(activeDetail.slots) : null;
  const sellerName = sessions.getSession()?.sellerName ?? "街坊味商家";

  return (
    <View className="page batches-page batches-shell">
      {process.env.TARO_ENV === "weapp" && <WeappShareLifecycle />}
      <View className="batches-topbar">
        <Text className="title batches-title">分享预订</Text>
        <Button className="batches-back-button" onClick={returnToMenu}>{initialContext?.source === "home"
          ? "返回今日" : initialContext ? "返回菜单" : "菜单"}</Button>
      </View>

      {activeDetail && detailSummary && (
        <View className="share-success-state">
          <View className="share-success-heading">
            <Text className="share-success-icon">✓</Text>
            <Text className="section-title">{detailMode === "created" && activeDetail.doc.status === "open"
              ? "预订已开放"
              : bookingBatchStatusText(activeDetail.doc.status)}</Text>
            <Text>{detailMode === "created" && activeDetail.doc.status === "open"
              ? "现在可以发给街坊了"
              : "以下为当前实时餐次信息"}</Text>
          </View>
          <View className="card share-preview-card">
            <Text className="meta">{sellerName}</Text>
            <Text className="section-title">{activeDetail.share.title}</Text>
            <Text>{bookingShareTargetText(activeDetail.doc.target)}</Text>
            <Text>{detailSummary.dateText} · {detailSummary.slotCountText} · {detailSummary.priceText}</Text>
          </View>
          <View className="card share-detail-card">
            <Text className="section-title">已选择的餐次</Text>
            <Text className="meta">{detailSummary.slotCountText}</Text>
            {activeDetail.slots.map((slot, index) => (
              <View className="share-detail-slot" key={String(slot.id)}>
                <Text>{detailSummary.deadlineLines[index]}</Text>
                <Text className="meta">{bookingSlotLiveStatusText(slot, detailNow)}</Text>
              </View>
            ))}
          </View>
          <View className="share-action-stack">
            {process.env.TARO_ENV === "weapp" && (
              <Button className="primary" openType="share" data-title={activeDetail.share.title}
                data-path={activeDetail.share.path}>分享给街坊</Button>
            )}
            <Button className="share-copy-button" aria-label="复制入口" disabled={pending !== null}
              onClick={() => void copyShare(activeDetail)}>复制入口</Button>
            {activeDetail.doc.status === "open" && closingId === null && (
              <Button className="danger share-stop-button" aria-label="停用分享入口"
                disabled={pending !== null} onClick={() => setClosingId(activeDetail.doc.id)}>停用入口</Button>
            )}
          </View>
          {String(closingId) === String(activeDetail.doc.id) && (
            <View className="card close-confirmation">
              <Text>{batchCloseText(activeDetail.doc)}</Text>
              <Button className="danger" disabled={pending !== null} onClick={() => void closeBatch(activeDetail.doc.id)}>{
                pending === `batch:${activeDetail.doc.id}` ? "停用中…" : "确认停用入口"}</Button>
              <Button disabled={pending !== null} onClick={() => setClosingId(null)}>取消</Button>
            </View>
          )}
          <Text className="meta share-privacy-note">分享卡片只负责定位；顾客看到的是商家当前开放的实时餐次。</Text>
          <Button className="share-return-button" disabled={pending !== null}
            onClick={() => { setActiveDetail(null); setClosingId(null); }}>返回经营设置</Button>
        </View>
      )}

      {!activeDetail && <View className="batches-operations">
      {loading && <View className="card"><Text>正在加载本周经营安排…</Text></View>}
      {loadFailed && (
        <View className="card error-card">
          <Text>经营安排加载失败</Text><Button disabled={loading} onClick={() => void loadSlots()}>重试</Button>
        </View>
      )}

      <View className="card booking-settings-card">
        <Text className="section-title">默认套餐价</Text>
        <Text className="meta">新餐次开放时会采用此价格，每一餐仍可单独修改。</Text>
        {settingsFailed && <Text className="operation-error">默认价格加载失败，可重新填写并保存。</Text>}
        <Input aria-label="默认套餐价（元）" disabled={pending !== null || loading} placeholder="例如 30"
          value={defaultPriceYuan} onInput={(event) => setDefaultPriceYuan(event.detail.value)} />
        <Button disabled={pending !== null || loading} onClick={() => void saveDefaultPrice()}>{
          pending === "settings" ? "保存中…" : "保存默认价格"}</Button>
      </View>

      {closuresFailed && (
        <View className="card error-card">
          <Text>打烊安排加载失败；餐次仍可配置或停止，重试后再设置打烊。</Text><Button
            disabled={loading || pending !== null} onClick={() => void reloadClosures()}>重试打烊安排</Button>
        </View>
      )}

      <View className="card batch-controls">
        <Input
          disabled={loading || pending !== null}
          placeholder="批次起始日期"
          value={date}
          onInput={(event) => setDate(event.detail.value)}
        />
        <Button disabled={loading || pending !== null} onClick={() => void loadSlots()}>查看餐次</Button>
      </View>

      {weekDays.map((day) => {
        const dayClosure = closures.find((closure) => closure.date === day && closure.occasion === null);
        const mealClosures = closures.filter((closure) => closure.date === day && closure.occasion !== null);
        const dayTarget = { kind: "day" as const, date: day };
        const canShareDay = bookingShareSelection(dayTarget, slots, new Date().toISOString()) !== null;
        const sharingDay = shareTarget?.kind === "day" && shareTarget.date === day;
        return (
          <View className="day-operation" key={day}>
            <Text className="day-operation-date">{day}</Text>
            <View className="day-operation-actions">
              <Button
                className={dayClosure ? "selected" : "secondary"}
                disabled={pending !== null || loading || closuresFailed || (!dayClosure && mealClosures.length > 0)}
                onClick={() => void toggleClosure(day, null, dayClosure)}
              >{dayClosure ? "取消整天打烊" : "整天打烊"}</Button>
              {dayClosure === undefined && (["lunch", "dinner"] as const).map((occasion) => {
                const closure = mealClosures.find((item) => item.occasion === occasion);
                return <Button
                  key={occasion}
                  className={closure ? "selected" : "secondary"}
                  disabled={pending !== null || loading || closuresFailed}
                  onClick={() => void toggleClosure(day, occasion, closure)}
                >{closure ? `取消${occasionText(occasion)}打烊` : `${occasionText(occasion)}打烊`}</Button>;
              })}
              <Button className={sharingDay ? "selected" : "secondary"}
                disabled={pending !== null || loading || !canShareDay}
                onClick={() => setShareTarget(dayTarget)}>{sharingDay ? "已选当天" : "分享这一天"}</Button>
            </View>
          </View>
        );
      })}

      {slots.length === 0 && !loading && !loadFailed && date !== "" && (
        <View className="card"><Text>本周还没有已生成的餐次，请先到菜单页生成菜单。</Text></View>
      )}

      {slots.map((slot) => {
        const config = configs[String(slot.id)] ?? initialConfig(slot);
        const label = `${slot.date} ${occasionText(slot.occasion)}`;
        const isTarget = initialContext?.target?.date === slot.date &&
          initialContext.target.occasion === slot.occasion;
        const isSelected = selected.some((id) => String(id) === String(slot.id));
        const closure = effectiveServiceClosure(closures, slot.date, slot.occasion);
        const mealTarget = { kind: "meal" as const, date: slot.date, occasion: slot.occasion };
        const canShareMeal = bookingShareSelection(mealTarget, slots, new Date().toISOString()) !== null;
        const sharingMeal = shareTarget?.kind === "meal" && shareTarget.date === slot.date &&
          shareTarget.occasion === slot.occasion;
        return (
          <View className={`card batch-slot${isTarget ? " target" : ""}`} key={String(slot.id)}>
            <Text className="section-title">{label}</Text>
            {isTarget && <Text className="notice">当前餐次</Text>}
            <Text className={`meta batch-slot-status ${slot.orderStatus}`}>状态：{
              slot.orderStatus === "open" ? "开放" : slot.orderStatus === "closed" ? "已关闭" : "草稿"}</Text>
            {closure && <Text className="closure-notice">{closure.occasion === null ? "当天打烊" : "本餐打烊"}</Text>}
            <Input
              disabled={pending !== null || loading || slot.orderStatus === "open"}
              placeholder="价格（元）"
              value={config.priceYuan}
              onInput={(event) => {
                setPriceOverrides((current) => new Set(current).add(String(slot.id)));
                setConfigs((current) => ({
                  ...current,
                  [String(slot.id)]: { ...config, priceYuan: event.detail.value }
                }));
              }}
            />
            <Input
              disabled={pending !== null || loading || slot.orderStatus === "open"}
              placeholder="截止时间"
              value={config.orderDeadline}
              onInput={(event) => setConfigs((current) => ({
                ...current,
                [String(slot.id)]: { ...config, orderDeadline: event.detail.value }
              }))}
            />
            <View className="batch-actions">
              {slot.orderStatus !== "open" && (
                <Button className="primary" disabled={pending !== null || loading || Boolean(closure)} onClick={() => void configure(slot, "open")}>开放预订</Button>
              )}
              {slot.orderStatus === "open" && (
                <Button className="danger" disabled={pending !== null || loading} onClick={() => void configure(slot, "closed")}>停止预订</Button>
              )}
              <Button
                className={isSelected ? "selected" : ""}
                aria-label={`选择 ${label}`}
                disabled={pending !== null || loading}
                onClick={() => void toggleSelection(slot.id)}
              >{isSelected ? "已选择" : "选择餐次"}</Button>
              <Button className={sharingMeal ? "selected" : "secondary"}
                disabled={pending !== null || loading || !canShareMeal}
                onClick={() => setShareTarget(mealTarget)}>{sharingMeal ? "已选本餐" : "分享这一餐"}</Button>
            </View>
            {failures[String(slot.id)] && <Text className="operation-error">{failures[String(slot.id)]}</Text>}
          </View>
        );
      })}

      {slots.length > 0 && (
        <View className="card bulk-operation-card">
          <Text className="section-title">批量操作</Text>
          <Text className="meta">已选择 {selected.length} 个餐次，单次最多 20 个。</Text>
          <View className="batch-actions">
            <Button className="primary" disabled={pending !== null || loading || selected.length === 0} onClick={() => void bulkStatus("open")}>{
              pending === "bulk:open" ? "开放中…" : "批量开放"}</Button>
            <Button className="danger" disabled={pending !== null || loading || selected.length === 0} onClick={() => void bulkStatus("stop")}>{
              pending === "bulk:stop" ? "停止中…" : "批量停止"}</Button>
          </View>
        </View>
      )}

      <View className="card batch-create">
        <Text className="section-title">分享预订</Text>
        <Text className="meta">先在上方选择“分享这一天”或“分享这一餐”。</Text>
        <Input disabled={pending !== null || loading} placeholder="分享标题（可不填）" value={title} onInput={(event) => setTitle(event.detail.value)} />
        <Text>{shareTarget ? bookingShareTargetText(shareTarget) : "尚未选择分享目标"}</Text>
        <Text className="meta">{shareSelection ? `将定位 ${shareSelection.mealSlotIds.length} 个正在预订的餐次` : "只有仍在预订中的餐次可以生成入口"}</Text>
        <Button className="primary" disabled={pending !== null || loading} onClick={() => void createBatch()}>{
          pending === "create" ? "生成中…" : "生成分享卡片"}</Button>
      </View>
      </View>}

      <View className="booking-history">
        <View className="booking-history-heading">
          <Text className="section-title">分享历史</Text>
          <Text className="meta">按状态整理 · 点击查看实时详情</Text>
        </View>
        {historyLoading && <View className="card"><Text>正在加载分享历史…</Text></View>}
        {historyFailed && <View className="card error-card"><Text>分享历史加载失败</Text>
          <Button disabled={pending !== null} onClick={() => void loadBatches()}>重试历史</Button></View>}
        {!historyLoading && !historyFailed && batches.length === 0 && <View className="card"><Text>还没有分享入口</Text></View>}
        {detailFailedId !== null && <View className="card error-card"><Text>实时详情加载失败</Text>
          <Button disabled={pending !== null} onClick={() => void openDetail(detailFailedId)}>重试详情</Button></View>}
        {batches.map((entry) => (
          <View className="card batch-card compact" key={String(entry.doc.id)}>
            <Text className="section-title">{entry.share.title}</Text>
            <Text>{bookingShareTargetText(entry.doc.target)}</Text>
            <Text className="meta">{bookingBatchStatusText(entry.doc.status)}</Text>
            <Button aria-label={`查看 ${entry.share.title} 详情`} disabled={pending !== null}
              onClick={() => void openDetail(entry.doc.id)}>{pending === `detail:${entry.doc.id}` ? "加载中…" : "查看详情"}</Button>
          </View>
        ))}
      </View>
    </View>
  );
}
