import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import {
  Component,
  createRef,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import type { MealSlot, MealSlotTarget, Occasion, RelaxedRule } from "@cfp/kith-inn-v1-shared";
import { MerchantNav } from "@/components/MerchantNav";
import { bookingConfigContext, bookingConfigUrl } from "@/logic/bookingBatches";
import {
  generationErrorText,
  needsReplaceConfirmation,
  relaxedRulesText,
  replaceMealSlot
} from "@/logic/menu";
import {
  buildMenuWeek,
  editableTargets,
  formatWeekRange,
  initialWeekStart,
  missingTargets,
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
const targetKey = ({ date, occasion }: MealSlotTarget) => `${date}:${occasion}`;
const targetText = ({ date, occasion }: MealSlotTarget) => `${date} ${occasionText(occasion)}`;
const targetsOverlap = (left: MealSlotTarget[], right: MealSlotTarget[]) => {
  const rightKeys = new Set(right.map(targetKey));
  return left.some((target) => rightKeys.has(targetKey(target)));
};
let rememberedView: { weekStart: string; selectedDate: string } | null = null;

function deadlineText(value: string | null): string {
  if (!value) return "未设置截止时间";
  return `${new Date(Date.parse(value) + 8 * 60 * 60 * 1_000).toISOString().slice(11, 16)} 截止`;
}

function priceText(value: number | null): string {
  return value === null ? "商家默认价" : `¥${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)} / 份`;
}

type MenuPageHandle = { refresh: () => void };
type GenerationContext = {
  contextRevision: number;
  revisions: Map<string, number>;
  targetKeys: string[];
  weekStart: string;
};
type ReplaceConfirmation = {
  existingTargets: MealSlotTarget[];
  originalTargets: MealSlotTarget[];
};
type SwapFeedback = {
  issue: string | null;
  relaxedRules: RelaxedRule[];
};

function existingTargetsFrom(error: unknown): MealSlotTarget[] {
  if (!(error instanceof ApiError) || error.code !== "meal-slots-exist" ||
    typeof error.data !== "object" || error.data === null || !("existingTargets" in error.data) ||
    !Array.isArray(error.data.existingTargets)) return [];
  return error.data.existingTargets.flatMap((value) => {
    if (typeof value !== "object" || value === null) return [];
    const target = value as Record<string, unknown>;
    return typeof target.date === "string" && (target.occasion === "lunch" || target.occasion === "dinner")
      ? [{ date: target.date, occasion: target.occasion }]
      : [];
  });
}

const MerchantMenuView = forwardRef<MenuPageHandle>(function MerchantMenuView(_props, pageRef) {
  const routeContext = useRef(bookingConfigContext(Taro.getCurrentInstance().router?.params ?? {})).current;
  const initialView = useRef(routeContext
    ? {
      weekStart: routeContext.weekStart,
      selectedDate: routeContext.target?.date ??
        (rememberedView?.weekStart === routeContext.weekStart ? rememberedView.selectedDate : routeContext.weekStart)
    }
    : rememberedView).current;
  const firstWeek = useRef(initialView?.weekStart ?? initialWeekStart(new Date())).current;
  const firstSelectedDate = useRef(initialView?.selectedDate ??
    buildMenuWeek(firstWeek, [], new Date()).selectedDate).current;
  const initializedRememberedView = useRef(false);
  if (!initializedRememberedView.current) {
    rememberedView = { weekStart: firstWeek, selectedDate: firstSelectedDate };
    initializedRememberedView.current = true;
  }
  const weekStartRef = useRef(firstWeek);
  const loadRevision = useRef(0);
  const contextRevision = useRef(0);
  const viewRevision = useRef(0);
  const targetRevisions = useRef(new Map<string, number>());
  const pendingTargetKeysRef = useRef<string[]>([]);
  const pendingSwapTargetKeysRef = useRef<string[]>([]);
  const refreshAfterMutation = useRef(false);
  const [currentWeek, setCurrentWeek] = useState(firstWeek);
  const [selectedDate, setSelectedDate] = useState(firstSelectedDate);
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [relaxed, setRelaxed] = useState<RelaxedRule[]>([]);
  const [pendingTargetKeys, setPendingTargetKeys] = useState<string[]>([]);
  const [pendingSwapTargetKeys, setPendingSwapTargetKeys] = useState<string[]>([]);
  const [replaceConfirmations, setReplaceConfirmations] = useState<ReplaceConfirmation[]>([]);
  const [generationIssue, setGenerationIssue] = useState<string | null>(null);
  const [partialSaveNotice, setPartialSaveNotice] = useState(false);
  const [swapSelection, setSwapSelection] = useState<MealSlot | null>(null);
  const [swapFeedback, setSwapFeedback] = useState<Record<string, SwapFeedback>>({});

  const week = useMemo(() =>
    buildMenuWeek(currentWeek, slots, new Date(clockNow), selectedDate),
  [clockNow, currentWeek, selectedDate, slots]);
  const selectedDay = week.days.find((day) => day.date === week.selectedDate) ?? week.days[0]!;
  const primaryCta = weekCta(week);
  const weekMissingTargets = missingTargets(week);
  const weekEditableTargets = editableTargets(week);
  const replaceConfirmation = replaceConfirmations[0] ?? null;
  const hasOpenBookings = slots.some(({ orderStatus }) => orderStatus === "open");
  const primaryGeneratesMenus = primaryCta.kind === "generate-week" || primaryCta.kind === "fill-week";

  const loadWeek = async (targetWeek: string, preserveData: boolean) => {
    const revision = ++loadRevision.current;
    const capturedViewRevision = viewRevision.current;
    const preserving = preserveData && loadState === "loaded";
    setRefreshFailed(false);
    if (preserving) setRefreshing(true);
    else setLoadState("loading");
    try {
      const docs = await api.listMealSlots(targetWeek, buildMenuWeek(targetWeek, [], new Date()).end);
      if (revision !== loadRevision.current || targetWeek !== weekStartRef.current ||
        capturedViewRevision !== viewRevision.current) return;
      setSlots(docs);
      setLoadState("loaded");
      setClockNow(Date.now());
      setReplaceConfirmations([]);
      setSwapSelection(null);
      setSwapFeedback({});
    } catch (error) {
      if (revision !== loadRevision.current || targetWeek !== weekStartRef.current ||
        capturedViewRevision !== viewRevision.current || handledAuthFailure(error)) return;
      if (preserving) setRefreshFailed(true);
      else setLoadState("error");
    } finally {
      if (revision === loadRevision.current && targetWeek === weekStartRef.current &&
        capturedViewRevision === viewRevision.current) setRefreshing(false);
    }
  };

  const requestWeekRefresh = () => {
    if (merchantRoute(sessions.getSession()) === "login") return;
    if (pendingTargetKeysRef.current.length > 0 || pendingSwapTargetKeysRef.current.length > 0) {
      refreshAfterMutation.current = true;
      return;
    }
    void loadWeek(weekStartRef.current, true);
  };

  useImperativeHandle(pageRef, () => ({
    refresh: requestWeekRefresh
  }));

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
      return;
    }
    void loadWeek(firstWeek, false);
    return () => {
      loadRevision.current += 1;
      contextRevision.current += 1;
      viewRevision.current += 1;
      refreshAfterMutation.current = false;
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
    contextRevision.current += 1;
    viewRevision.current += 1;
    targetRevisions.current.forEach((revision, key) => targetRevisions.current.set(key, revision + 1));
    rememberedView = { weekStart: target, selectedDate: targetDate };
    setCurrentWeek(target);
    setSelectedDate(targetDate);
    setSlots([]);
    pendingTargetKeysRef.current = [];
    pendingSwapTargetKeysRef.current = [];
    refreshAfterMutation.current = false;
    setPendingTargetKeys([]);
    setPendingSwapTargetKeys([]);
    setReplaceConfirmations([]);
    setGenerationIssue(null);
    setPartialSaveNotice(false);
    setRelaxed([]);
    setSwapSelection(null);
    setSwapFeedback({});
    void loadWeek(target, false);
  };

  const beginGeneration = (targets: MealSlotTarget[]): GenerationContext => {
    const revisions = new Map<string, number>();
    const targetKeys = targets.map(targetKey);
    targetKeys.forEach((key) => {
      const revision = (targetRevisions.current.get(key) ?? 0) + 1;
      targetRevisions.current.set(key, revision);
      revisions.set(key, revision);
    });
    viewRevision.current += 1;
    loadRevision.current += 1;
    setRefreshing(false);
    setRefreshFailed(false);
    setGenerationIssue(null);
    setPartialSaveNotice(false);
    setRelaxed([]);
    setReplaceConfirmations((current) => current.filter((confirmation) =>
      !targetsOverlap(confirmation.originalTargets, targets)));
    setSwapSelection((current) => current && targetsOverlap([current], targets) ? null : current);
    setSwapFeedback((current) => {
      const next = { ...current };
      targetKeys.forEach((key) => delete next[key]);
      return next;
    });
    pendingTargetKeysRef.current = [...new Set([...pendingTargetKeysRef.current, ...targetKeys])];
    setPendingTargetKeys(pendingTargetKeysRef.current);
    return {
      contextRevision: contextRevision.current,
      revisions,
      targetKeys,
      weekStart: weekStartRef.current
    };
  };

  const contextMatches = (context: GenerationContext) =>
    context.contextRevision === contextRevision.current && context.weekStart === weekStartRef.current;
  const targetMatches = (context: GenerationContext, key: string) =>
    context.revisions.has(key) && context.revisions.get(key) === targetRevisions.current.get(key);
  const allTargetsMatch = (context: GenerationContext) =>
    context.targetKeys.every((key) => targetMatches(context, key));
  const finishGeneration = (context: GenerationContext) => {
    pendingTargetKeysRef.current = pendingTargetKeysRef.current.filter((key) =>
      !context.targetKeys.includes(key) || !targetMatches(context, key));
    setPendingTargetKeys(pendingTargetKeysRef.current);
    if (pendingTargetKeysRef.current.length === 0 && pendingSwapTargetKeysRef.current.length === 0 &&
      refreshAfterMutation.current) {
      refreshAfterMutation.current = false;
      void loadWeek(weekStartRef.current, true);
    }
  };

  const reloadFailedGeneration = async (context: GenerationContext) => {
    const end = buildMenuWeek(context.weekStart, [], new Date()).end;
    try {
      const docs = await api.listMealSlots(context.weekStart, end);
      if (!contextMatches(context)) return;
      const currentTargetKeys = context.targetKeys.filter((key) => targetMatches(context, key));
      if (currentTargetKeys.length === 0) return;
      const matchingDocs = docs.filter((doc) => currentTargetKeys.includes(targetKey(doc)));
      setSlots((current) => mergeSlots(current, matchingDocs));
      setClockNow(Date.now());
      setPartialSaveNotice(true);
    } catch {
      if (contextMatches(context) && context.targetKeys.some((key) => targetMatches(context, key))) {
        setRefreshFailed(true);
        setPartialSaveNotice(true);
      }
    }
  };

  const generate = async (targets: MealSlotTarget[], replaceExisting = false) => {
    if (targets.length === 0) return;
    const context = beginGeneration(targets);
    try {
      const result = await api.generateMenus({ targets, replaceExisting });
      if (!contextMatches(context)) return;
      const docs = result.docs.filter((doc) => targetMatches(context, targetKey(doc)));
      if (docs.length === 0) return;
      viewRevision.current += 1;
      loadRevision.current += 1;
      setSlots((current) => mergeSlots(current, docs));
      setRelaxed((current) => [...new Set([...current, ...result.relaxedRules])]);
    } catch (error) {
      const isCurrent = contextMatches(context) && allTargetsMatch(context);
      const existingTargets = existingTargetsFrom(error);
      if (isCurrent && needsReplaceConfirmation(error) && existingTargets.length > 0) {
        setReplaceConfirmations((current) => [
          ...current.filter((confirmation) => !targetsOverlap(confirmation.originalTargets, targets)),
          { existingTargets, originalTargets: targets }
        ]);
        return;
      }
      if (handledAuthFailure(error)) return;
      if (error instanceof ApiError && error.code === "offering-pool-insufficient") {
        if (isCurrent) setGenerationIssue(generationErrorText(error));
        return;
      }
      if (isCurrent) viewRevision.current += 1;
      await reloadFailedGeneration(context);
    } finally {
      finishGeneration(context);
    }
  };

  const generating = (targets: MealSlotTarget[]) =>
    targets.some((target) => pendingTargetKeys.includes(targetKey(target)));

  const swapping = (target: MealSlotTarget) => pendingSwapTargetKeys.includes(targetKey(target));
  const busy = (targets: MealSlotTarget[]) => targets.some((target) =>
    pendingTargetKeys.includes(targetKey(target)) || pendingSwapTargetKeys.includes(targetKey(target)));

  const swap = async (slot: MealSlot, offeringId: string | number) => {
    const key = targetKey(slot);
    if (pendingTargetKeysRef.current.includes(key) || pendingSwapTargetKeysRef.current.includes(key)) return;
    const capturedContextRevision = contextRevision.current;
    const capturedWeek = weekStartRef.current;
    const targetRevision = (targetRevisions.current.get(key) ?? 0) + 1;
    targetRevisions.current.set(key, targetRevision);
    const isCurrent = () => capturedContextRevision === contextRevision.current &&
      capturedWeek === weekStartRef.current &&
      targetRevision === targetRevisions.current.get(key);
    viewRevision.current += 1;
    loadRevision.current += 1;
    setRefreshing(false);
    setRefreshFailed(false);
    setSwapSelection(null);
    setSwapFeedback((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setReplaceConfirmations((current) => current.filter((confirmation) =>
      !targetsOverlap(confirmation.originalTargets, [slot])));
    pendingSwapTargetKeysRef.current = [...pendingSwapTargetKeysRef.current, key];
    setPendingSwapTargetKeys(pendingSwapTargetKeysRef.current);
    try {
      const result = await api.swapMenuItem(slot.id, offeringId);
      if (!isCurrent()) return;
      viewRevision.current += 1;
      loadRevision.current += 1;
      setSlots((current) => replaceMealSlot(current, result.doc));
      setSwapFeedback((current) => ({
        ...current,
        [key]: { issue: null, relaxedRules: result.relaxedRules }
      }));
    } catch (error) {
      if (!isCurrent()) return;
      if (handledAuthFailure(error)) return;
      if (error instanceof ApiError && error.code === "no-swap-candidate") {
        setSwapFeedback((current) => ({
          ...current,
          [key]: { issue: "没有合适的同类菜品，请先补充菜品库", relaxedRules: [] }
        }));
        return;
      }
      if (error instanceof ApiError && error.code === "meal-slot-menu-locked") {
        setSwapFeedback((current) => ({
          ...current,
          [key]: { issue: "餐次状态已变化，菜单不可修改", relaxedRules: [] }
        }));
        refreshAfterMutation.current = true;
        return;
      }
      await Taro.showToast({ title: error instanceof Error ? error.message : "换菜失败", icon: "none" });
    } finally {
      pendingSwapTargetKeysRef.current = pendingSwapTargetKeysRef.current.filter((target) =>
        target !== key || !isCurrent());
      setPendingSwapTargetKeys(pendingSwapTargetKeysRef.current);
      if (pendingTargetKeysRef.current.length === 0 && pendingSwapTargetKeysRef.current.length === 0 &&
        refreshAfterMutation.current) {
        refreshAfterMutation.current = false;
        void loadWeek(weekStartRef.current, true);
      }
    }
  };

  const mealCard = (meal: MealPosition) => {
    const targets = [{ date: meal.date, occasion: meal.occasion }];
    const isGenerating = generating(targets);
    const isSwapping = swapping(targets[0]!);
    const isBusy = busy(targets);
    const feedback = swapFeedback[targetKey(targets[0]!)];
    return (
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
        {(meal.slot === null || meal.editable) && (
          <View className="menu-meal-actions">
            {meal.slot && (
              <>
                <Button
                  size="mini"
                  disabled={isBusy}
                  onClick={() => setSwapSelection(meal.slot)}
                >{isSwapping ? "换菜中" : "换一道"}</Button>
                <Button
                  size="mini"
                  onClick={() => void Taro.navigateTo({
                    url: bookingConfigUrl(currentWeek, { date: meal.date, occasion: meal.occasion })
                  })}
                >设置价格与截止时间</Button>
              </>
            )}
            <Button
              size="mini"
              disabled={isBusy}
              onClick={() => void generate(targets)}
            >
              {isGenerating ? "生成中" : `${meal.slot ? "重新生成" : "生成"}${occasionText(meal.occasion)}`}
            </Button>
          </View>
        )}
        {feedback?.issue && (
          <View className="menu-swap-feedback">
            <Text>{feedback.issue}</Text>
            <Button size="mini" onClick={() => void Taro.navigateTo({ url: "/pages/merchant/offerings/index" })}>
              去菜品库
            </Button>
          </View>
        )}
        {feedback && relaxedRulesText(feedback.relaxedRules) && (
          <Text className="notice">
            本次{relaxedRulesText(feedback.relaxedRules)}
          </Text>
        )}
      </View>
    );
  };

  return (
    <View className="page menu-page">
      <View className="menu-heading">
        <Text className="title">本周菜单</Text>
        <Button size="mini" onClick={requestWeekRefresh}>刷新</Button>
      </View>
      <View className="menu-week-heading">
        <Button aria-label="上一周" size="mini" onClick={() => changeWeek(-1)}>‹</Button>
        <View>
          <Text className="section-title">{formatWeekRange(currentWeek)}</Text>
          <Text className="subtitle">先排菜，再统一开放预订</Text>
        </View>
        {weekEditableTargets.length > 0 && (
          <Button
            size="mini"
            disabled={busy(weekEditableTargets)}
            onClick={() => void generate(weekEditableTargets)}
          >重新生成</Button>
        )}
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
                  setSwapSelection(null);
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
          {partialSaveNotice && (
            <Text className="notice">生成未完成，部分目标可能已保存，请核对当前菜单</Text>
          )}
          {generationIssue && (
            <View className="card menu-generation-issue">
              <Text>{generationIssue}</Text>
              <Button onClick={() => void Taro.navigateTo({ url: "/pages/merchant/offerings/index" })}>
                去补充菜品
              </Button>
            </View>
          )}
          {relaxedRulesText(relaxed) && <Text className="notice">{relaxedRulesText(relaxed)}</Text>}
          <Button
            className="primary menu-primary-action"
            disabled={primaryGeneratesMenus && busy(weekMissingTargets)}
            onClick={() => {
              if (primaryGeneratesMenus) {
                void generate(weekMissingTargets);
              } else {
                void Taro.navigateTo({ url: bookingConfigUrl(currentWeek) });
              }
            }}
          >
            {generating(weekMissingTargets) ? "正在生成本周菜单" : primaryCta.label}
          </Button>
          {primaryGeneratesMenus && hasOpenBookings && (
            <Button onClick={() => void Taro.navigateTo({ url: bookingConfigUrl(currentWeek) })}>
              查看预订与分享
            </Button>
          )}
        </>
      )}

      {replaceConfirmation && (
        <View className="card menu-replace-confirmation">
          <Text className="section-title">确认重新生成</Text>
          <Text>以下餐次已有菜单，确认后原菜单会被替换：</Text>
          {replaceConfirmation.existingTargets.map((target) => (
            <Text key={targetKey(target)}>{targetText(target)}</Text>
          ))}
          <Button
            className="danger"
            onClick={() => void generate(replaceConfirmation.originalTargets, true)}
          >确认重新生成</Button>
          <Button onClick={() => setReplaceConfirmations((current) => current.slice(1))}>取消</Button>
        </View>
      )}

      {swapSelection && (
        <View className="card menu-swap-sheet">
          <Text className="section-title">选择要换掉的菜</Text>
          <Text className="meta">{swapSelection.date} {occasionText(swapSelection.occasion)}</Text>
          {swapSelection.menuItems.map((item) => (
            <Button
              className="menu-swap-option"
              key={String(item.offeringId)}
              aria-label={`换掉 ${item.nameSnapshot}`}
              onClick={() => void swap(swapSelection, item.offeringId)}
            >
              {item.nameSnapshot}
            </Button>
          ))}
          <Button onClick={() => setSwapSelection(null)}>取消</Button>
        </View>
      )}

      {jielongImportEnabled(process.env.KITH_INN_V1_ENABLE_JIELONG_IMPORT) && (
        <View className="card fallback-entry">
          <Text className="meta">仅在顾客预订登记无法上线时使用</Text>
          <Button onClick={() => void Taro.navigateTo({ url: "/pages/merchant/jielong-import/index" })}>
            接龙导入（兜底）
          </Button>
        </View>
      )}

      <MerchantNav active="menu" />
    </View>
  );
});

export default class MerchantMenu extends Component {
  private readonly page = createRef<MenuPageHandle>();
  private hasShown = false;

  componentDidShow() {
    if (this.hasShown) this.page.current?.refresh();
    else this.hasShown = true;
  }

  render() {
    return <MerchantMenuView ref={this.page} />;
  }
}
