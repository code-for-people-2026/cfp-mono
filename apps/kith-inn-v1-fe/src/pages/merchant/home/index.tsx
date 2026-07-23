import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { Component } from "react";
import type { Occasion, OrderSummary } from "@cfp/kith-inn-v1-shared";
import { MerchantNav } from "@/components/MerchantNav";
import {
  buildMerchantMealCard,
  businessDateInShanghai,
  retainMealsForRefresh,
  type MerchantMealCard
} from "@/logic/merchantHome";
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
const api = createApiClient({ request, sessions, onAuthFailure: (status) => {
  const reason = status === 403 ? "?reason=membership-inactive" : "";
  void Taro.redirectTo({ url: `/pages/merchant/login/index${reason}` });
} });
const EMPTY_SUMMARY: OrderSummary = { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 };
const occasions: Occasion[] = ["lunch", "dinner"];
type MealView = { card: MerchantMealCard; orderError: boolean };
type HomeState = { date: string; status: "loading" | "loaded" | "error"; meals: MealView[] };

const goMain = (url: string) => void Taro.redirectTo({ url });
const goDetail = (url: string) => void Taro.navigateTo({ url });
const deadlineText = (value: string | null) => value
  ? `${new Date(Date.parse(value) + 8 * 60 * 60 * 1000).toISOString().slice(11, 16)} 截止`
  : "未设置截止时间";

export default class MerchantHome extends Component<Record<string, never>, HomeState> {
  private revision = 0;
  private refreshing = false;
  private retryRevision: Record<Occasion, number> = { lunch: 0, dinner: 0 };
  state: HomeState = {
    date: businessDateInShanghai(new Date()),
    status: "loading",
    meals: []
  };

  componentDidShow() {
    void this.load();
  }

  private load = async () => {
    if (!sessions.getSession()) {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
      return;
    }
    const current = ++this.revision;
    this.refreshing = true;
    const today = businessDateInShanghai(new Date());
    this.setState((state) => ({
      date: today,
      status: "loading",
      meals: retainMealsForRefresh(state.date, today, state.meals)
    }));
    try {
      const slots = await api.listMealSlots(today, today);
      const views = await Promise.all(occasions.map(async (occasion): Promise<MealView> => {
        const slot = slots.find((item) => item.occasion === occasion) ?? null;
        if (!slot) return { card: buildMerchantMealCard({ occasion, slot, orders: [], summary: EMPTY_SUMMARY, now: new Date() }), orderError: false };
        try {
          const result = await api.listOrders(today, occasion);
          return { card: buildMerchantMealCard({ occasion, slot: result.mealSlot, orders: result.docs, summary: result.summary, now: new Date() }), orderError: false };
        } catch (error) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
          return { card: buildMerchantMealCard({ occasion, slot, orders: [], summary: EMPTY_SUMMARY, now: new Date() }), orderError: true };
        }
      }));
      if (current === this.revision) {
        this.refreshing = false;
        this.setState({ meals: views, status: "loaded" });
      }
    } catch (error) {
      if (current !== this.revision) return;
      this.refreshing = false;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return;
      this.setState({ status: "error" });
    }
  };

  private retryMeal = async (occasion: Occasion) => {
    if (this.refreshing) return;
    const previous = this.state.meals.find(({ card }) => card.occasion === occasion);
    if (!previous?.card.slot) return;
    const current = this.revision;
    const retry = ++this.retryRevision[occasion];
    try {
      const result = await api.listOrders(this.state.date, occasion);
      if (current !== this.revision || retry !== this.retryRevision[occasion]) return;
      const card = buildMerchantMealCard({ occasion, slot: result.mealSlot, orders: result.docs, summary: result.summary, now: new Date() });
      this.setState(({ meals }) => ({ meals: meals.map((meal) => meal.card.occasion === occasion
        ? { card, orderError: false }
        : meal) }));
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return;
    }
  };

  render() {
    const { date, status, meals } = this.state;
    const session = sessions.getSession();
    const waiting = meals.reduce((total, meal) => total + meal.card.waitingConfirmation, 0);
    const partial = meals.some((meal) => meal.orderError);
    const deliveryOccasion = meals.find(({ card }) => card.slot && card.pendingDelivery > 0)?.card.occasion ?? meals.find(({ card }) => card.slot)?.card.occasion;
    const deliveryUrl = deliveryOccasion
      ? `/pages/merchant/orders/index?date=${date}&occasion=${deliveryOccasion}`
      : "/pages/merchant/orders/index";

    return <View className="page merchant-home">
    <View className="home-heading"><View><Text className="title">{session?.sellerName ?? "商家"}，今天好</Text>
      <Text className="subtitle">{date} · 今天的饭，一眼看清楚</Text></View><Text className="home-mark">桃</Text></View>
    {status === "loading" && meals.length === 0 && <View className="page-state">正在加载今日工作台…</View>}
    {status === "error" ? <View className="page-state error"><Text>今日数据加载失败</Text>
      <Button className="primary" onClick={() => void this.load()}>重试</Button></View> : <>
      {status === "loading" && meals.length > 0 && <View className="home-notice">正在刷新今日数据…</View>}
      {status === "loaded" && <View className="home-notice">{partial ? "已知有" : "有"} {waiting} 笔待确认订单</View>}
      <View className="home-meals">{meals.map(({ card, orderError }) => <View key={card.occasion} className="card home-meal-card">
        <View className="home-card-title"><Text>{card.occasion === "lunch" ? "☀ 今日午餐" : "☾ 今日晚餐"}</Text>
          <Text className={`home-state ${card.state}`}>{card.stateText}</Text></View>
        {card.slot ? <><Text className="home-menu">{card.slot.menuItems.map((item) => item.nameSnapshot).join(" · ")}</Text>
          <View className="home-row"><Text className="strong">{card.priceText}</Text><Text className="meta">{deadlineText(card.slot.orderDeadline)}</Text></View>
          {orderError ? <View className="home-order-error"><Text>订单摘要加载失败</Text><Button size="mini" disabled={status === "loading"} onClick={() => void this.retryMeal(card.occasion)}>重新加载</Button></View>
            : <><Text className="home-summary">已确认 {card.confirmedQuantity} 份 · 待确认 {card.waitingConfirmation} 笔</Text>
              <Text className="meta">{card.confirmedOrders} 单已确认 · {card.unpaid} 单未付 · {card.pendingDelivery} 单待送</Text></>}
          <Button className="manual-add" size="mini" onClick={() => goDetail(
            `/pages/merchant/orders/add/index?date=${date}&occasion=${card.occasion}`
          )}>手动加单</Button>
        </> : <><Text className="home-menu">今天还没有安排这个餐次</Text>
          <Button size="mini" onClick={() => goMain("/pages/merchant/menu/index")}>先排菜单</Button></>}
      </View>)}</View>
      <View className="home-quick">
        <Button onClick={() => goMain("/pages/merchant/menu/index")}>排本周菜单</Button>
        <Button onClick={() => goDetail("/pages/merchant/batches/index")}>预订批次</Button>
        <Button onClick={() => goMain("/pages/merchant/orders/index")}>查看订单</Button>
        <Button onClick={() => goMain(deliveryUrl)}>配送清单</Button>
      </View>
    </>}
    <MerchantNav active="home" />
    </View>;
  }
}
