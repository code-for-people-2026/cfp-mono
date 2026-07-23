import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import type { CustomerProfile, MealSlot, Occasion, Order, OrderSummary } from "@cfp/kith-inn-v1-shared";
import { merchantRoute } from "@/logic/login";
import { buildMerchantMealCard } from "@/logic/merchantHome";
import {
  buildManualOrderCreate,
  manualOrderConflict,
  type ManualOrderConflict
} from "@/logic/orders";
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
const handledAuthFailure = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

type PageStatus = "loading" | "loaded" | "missing" | "error";

export default function MerchantManualOrderAdd() {
  const params = Taro.getCurrentInstance().router?.params ?? {};
  const date = params.date ?? "";
  const occasion: Occasion = params.occasion === "dinner" ? "dinner" : "lunch";
  const [status, setStatus] = useState<PageStatus>("loading");
  const [mealSlot, setMealSlot] = useState<MealSlot | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<OrderSummary>(EMPTY_SUMMARY);
  const [profiles, setProfiles] = useState<CustomerProfile[]>([]);
  const [profileError, setProfileError] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<CustomerProfile | null>(null);
  const [query, setQuery] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [address, setAddress] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<ManualOrderConflict | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
      return;
    }
    void api.listOrders(date, occasion)
      .then((result) => {
        setMealSlot(result.mealSlot);
        setOrders(result.docs);
        setSummary(result.summary);
        setStatus("loaded");
      })
      .catch((error: unknown) => {
        if (handledAuthFailure(error)) return;
        setStatus(error instanceof ApiError && error.code === "meal-slot-not-found" ? "missing" : "error");
      });
    void api.listCustomerProfiles("").then((customerProfiles) => {
      setProfiles(customerProfiles);
      setProfileError(false);
    }).catch((error: unknown) => {
      if (!handledAuthFailure(error)) setProfileError(true);
    });
  }, []);

  const ordersUrl = `/pages/merchant/orders/index?date=${encodeURIComponent(date)}&occasion=${occasion}`;
  const card = mealSlot ? buildMerchantMealCard({ occasion, slot: mealSlot, orders, summary, now: new Date() }) : null;
  const clearPending = () => setPending(null);

  const searchProfiles = async () => {
    try {
      setProfiles(await api.listCustomerProfiles(query));
      setProfileError(false);
    } catch (error) {
      if (handledAuthFailure(error)) return;
      setProfileError(true);
      await Taro.showToast({ title: "顾客搜索失败", icon: "none" });
    }
  };

  const save = async () => {
    if (!mealSlot || saving) return;
    const input = buildManualOrderCreate({
      mealSlotId: mealSlot.id,
      customerProfileId: selectedProfile?.id ?? null,
      displayName,
      address,
      quantity,
      note
    });
    if (!input) {
      await Taro.showToast({ title: "请填写完整顾客资料和正整数份数", icon: "none" });
      return;
    }
    setSaving(true);
    try {
      await api.createOrder(input);
      await Taro.redirectTo({ url: ordersUrl });
    } catch (error) {
      if (handledAuthFailure(error)) return;
      const conflict = manualOrderConflict(error, input, orders);
      if (conflict) setPending(conflict);
      else await Taro.showToast({ title: "待确认订单保存失败", icon: "none" });
    } finally {
      setSaving(false);
    }
  };

  const confirmPending = async () => {
    if (!pending || saving) return;
    if (pending.kind === "view-existing") {
      await Taro.redirectTo({ url: ordersUrl });
      return;
    }
    setSaving(true);
    try {
      if (pending.kind === "update-draft") await api.updateOrder(pending.id, pending.patch);
      else await api.actOnOrder(pending.id, "resubmit", pending.input);
      await Taro.redirectTo({ url: ordersUrl });
    } catch (error) {
      if (!handledAuthFailure(error)) {
        await Taro.showToast({ title: "既有订单处理失败", icon: "none" });
      }
    } finally {
      setSaving(false);
    }
  };

  return <View className="page manual-order-page">
    <Text className="title">手动加单</Text>
    <Text className="subtitle">补录私信订单，保存后进入待确认状态</Text>
    <Button className="manual-back" onClick={() => void Taro.redirectTo({ url: ordersUrl })}>返回餐次订单</Button>
    {status === "loading" && <View className="card page-state"><Text>正在加载餐次和顾客资料…</Text></View>}
    {status === "missing" && <View className="card page-state"><Text>没有找到这个餐次，请先排菜单。</Text>
      <Button onClick={() => void Taro.redirectTo({ url: "/pages/merchant/menu/index" })}>去排菜单</Button></View>}
    {status === "error" && <View className="card page-state"><Text>手动加单页面加载失败，请返回后重试。</Text></View>}
    {status === "loaded" && mealSlot && card && <>
      <View className="card manual-slot">
        <View className="home-card-title"><Text>{date} · {occasion === "lunch" ? "午餐" : "晚餐"}</Text>
          <Text className={`home-state ${card.state}`}>{card.stateText}</Text></View>
        <Text className="meta">当前顾客预订状态</Text>
        {(card.state === "deadline-passed" || card.state === "closed") &&
          <Text className="notice">顾客预订已截止，商家仍可手动补录私信订单。</Text>}
        {card.state === "menu-ready" && <Text className="notice">顾客预订尚未开放，商家仍可手动补录私信订单。</Text>}
        {card.state === "booking-open" && <Text className="meta">顾客预订开放中，商家也可手动补录私信订单。</Text>}
      </View>
      <View className="card manual-customer">
        <Text className="section-title">选择顾客</Text>
        {profileError && <Text className="notice manual-profile-error">顾客资料加载失败，可直接新建资料或重试搜索。</Text>}
        <View className="manual-search"><Input placeholder="搜索顾客" value={query} onInput={(event) => setQuery(event.detail.value)} />
          <Button size="mini" onClick={() => void searchProfiles()}>搜索</Button></View>
        <View className="profile-list">{profiles.map((profile) => <Button
          key={String(profile.id)}
          size="mini"
          className={`manual-profile${String(selectedProfile?.id) === String(profile.id) ? " selected" : ""}`}
          onClick={() => { setSelectedProfile(profile); clearPending(); }}
        >{profile.displayName} · {profile.address}</Button>)}</View>
        <Button size="mini" onClick={() => { setSelectedProfile(null); clearPending(); }}>新建顾客资料</Button>
      </View>
      <View className="card manual-form">
        <Text className="section-title">订单内容</Text>
        {selectedProfile ? <Text className="manual-selected">{selectedProfile.displayName} · {selectedProfile.address}</Text> : <>
          <Input placeholder="顾客称呼" value={displayName} onInput={(event) => { setDisplayName(event.detail.value); clearPending(); }} />
          <Input placeholder="顾客地址" value={address} onInput={(event) => { setAddress(event.detail.value); clearPending(); }} />
        </>}
        <Input placeholder="份数" type="number" value={quantity} onInput={(event) => { setQuantity(event.detail.value); clearPending(); }} />
        <Input placeholder="备注" value={note} onInput={(event) => { setNote(event.detail.value); clearPending(); }} />
        <Button className="primary" disabled={saving} onClick={() => void save()}>保存待确认订单</Button>
      </View>
      {pending && <View className="card manual-conflict">
        {pending.kind === "update-draft" && <><Text>该顾客已有待确认订单，请明确确认后更新。</Text>
          <Button className="danger" disabled={saving} onClick={() => void confirmPending()}>确认更新现有待确认订单</Button></>}
        {pending.kind === "resubmit-canceled" && <><Text>该顾客已有已取消订单，请明确确认后重提。</Text>
          <Button className="danger" disabled={saving} onClick={() => void confirmPending()}>确认重提已取消订单</Button></>}
        {pending.kind === "view-existing" && <><Text>{pending.source === "customer-card"
          ? "该顾客已有顾客端订单，不能改写为手动订单。"
          : "该顾客已有订单，请先查看既有订单。"}</Text>
          <Button onClick={() => void confirmPending()}>{pending.source === "customer-card" ? "查看顾客端既有订单" : "查看既有订单"}</Button></>}
      </View>}
    </>}
  </View>;
}
