import { Button, Checkbox, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";
import type {
  BulkMarkDeliveredResult,
  CustomerProfile,
  ManualOrderUpdate,
  MealSlot,
  Occasion,
  Order,
  OrderAction,
  OrderSummary
} from "@cfp/kith-inn-v1-shared";
import { merchantRoute } from "@/logic/login";
import {
  availableOrderActions,
  buildManualOrderCreate,
  buildOrderEdit,
  bulkDeliveryFeedback,
  copyOrderChecklist,
  duplicateDraftUpdate,
  merchantOrdersPageNotice,
  orderAddressText,
  orderChecklistText,
  orderResubmitInput,
  orderStateText,
  orderSummaryText,
  replaceOrder,
  toggleBulkOrderSelection,
  type MerchantOrdersPageStatus
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
const api = createApiClient({
  request,
  sessions,
  onAuthFailure: (status) => {
    const reason = status === 403 ? "?reason=membership-inactive" : "";
    void Taro.redirectTo({ url: `/pages/merchant/login/index${reason}` });
  }
});

const EMPTY_SUMMARY: OrderSummary = {
  confirmedOrders: 0,
  totalQuantity: 0,
  unpaid: 0,
  pendingDelivery: 0
};

const handledAuthFailure = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

const ACTION_LABELS: Record<OrderAction, string> = {
  confirm: "确认",
  cancel: "取消",
  resubmit: "重提",
  "mark-paid": "标已付",
  "mark-unpaid": "标未付",
  "mark-delivered": "标已送",
  "mark-pending-delivery": "标待送"
};

export default function MerchantOrders() {
  const loadRevision = useRef(0);
  const [date, setDate] = useState("");
  const [occasion, setOccasion] = useState<Occasion>("lunch");
  const [mealSlot, setMealSlot] = useState<MealSlot | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<OrderSummary>(EMPTY_SUMMARY);
  const [profiles, setProfiles] = useState<CustomerProfile[]>([]);
  const [customerProfileId, setCustomerProfileId] = useState<string | number | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [address, setAddress] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [pendingDuplicate, setPendingDuplicate] = useState<{ id: string | number; patch: ManualOrderUpdate } | null>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const [editQuantity, setEditQuantity] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNote, setEditNote] = useState("");
  const [confirmedEditPending, setConfirmedEditPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ id: string | number; action: "cancel" | "resubmit" } | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Array<string | number>>([]);
  const [bulkResults, setBulkResults] = useState<BulkMarkDeliveredResult[]>([]);
  const [pageStatus, setPageStatus] = useState<MerchantOrdersPageStatus>("idle");

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
      return;
    }
    void api.listCustomerProfiles().then(setProfiles).catch((error: unknown) => {
      if (handledAuthFailure(error)) return;
      return Taro.showToast({ title: "顾客资料加载失败", icon: "none" });
    });
  }, []);

  const clearLoadedOrderState = () => {
    loadRevision.current += 1;
    setMealSlot(null);
    setOrders([]);
    setSummary(EMPTY_SUMMARY);
    setPendingDuplicate(null);
    setEditing(null);
    setConfirmedEditPending(false);
    setPendingAction(null);
    setSelectedOrderIds([]);
    setBulkResults([]);
    setPageStatus("idle");
  };

  const load = async (targetOccasion: Occasion) => {
    clearLoadedOrderState();
    setPageStatus("loading");
    const revision = loadRevision.current;
    try {
      const result = await api.listOrders(date, targetOccasion);
      if (revision !== loadRevision.current) return;
      setOccasion(targetOccasion);
      setMealSlot(result.mealSlot);
      setOrders(result.docs);
      setSummary(result.summary);
      setPendingDuplicate(null);
      setPageStatus("loaded");
    } catch (error) {
      if (revision !== loadRevision.current) return;
      if (handledAuthFailure(error)) return;
      setPageStatus("error");
      await Taro.showToast({
        title: error instanceof Error ? error.message : "订单加载失败",
        icon: "none"
      });
    }
  };

  const save = async () => {
    if (!mealSlot) {
      await Taro.showToast({ title: "请先查看一个餐次", icon: "none" });
      return;
    }
    const input = buildManualOrderCreate({
      mealSlotId: mealSlot.id,
      customerProfileId,
      displayName,
      address,
      quantity,
      note
    });
    if (!input) {
      await Taro.showToast({ title: "请填写完整顾客资料和正整数份数", icon: "none" });
      return;
    }
    try {
      const result = await api.createOrder(input);
      setOrders((current) => replaceOrder(current, result.doc));
      setProfiles((current) => current.some((profile) => String(profile.id) === String(result.profile.id))
        ? current
        : [...current, result.profile]);
      setCustomerProfileId(result.profile.id);
      setPendingDuplicate(null);
    } catch (error) {
      const duplicate = duplicateDraftUpdate(error, input);
      if (duplicate) {
        setPendingDuplicate(duplicate);
        return;
      }
      if (handledAuthFailure(error)) return;
      await Taro.showToast({
        title: error instanceof ApiError && error.code === "canceled-order-exists"
          ? "已取消订单需在后续明确重提"
          : "草稿补单失败",
        icon: "none"
      });
    }
  };

  const confirmDuplicate = async () => {
    if (!pendingDuplicate) return;
    try {
      const doc = await api.updateOrder(pendingDuplicate.id, pendingDuplicate.patch);
      setOrders((current) => replaceOrder(current, doc));
      setPendingDuplicate(null);
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: "更新现有草稿失败", icon: "none" });
    }
  };

  const beginEdit = (order: Order) => {
    setEditing(order);
    setEditQuantity(String(order.quantity));
    setEditDisplayName(order.displayName);
    setEditAddress(order.address ?? "");
    setEditNote(order.note ?? "");
    setConfirmedEditPending(false);
  };

  const saveEdit = async (confirmedImpactAccepted = false) => {
    if (!editing) return;
    const patch = buildOrderEdit({
      quantity: editQuantity,
      displayName: editDisplayName,
      address: editAddress,
      note: editNote
    }, confirmedImpactAccepted, editing.source);
    if (!patch) {
      await Taro.showToast({ title: "订单修改内容无效", icon: "none" });
      return;
    }
    if (editing.status === "confirmed" && !confirmedImpactAccepted) {
      setConfirmedEditPending(true);
      return;
    }
    try {
      await api.updateOrder(editing.id, patch);
      setEditing(null);
      setConfirmedEditPending(false);
      await load(occasion);
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: "订单修改失败", icon: "none" });
    }
  };

  const runAction = async (order: Order, action: OrderAction) => {
    try {
      await api.actOnOrder(order.id, action, action === "resubmit" ? orderResubmitInput(order) : undefined);
      setPendingAction(null);
      await load(occasion);
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({
        title: error instanceof Error ? error.message : "订单操作失败",
        icon: "none"
      });
    }
  };

  const runBulkDelivery = async () => {
    if (selectedOrderIds.length === 0) return;
    try {
      const results = await api.bulkMarkDelivered(selectedOrderIds);
      await load(occasion);
      setBulkResults(results);
      setSelectedOrderIds([]);
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: "批量送达失败", icon: "none" });
    }
  };

  const copyChecklist = async () => {
    if (!mealSlot) return;
    try {
      await copyOrderChecklist(mealSlot, orders, Taro.setClipboardData);
      await Taro.showToast({ title: "清单已复制", icon: "success" });
    } catch {
      await Taro.showToast({ title: "清单复制失败", icon: "none" });
    }
  };

  const pageNotice = merchantOrdersPageNotice(pageStatus, orders.length);
  return (
    <View className="page orders-page" data-meal-slot-id={mealSlot ? String(mealSlot.id) : ""}>
      <Text className="title">餐次订单</Text>
      <Button onClick={() => void Taro.navigateTo({ url: "/pages/merchant/menu/index" })}>菜单</Button>
      {pageNotice && <View className="card page-state"><Text className={pageStatus === "error" ? "notice" : "meta"}>
        {pageNotice}
      </Text></View>}

      <View className="card order-controls">
        <Input placeholder="订单日期" value={date} onInput={(event) => {
          setDate(event.detail.value);
          clearLoadedOrderState();
        }} />
        <View className="order-actions">
          <Button onClick={() => void load("lunch")}>查看午餐订单</Button>
          <Button onClick={() => void load("dinner")}>查看晚餐订单</Button>
        </View>
        {mealSlot && <Text className="meta">当前餐次：{mealSlot.date} {occasion === "lunch" ? "午餐" : "晚餐"}</Text>}
      </View>

      {mealSlot && <Text className="notice">{orderSummaryText(summary)}</Text>}

      {mealSlot && (
        <View className="card checklist-card">
          <Text className="section-title">备餐/送餐清单</Text>
          <Text className="order-checklist">{orderChecklistText(mealSlot, orders)}</Text>
          <Button className="primary" onClick={() => void copyChecklist()}>复制备餐/送餐清单</Button>
        </View>
      )}

      {selectedOrderIds.length > 0 && (
        <Button className="primary" onClick={() => void runBulkDelivery()}>
          批量标已送（{selectedOrderIds.length}）
        </Button>
      )}
      {bulkDeliveryFeedback(bulkResults).map((feedback) => (
        <Text className="notice" key={feedback}>{feedback}</Text>
      ))}

      <View className="card order-form">
        <Text className="section-title">顾客资料与草稿补单</Text>
        <View className="profile-list">
          {profiles.map((profile) => (
            <Button
              key={String(profile.id)}
              size="mini"
              className={String(customerProfileId) === String(profile.id) ? "selected" : ""}
              onClick={() => {
                setCustomerProfileId(profile.id);
                setPendingDuplicate(null);
              }}
            >选择 {profile.displayName} {profile.address}</Button>
          ))}
          <Button size="mini" onClick={() => {
            setCustomerProfileId(null);
            setPendingDuplicate(null);
          }}>新建顾客资料</Button>
        </View>
        {customerProfileId === null && (
          <>
            <Input placeholder="顾客称呼" value={displayName} onInput={(event) => {
              setDisplayName(event.detail.value);
              setPendingDuplicate(null);
            }} />
            <Input placeholder="顾客地址" value={address} onInput={(event) => {
              setAddress(event.detail.value);
              setPendingDuplicate(null);
            }} />
          </>
        )}
        <Input placeholder="份数" type="number" value={quantity} onInput={(event) => {
          setQuantity(event.detail.value);
          setPendingDuplicate(null);
        }} />
        <Input placeholder="备注" value={note} onInput={(event) => {
          setNote(event.detail.value);
          setPendingDuplicate(null);
        }} />
        <Button className="primary" onClick={() => void save()}>草稿补单</Button>
        {pendingDuplicate && (
          <Button className="danger" onClick={() => void confirmDuplicate()}>确认更新现有草稿</Button>
        )}
      </View>

      {editing && (
        <View className="card order-form edit-order-form">
          <Text className="section-title">{editing.status === "confirmed" ? "修改已确认订单" : "修改草稿"}</Text>
          <Input placeholder="编辑份数" type="number" value={editQuantity} onInput={(event) => {
            setEditQuantity(event.detail.value);
            setConfirmedEditPending(false);
          }} />
          {editing.source !== "jielong-import" && (
            <>
              <Input placeholder="编辑称呼" value={editDisplayName} onInput={(event) => {
                setEditDisplayName(event.detail.value);
                setConfirmedEditPending(false);
              }} />
              <Input placeholder="编辑地址" value={editAddress} onInput={(event) => {
                setEditAddress(event.detail.value);
                setConfirmedEditPending(false);
              }} />
            </>
          )}
          <Input placeholder="编辑备注" value={editNote} onInput={(event) => {
            setEditNote(event.detail.value);
            setConfirmedEditPending(false);
          }} />
          <Button className="primary" onClick={() => void saveEdit()}>
            {editing.status === "confirmed" ? "保存已确认订单修改" : "保存草稿修改"}
          </Button>
          {confirmedEditPending && (
            <Button className="danger" onClick={() => void saveEdit(true)}>确认影响并保存</Button>
          )}
        </View>
      )}

      {orders.map((order) => (
        <View className="card order-card" key={String(order.id)} data-order-id={String(order.id)}>
          <View className="order-copy">
            <Text className="section-title">{order.displayName}</Text>
            <Text>{orderAddressText(order)}</Text>
            <Text>{order.quantity} 份 · ¥{(order.totalCents / 100).toFixed(2)}</Text>
            {order.note && <Text className="meta">备注：{order.note}</Text>}
            <Text className="meta">{orderStateText(order)}</Text>
          </View>
          {order.status === "confirmed" && (
            <Checkbox
              value={String(order.id)}
              checked={selectedOrderIds.some((id) => String(id) === String(order.id))}
              aria-label={`选择 ${order.displayName}`}
              onClick={() => setSelectedOrderIds((current) => toggleBulkOrderSelection(current, order))}
            >选择</Checkbox>
          )}
          {order.status !== "canceled" && (
            <Button size="mini" aria-label={`编辑 ${order.displayName}`} onClick={() => beginEdit(order)}>编辑</Button>
          )}
          {availableOrderActions(order).map((action) => {
            const needsConfirmation = action === "cancel" || action === "resubmit";
            const isPending = needsConfirmation && pendingAction?.action === action &&
              String(pendingAction.id) === String(order.id);
            return isPending ? (
              <Button
                key={action}
                size="mini"
                className="danger"
                onClick={() => void runAction(order, action)}
              >确认{ACTION_LABELS[action]}</Button>
            ) : (
              <Button
                key={action}
                size="mini"
                aria-label={`${ACTION_LABELS[action]} ${order.displayName}`}
                onClick={() => needsConfirmation
                  ? setPendingAction({ id: order.id, action })
                  : void runAction(order, action)}
              >{ACTION_LABELS[action]}</Button>
            );
          })}
        </View>
      ))}
    </View>
  );
}
