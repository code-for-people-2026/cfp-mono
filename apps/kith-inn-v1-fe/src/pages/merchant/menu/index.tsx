import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MealSlot, MealSlotTarget, Occasion, RelaxedRule } from "@cfp/kith-inn-v1-shared";
import { MerchantNav } from "@/components/MerchantNav";
import {
  buildSingleTarget,
  buildMenuRange,
  buildWorkWeekTargets,
  generationErrorText,
  needsReplaceConfirmation,
  relaxedRulesText,
  replaceMealSlot
} from "@/logic/menu";
import {
  buildMenuWeek,
  formatWeekRange,
  initialWeekStart,
  nextOpenDeadline,
  shiftWeekStart,
  weekCta,
  type MealPosition
} from "@/logic/menuWeek";
import { merchantRoute } from "@/logic/login";
import { jielongImportEnabled } from "@/logic/jielongImport";
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
const occasionText = (occasion: Occasion) => occasion === "lunch" ? "午餐" : "晚餐";
const mergeSlots = (current: MealSlot[], docs: MealSlot[]) => docs.reduce(replaceMealSlot, current);
let rememberedView: { weekStart: string; selectedDate: string } | null = null;

function weekStart(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function deadlineText(value: string | null): string {
  if (!value) return "未设置截止时间";
  return `${new Date(Date.parse(value) + 8 * 60 * 60 * 1_000).toISOString().slice(11, 16)} 截止`;
}

function priceText(value: number | null): string {
  return value === null ? "商家默认价" : `¥${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)} / 份`;
}

function WeappMenuLifecycle({ onReturn }: { onReturn: () => void }) {
  const hasShown = useRef(false);
  Taro.useDidShow(() => {
    if (hasShown.current) onReturn();
    else hasShown.current = true;
  });
  return null;
}

export default function MerchantMenu() {
  const initialView = useRef(rememberedView).current;
  const firstWeek = useRef(initialView?.weekStart ?? initialWeekStart(new Date())).current;
  const weekStartRef = useRef(firstWeek);
  const loadRevision = useRef(0);
  const mutationRevision = useRef(0);
  const [currentWeek, setCurrentWeek] = useState(firstWeek);
  const [selectedDate, setSelectedDate] = useState(() =>
    initialView?.selectedDate ?? buildMenuWeek(firstWeek, [], new Date()).selectedDate);
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [date, setDate] = useState("");
  const [legacySlots, setLegacySlots] = useState<MealSlot[]>([]);
  const [relaxed, setRelaxed] = useState<RelaxedRule[]>([]);
  const [pendingTargets, setPendingTargets] = useState<MealSlotTarget[] | null>(null);

  const week = useMemo(() =>
    buildMenuWeek(currentWeek, slots, new Date(clockNow), selectedDate),
  [clockNow, currentWeek, selectedDate, slots]);
  const selectedDay = week.days.find((day) => day.date === week.selectedDate) ?? week.days[0]!;
  const primaryCta = weekCta(week);

  const loadWeek = async (targetWeek: string, preserveData: boolean) => {
    const revision = ++loadRevision.current;
    const preserving = preserveData && loadState === "loaded";
    setRefreshFailed(false);
    if (preserving) setRefreshing(true);
    else setLoadState("loading");
    try {
      const docs = await api.listMealSlots(targetWeek, buildMenuWeek(targetWeek, [], new Date()).end);
      if (revision !== loadRevision.current || targetWeek !== weekStartRef.current) return;
      setSlots(docs);
      setLoadState("loaded");
      setClockNow(Date.now());
    } catch (error) {
      if (revision !== loadRevision.current || targetWeek !== weekStartRef.current || handledAuthFailure(error)) return;
      if (preserving) setRefreshFailed(true);
      else setLoadState("error");
    } finally {
      if (revision === loadRevision.current && targetWeek === weekStartRef.current) setRefreshing(false);
    }
  };

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
      return;
    }
    void loadWeek(firstWeek, false);
    return () => {
      loadRevision.current += 1;
      mutationRevision.current += 1;
    };
  }, []);

  useEffect(() => {
    const deadline = nextOpenDeadline(week, new Date(clockNow));
    if (deadline === null) return;
    const delay = Math.min(Math.max(0, deadline - Date.now()), 2_147_483_647);
    const timer = setTimeout(() => setClockNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [clockNow, week]);

  const changeWeek = (amount: number) => {
    const target = shiftWeekStart(weekStartRef.current, amount);
    const targetDate = buildMenuWeek(target, [], new Date()).selectedDate;
    weekStartRef.current = target;
    mutationRevision.current += 1;
    rememberedView = { weekStart: target, selectedDate: targetDate };
    setCurrentWeek(target);
    setSelectedDate(targetDate);
    setSlots([]);
    setPendingTargets(null);
    void loadWeek(target, false);
  };

  const loadLegacy = async () => {
    const range = buildMenuRange(date);
    if (!range) {
      await Taro.showToast({ title: "请输入有效日期", icon: "none" });
      return;
    }
    try {
      setLegacySlots(await api.listMealSlots(range.from, range.to));
    } catch (error) {
      if (!handledAuthFailure(error)) await Taro.showToast({ title: "菜单加载失败", icon: "none" });
    }
  };

  const generate = async (targets: MealSlotTarget[], replaceExisting = false) => {
    if (targets.length === 0) {
      await Taro.showToast({ title: "请输入有效日期", icon: "none" });
      return;
    }
    const revision = mutationRevision.current;
    loadRevision.current += 1;
    setRefreshing(false);
    setRefreshFailed(false);
    try {
      const result = await api.generateMenus({ targets, replaceExisting });
      if (revision !== mutationRevision.current) return;
      loadRevision.current += 1;
      setSlots((current) => mergeSlots(current, result.docs));
      setLegacySlots((current) => mergeSlots(current, result.docs));
      setRelaxed(result.relaxedRules);
      setPendingTargets(null);
    } catch (error) {
      if (revision !== mutationRevision.current) return;
      if (needsReplaceConfirmation(error)) {
        setPendingTargets(targets);
        return;
      }
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: generationErrorText(error), icon: "none" });
    }
  };

  const swap = async (slot: MealSlot, offeringId: string | number) => {
    const revision = mutationRevision.current;
    loadRevision.current += 1;
    setRefreshing(false);
    setRefreshFailed(false);
    try {
      const result = await api.swapMenuItem(slot.id, offeringId);
      if (revision !== mutationRevision.current) return;
      loadRevision.current += 1;
      setSlots((current) => replaceMealSlot(current, result.doc));
      setLegacySlots((current) => replaceMealSlot(current, result.doc));
      setRelaxed(result.relaxedRules);
    } catch (error) {
      if (revision !== mutationRevision.current) return;
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: error instanceof Error ? error.message : "换菜失败", icon: "none" });
    }
  };

  const mealCard = (meal: MealPosition) => (
    <View className={`card menu-meal-card ${meal.status}`} key={meal.occasion}>
      <View className="menu-meal-heading">
        <Text className="section-title">
          {occasionText(meal.occasion)}{meal.slot ? " · 4菜1汤" : ""}
        </Text>
        <Text className="menu-status">{meal.statusLabel}</Text>
      </View>
      {meal.slot ? (
        <>
          <Text className="menu-meal-names">
            {meal.slot.menuItems.map(({ nameSnapshot }) => nameSnapshot).join(" · ")}
          </Text>
          <View className="menu-meal-meta">
            <Text>{priceText(meal.slot.priceCents)}</Text>
            <Text>{deadlineText(meal.slot.orderDeadline)}</Text>
          </View>
        </>
      ) : <Text className="meta">这个餐次还没有安排菜单</Text>}
    </View>
  );

  return (
    <View className="page menu-page">
      {process.env.TARO_ENV === "weapp" && (
        <WeappMenuLifecycle onReturn={() => {
          if (merchantRoute(sessions.getSession()) !== "login") void loadWeek(weekStartRef.current, true);
        }} />
      )}
      <View className="menu-heading">
        <Text className="title">本周菜单</Text>
        <Button size="mini" onClick={() => void loadWeek(currentWeek, true)}>刷新</Button>
      </View>
      <View className="menu-week-heading">
        <Button aria-label="上一周" size="mini" onClick={() => changeWeek(-1)}>‹</Button>
        <View>
          <Text className="section-title">{formatWeekRange(currentWeek)}</Text>
          <Text className="subtitle">先排菜，再统一开放预订</Text>
        </View>
        <Button aria-label="下一周" size="mini" onClick={() => changeWeek(1)}>›</Button>
      </View>

      {loadState === "loading" && <View className="card page-state"><Text>正在加载工作周菜单</Text></View>}
      {loadState === "error" && (
        <View className="card page-state">
          <Text>菜单加载失败</Text>
          <Button className="primary" onClick={() => void loadWeek(currentWeek, false)}>重试</Button>
        </View>
      )}
      {loadState === "loaded" && (
        <>
          {refreshing && <Text className="notice">正在刷新菜单</Text>}
          {refreshFailed && <Text className="notice">刷新失败，当前菜单仍可查看</Text>}
          <View className="menu-days">
            {week.days.map((day) => (
              <Button
                className={`menu-day ${day.date === week.selectedDate ? "selected" : ""}`}
                data-completion={day.menuCompletion}
                data-open={day.bookingSignals.hasOpen ? "true" : "false"}
                data-deadline-passed={day.bookingSignals.hasDeadlinePassed ? "true" : "false"}
                key={day.date}
                onClick={() => {
                  rememberedView = { weekStart: currentWeek, selectedDate: day.date };
                  setSelectedDate(day.date);
                }}
              >
                <Text>{day.weekday}</Text>
                <Text>{Number(day.date.slice(-2))}</Text>
              </Button>
            ))}
          </View>
          <Text className="menu-selected-date">{selectedDay.date}</Text>
          {mealCard(selectedDay.lunch)}
          {mealCard(selectedDay.dinner)}
          <Text className="menu-primary-preview">{primaryCta.label}</Text>
        </>
      )}

      <Button onClick={() => void Taro.navigateTo({ url: "/pages/merchant/batches/index" })}>预订批次</Button>
      {jielongImportEnabled(process.env.KITH_INN_V1_ENABLE_JIELONG_IMPORT) && (
        <View className="card fallback-entry">
          <Text className="meta">仅在顾客预订登记无法上线时使用</Text>
          <Button onClick={() => void Taro.navigateTo({ url: "/pages/merchant/jielong-import/index" })}>
            接龙导入（兜底）
          </Button>
        </View>
      )}

      <View className="card menu-controls">
        <Text className="section-title">兼容菜单操作</Text>
        <Input
          aria-label="菜单起始日期"
          placeholder="菜单起始日期"
          value={date}
          onInput={(event) => {
            setDate(event.detail.value);
            setPendingTargets(null);
          }}
        />
        <Button onClick={() => void loadLegacy()}>查看未来 31 天菜单</Button>
        <Button disabled={loadState !== "loaded"} className="primary"
          onClick={() => void generate(buildSingleTarget(date, "lunch"))}>生成午餐</Button>
        <Button disabled={loadState !== "loaded"}
          onClick={() => void generate(buildSingleTarget(date, "dinner"))}>生成晚餐</Button>
        <Button disabled={loadState !== "loaded"}
          onClick={() => void generate(buildWorkWeekTargets(date, ["lunch", "dinner"]))}>
          生成工作周午晚餐
        </Button>
        {pendingTargets && (
          <Button disabled={loadState !== "loaded"} className="danger" onClick={() => void generate(pendingTargets, true)}>
            确认覆盖已有菜单
          </Button>
        )}
      </View>

      {relaxedRulesText(relaxed) && <Text className="notice">{relaxedRulesText(relaxed)}</Text>}
      {legacySlots.map((slot) => (
        <View className="card menu-slot" key={String(slot.id)} data-date={slot.date} data-week={weekStart(slot.date)}>
          <Text className="section-title">{slot.date} {occasionText(slot.occasion)}</Text>
          {slot.menuItems.map((item) => (
            <View className="menu-item" key={String(item.offeringId)}>
              <View className="menu-item-copy">
                <Text className="menu-item-name">{item.nameSnapshot}</Text>
                <Text className="menu-item-main">{item.mainIngredientSnapshot ?? ""}</Text>
              </View>
              <Button
                size="mini"
                aria-label={`换掉 ${item.nameSnapshot}`}
                onClick={() => void swap(slot, item.offeringId)}
              >换菜</Button>
            </View>
          ))}
        </View>
      ))}
      <MerchantNav active="menu" />
    </View>
  );
}
