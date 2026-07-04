import Taro from "@tarojs/taro";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import { Button, Tag } from "@nutui/nutui-react-taro";
import type { MenuPlanView } from "@cfp/kith-inn-shared";
import { TabBar } from "@/components/TabBar";
import { TopBar } from "@/components/TopBar";
import { generatePlans, loadPlans, OCCASION_LABEL, plansByOccasion, publishPlan, swapDish, type Req } from "@/logic/menuEdit";
import { createTokenStore, type Storage } from "@/store/auth";
import { todayShanghai } from "@/logic/time";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);
// ponytail: cast — Taro.request is structurally a Req at runtime; page is display (e2e).
const req = Taro.request as unknown as Req;

// ── date helpers (display; e2e-exempt) ──
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
};
const weekdayCn = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return `周${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
};
const mdLabel = (iso: string): string => {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}月${d}日`;
};

type Mode = "day" | "week";
type Occasion = "lunch" | "dinner";

export default function Menu() {
  const hasToken = !!tokens.getToken();
  const [mode, setMode] = useState<Mode>("day");
  const [dayDate, setDayDate] = useState<string>(todayShanghai());
  const [dayPlans, setDayPlans] = useState<MenuPlanView[]>([]);
  const [weekPlans, setWeekPlans] = useState<Record<string, MenuPlanView[]>>({});

  const requireToken = useCallback((): string | null => {
    const t = tokens.getToken();
    if (!t) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return null;
    }
    return t;
  }, []);

  const loadDay = useCallback(async (date: string) => {
    const t = tokens.getToken();
    if (!t) return Taro.redirectTo({ url: "/pages/login/index" });
    try {
      setDayPlans(await loadPlans(t, date, req));
    } catch {
      Taro.showToast({ title: "加载失败", icon: "error" });
    }
  }, []);

  const loadWeek = useCallback(async () => {
    const t = tokens.getToken();
    if (!t) return Taro.redirectTo({ url: "/pages/login/index" });
    const from = todayShanghai();
    try {
      const all = await loadPlans(t, { from, to: addDays(from, 6) }, req);
      const byDate: Record<string, MenuPlanView[]> = {};
      for (const p of all) (byDate[p.date] ??= []).push(p);
      setWeekPlans(byDate);
    } catch {
      Taro.showToast({ title: "加载失败", icon: "error" });
    }
  }, []);

  useEffect(() => {
    if (mode === "day") loadDay(dayDate);
    else loadWeek();
  }, [mode, dayDate, loadDay, loadWeek]);

  const confirm = async (title: string, content: string): Promise<boolean> => (await Taro.showModal({ title, content })).confirm;

  const gen = async (date: string, occasion: Occasion, plan?: MenuPlanView) => {
    const t = requireToken();
    if (!t) return;
    const force = plan?.status === "published" ? await confirm("重新生成", `「${OCCASION_LABEL[occasion]}」已发给顾客，重新生成？`) : false;
    if (plan?.status === "published" && !force) return;
    const r = await generatePlans(t, [{ date, occasion }], req, force);
    if (!r.ok) {
      Taro.showToast({ title: r.reason === "pool-too-small" ? "菜品池不够" : "无法生成", icon: "none" });
      return;
    }
    if (mode === "day") loadDay(date);
    else loadWeek();
  };

  const genWeek = async () => {
    const t = requireToken();
    if (!t) return;
    const from = todayShanghai();
    const targets = Array.from({ length: 7 }, (_, i) => addDays(from, i)).flatMap((date) => [{ date, occasion: "lunch" as const }, { date, occasion: "dinner" as const }]);
    const r = await generatePlans(t, targets, req);
    if (!r.ok) {
      Taro.showToast({ title: r.reason === "pool-too-small" ? "菜品池不够" : "无法生成", icon: "none" });
      return;
    }
    loadWeek();
  };

  const swapAuto = async (plan: MenuPlanView, dishId: string | number) => {
    const t = requireToken();
    if (!t) return;
    const force = plan.status === "published" ? await confirm("换菜", `「${OCCASION_LABEL[plan.occasion]}」已发出，换菜会作旧文案，确定？`) : false;
    if (plan.status === "published" && !force) return;
    try {
      await swapDish(t, plan.planId, { dishId, force }, req);
      if (mode === "day") loadDay(plan.date);
      else loadWeek();
    } catch {
      Taro.showToast({ title: "换菜失败", icon: "error" });
    }
  };

  const publish = async (plan: MenuPlanView) => {
    const t = requireToken();
    if (!t) return;
    try {
      const { publishText } = await publishPlan(t, plan.planId, req);
      await Taro.setClipboardData({ data: publishText });
      Taro.showToast({ title: "文案已复制，去群粘贴", icon: "none" });
      if (mode === "day") loadDay(plan.date);
      else loadWeek();
    } catch {
      Taro.showToast({ title: "发布失败", icon: "error" });
    }
  };

  if (!hasToken) {
    return (
      <View className="min-h-screen bg-linear-to-b from-paper via-wash to-white text-ink">
        <TopBar title="街坊味" subtitle="桃子的灶台" />
        <Text className="block p-[40rpx] text-[26rpx] text-muted">请先登录</Text>
      </View>
    );
  }

  const dayByOccasion = plansByOccasion(dayPlans);

  return (
    <View className="min-h-screen bg-linear-to-b from-paper via-wash to-white text-ink">
      <TopBar title="街坊味" subtitle="桃子的灶台" />
      <View className="px-[32rpx] pb-[200rpx] pt-[24rpx]">
        <View className="mb-[24rpx] flex gap-[16rpx]">
          <Button size="small" type={mode === "day" ? "primary" : "default"} className={mode === "day" ? "[background:var(--color-red)] text-white" : "[background:var(--color-surface)] text-ink"} onClick={() => setMode("day")}>日</Button>
          <Button size="small" type={mode === "week" ? "primary" : "default"} className={mode === "week" ? "[background:var(--color-red)] text-white" : "[background:var(--color-surface)] text-ink"} onClick={() => setMode("week")}>周</Button>
        </View>

        {mode === "day" ? (
          <>
            <View className="mb-[24rpx] flex items-center justify-between">
              <Button size="small" className="[background:var(--color-surface)] text-ink" onClick={() => setDayDate(addDays(dayDate, -1))}>◀ 前一天</Button>
              <Text className="text-[28rpx] font-bold">{weekdayCn(dayDate)} · {mdLabel(dayDate)}{dayDate === todayShanghai() ? "（今天）" : ""}</Text>
              <Button size="small" className="[background:var(--color-surface)] text-ink" onClick={() => setDayDate(addDays(dayDate, 1))}>后一天 ▶</Button>
            </View>
            {dayDate !== todayShanghai() && (
              <View className="mb-[16rpx] text-center">
                <Text className="text-[24rpx] text-amber" onClick={() => setDayDate(todayShanghai())}>跳回今天</Text>
              </View>
            )}
            {(["lunch", "dinner"] as const).map((occasion) => {
              const plan = dayByOccasion[occasion];
              return <MealCard key={occasion} occasion={occasion} plan={plan} onGen={() => gen(dayDate, occasion, plan)} onSwap={(dishId) => plan && swapAuto(plan, dishId)} onPublish={() => plan && publish(plan)} />;
            })}
          </>
        ) : (
          <>
            <View className="mb-[20rpx] flex items-center justify-between">
              <Text className="text-[30rpx] font-bold">接下来 7 天</Text>
              <Button size="small" type="primary" className="[background:var(--color-red)] text-white" onClick={genWeek}>生成这周</Button>
            </View>
            {Array.from({ length: 7 }, (_, i) => addDays(todayShanghai(), i)).map((date) => {
              const { lunch, dinner } = plansByOccasion(weekPlans[date] ?? []);
              return (
                <View key={date} className="my-[16rpx] rounded-[16rpx] border border-line bg-surface p-[20rpx]" onClick={() => { setDayDate(date); setMode("day"); }}>
                  <Text className="block text-[28rpx] font-bold">{weekdayCn(date)} · {mdLabel(date)}</Text>
                  <Text className="mt-[8rpx] block text-[24rpx] text-muted">{OCCASION_LABEL.lunch}：{lunch ? lunch.dishes.map((d) => d.name).join("、") || "（已排）" : "未排"}</Text>
                  <Text className="block text-[24rpx] text-muted">{OCCASION_LABEL.dinner}：{dinner ? dinner.dishes.map((d) => d.name).join("、") || "（已排）" : "未排"}</Text>
                </View>
              );
            })}
          </>
        )}
      </View>
      <TabBar active="menu" />
    </View>
  );
}

/** A meal card: 午餐/晚餐 of one day. */
function MealCard(props: { occasion: Occasion; plan?: MenuPlanView; onGen: () => void; onSwap: (dishId: string | number) => void; onPublish: () => void }) {
  const { occasion, plan, onGen, onSwap, onPublish } = props;
  return (
    <View className="my-[20rpx] rounded-[16rpx] border border-line bg-surface p-[24rpx]">
      <View className="mb-[16rpx] flex items-center gap-[16rpx]">
        <Text className="text-[30rpx] font-bold">{OCCASION_LABEL[occasion]}</Text>
        {plan?.status === "published" && <Tag className="bg-green-soft text-green">已发出</Tag>}
        {plan?.status === "draft" && <Tag className="bg-amber-soft text-amber">暂定</Tag>}
      </View>
      {!plan ? (
        <Button size="small" type="primary" className="[background:var(--color-red)] text-white" onClick={onGen}>生成{OCCASION_LABEL[occasion]}</Button>
      ) : (
        <>
          {plan.dishes.map((d) => (
            <View key={String(d.id)} className="flex items-baseline justify-between border-b border-line py-[12rpx] last:border-b-0">
              <Text className="text-[28rpx]">{d.name}</Text>
              <Button size="small" className="[background:var(--color-surface)] text-muted" onClick={() => onSwap(d.id)}>换</Button>
            </View>
          ))}
          <View className="mt-[16rpx] flex flex-wrap gap-[16rpx]">
            <Button size="small" className="[background:var(--color-surface)] text-ink" onClick={onGen}>重新生成</Button>
            <Button size="small" type="primary" className="[background:var(--color-red)] text-white" onClick={onPublish}>{plan.status === "published" && plan.publishText ? "复制文案" : "一键发布"}</Button>
          </View>
        </>
      )}
    </View>
  );
}
