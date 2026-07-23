import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import type { MealSlot, MealSlotTarget, RelaxedRule } from "@cfp/kith-inn-v1-shared";
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

const occasionText = (occasion: MealSlot["occasion"]) => occasion === "lunch" ? "午餐" : "晚餐";

function weekStart(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export default function MerchantMenu() {
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [relaxed, setRelaxed] = useState<RelaxedRule[]>([]);
  const [pendingTargets, setPendingTargets] = useState<MealSlotTarget[] | null>(null);

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
    }
  }, []);

  const load = async () => {
    const range = buildMenuRange(date);
    if (!range) {
      await Taro.showToast({ title: "请输入有效日期", icon: "none" });
      return;
    }
    try {
      setSlots(await api.listMealSlots(range.from, range.to));
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: "菜单加载失败", icon: "none" });
    }
  };

  const generate = async (targets: MealSlotTarget[], replaceExisting = false) => {
    if (targets.length === 0) {
      await Taro.showToast({ title: "请输入有效日期", icon: "none" });
      return;
    }
    try {
      const result = await api.generateMenus({ targets, replaceExisting });
      setSlots((current) => result.docs.reduce(replaceMealSlot, current));
      setRelaxed(result.relaxedRules);
      setPendingTargets(null);
    } catch (error) {
      if (needsReplaceConfirmation(error)) {
        setPendingTargets(targets);
        return;
      }
      if (handledAuthFailure(error)) return;
      await Taro.showToast({
        title: generationErrorText(error),
        icon: "none"
      });
    }
  };

  const swap = async (slot: MealSlot, offeringId: string | number) => {
    try {
      const result = await api.swapMenuItem(slot.id, offeringId);
      setSlots((current) => replaceMealSlot(current, result.doc));
      setRelaxed(result.relaxedRules);
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({
        title: error instanceof Error ? error.message : "换菜失败",
        icon: "none"
      });
    }
  };

  return (
    <View className="page menu-page">
      <Text className="title">菜单计划</Text>
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
        <Input
          placeholder="菜单起始日期"
          value={date}
          onInput={(event) => {
            setDate(event.detail.value);
            setPendingTargets(null);
          }}
        />
        <Button onClick={() => void load()}>查看未来 31 天菜单</Button>
        <Button className="primary" onClick={() => void generate(buildSingleTarget(date, "lunch"))}>生成午餐</Button>
        <Button onClick={() => void generate(buildSingleTarget(date, "dinner"))}>生成晚餐</Button>
        <Button onClick={() => void generate(buildWorkWeekTargets(date, ["lunch", "dinner"]))}>
          生成工作周午晚餐
        </Button>
        {pendingTargets && (
          <Button className="danger" onClick={() => void generate(pendingTargets, true)}>
            确认覆盖已有菜单
          </Button>
        )}
      </View>

      {relaxedRulesText(relaxed) && <Text className="notice">{relaxedRulesText(relaxed)}</Text>}

      {slots.map((slot) => (
        <View
          className="card menu-slot"
          key={String(slot.id)}
          data-date={slot.date}
          data-week={weekStart(slot.date)}
        >
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
