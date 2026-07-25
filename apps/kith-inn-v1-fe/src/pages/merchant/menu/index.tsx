import { Button, Input, Text, View } from "@tarojs/components";
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
import {
  buildMenuRange,
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
  const initialView = useRef(rememberedView).current;
  const firstWeek = useRef(initialView?.weekStart ?? initialWeekStart(new Date())).current;
  const firstSelectedDate = useRef(initialView?.selectedDate ??
    buildMenuWeek(firstWeek, [], new Date()).selectedDate).current;
  if (rememberedView === null) rememberedView = { weekStart: firstWeek, selectedDate: firstSelectedDate };
  const weekStartRef = useRef(firstWeek);
  const loadRevision = useRef(0);
  const mutationRevision = useRef(0);
  const contextRevision = useRef(0);
  const viewRevision = useRef(0);
  const targetRevisions = useRef(new Map<string, number>());
  const [currentWeek, setCurrentWeek] = useState(firstWeek);
  const [selectedDate, setSelectedDate] = useState(firstSelectedDate);
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [date, setDate] = useState("");
  const [legacySlots, setLegacySlots] = useState<MealSlot[]>([]);
  const [relaxed, setRelaxed] = useState<RelaxedRule[]>([]);
  const [pendingTargetKeys, setPendingTargetKeys] = useState<string[]>([]);
  const [replaceConfirmation, setReplaceConfirmation] = useState<ReplaceConfirmation | null>(null);
  const [generationIssue, setGenerationIssue] = useState<string | null>(null);
  const [partialSaveNotice, setPartialSaveNotice] = useState(false);

  const week = useMemo(() =>
    buildMenuWeek(currentWeek, slots, new Date(clockNow), selectedDate),
  [clockNow, currentWeek, selectedDate, slots]);
  const selectedDay = week.days.find((day) => day.date === week.selectedDate) ?? week.days[0]!;
  const primaryCta = weekCta(week);
  const weekMissingTargets = missingTargets(week);
  const weekEditableTargets = editableTargets(week);

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

  useImperativeHandle(pageRef, () => ({
    refresh: () => {
      if (merchantRoute(sessions.getSession()) !== "login" && pendingTargetKeys.length === 0) {
        void loadWeek(weekStartRef.current, true);
      }
    }
  }));

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
      return;
    }
    void loadWeek(firstWeek, false);
    return () => {
      loadRevision.current += 1;
      mutationRevision.current += 1;
      contextRevision.current += 1;
      viewRevision.current += 1;
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
    contextRevision.current += 1;
    viewRevision.current += 1;
    targetRevisions.current.forEach((revision, key) => targetRevisions.current.set(key, revision + 1));
    rememberedView = { weekStart: target, selectedDate: targetDate };
    setCurrentWeek(target);
    setSelectedDate(targetDate);
    setSlots([]);
    setPendingTargetKeys([]);
    setReplaceConfirmation(null);
    setGenerationIssue(null);
    setPartialSaveNotice(false);
    setRelaxed([]);
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
    setReplaceConfirmation((current) => current && targetsOverlap(current.originalTargets, targets) ? null : current);
    setPendingTargetKeys((current) => [...new Set([...current, ...targetKeys])]);
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
    setPendingTargetKeys((current) => current.filter((key) =>
      !context.targetKeys.includes(key) || !targetMatches(context, key)));
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
      setLegacySlots((current) => mergeSlots(current, matchingDocs));
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
      setLegacySlots((current) => mergeSlots(current, docs));
      setRelaxed((current) => [...new Set([...current, ...result.relaxedRules])]);
    } catch (error) {
      const isCurrent = contextMatches(context) && allTargetsMatch(context);
      const existingTargets = existingTargetsFrom(error);
      if (isCurrent && needsReplaceConfirmation(error) && existingTargets.length > 0) {
        setReplaceConfirmation({
          existingTargets,
          originalTargets: targets
        });
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

  const swap = async (slot: MealSlot, offeringId: string | number) => {
    const revision = mutationRevision.current;
    loadRevision.current += 1;
    setRefreshing(false);
    setRefreshFailed(false);
    setReplaceConfirmation((current) => current && targetsOverlap(current.originalTargets, [slot]) ? null : current);
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

  const mealCard = (meal: MealPosition) => {
    const targets = [{ date: meal.date, occasion: meal.occasion }];
    const isGenerating = generating(targets);
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
          <Button
            size="mini"
            disabled={isGenerating}
            onClick={() => void generate(targets)}
          >
            {isGenerating ? "生成中" : `${meal.slot ? "重新生成" : "生成"}${occasionText(meal.occasion)}`}
          </Button>
        )}
      </View>
    );
  };

  return (
    <View className="page menu-page">
      <View className="menu-heading">
        <Text className="title">本周菜单</Text>
        <Button size="mini" disabled={pendingTargetKeys.length > 0}
          onClick={() => void loadWeek(currentWeek, true)}>刷新</Button>
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
            disabled={generating(weekEditableTargets)}
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
            disabled={(primaryCta.kind === "generate-week" || primaryCta.kind === "fill-week") &&
              generating(weekMissingTargets)}
            onClick={() => {
              if (primaryCta.kind === "generate-week" || primaryCta.kind === "fill-week") {
                void generate(weekMissingTargets);
              } else {
                void Taro.navigateTo({ url: "/pages/merchant/batches/index" });
              }
            }}
          >
            {generating(weekMissingTargets) ? "正在生成本周菜单" : primaryCta.label}
          </Button>
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
          <Button onClick={() => setReplaceConfirmation(null)}>取消</Button>
        </View>
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
        <Text className="section-title">兼容换菜操作</Text>
        <Input
          aria-label="菜单起始日期"
          placeholder="菜单起始日期"
          value={date}
          onInput={(event) => {
            setDate(event.detail.value);
          }}
        />
        <Button onClick={() => void loadLegacy()}>查看未来 31 天菜单</Button>
      </View>
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
                disabled={loadState !== "loaded" || generating([{ date: slot.date, occasion: slot.occasion }])}
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
