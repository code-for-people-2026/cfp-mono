import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import type {
  BookingBatchListResponse,
  MealSlot
} from "@cfp/kith-inn-v1-shared";
import {
  batchCloseText,
  bookingDeadlineInputValue,
  buildBookingConfig,
  copyBookingBatchPath,
  selectableBookingSlots
} from "@/logic/bookingBatches";
import { merchantRoute } from "@/logic/login";
import { buildMenuRange } from "@/logic/menu";
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

function initialConfig(slot: MealSlot): SlotConfig {
  return {
    priceYuan: slot.priceCents === null ? "" : (slot.priceCents / 100).toFixed(2).replace(/\.00$/, ""),
    orderDeadline: bookingDeadlineInputValue(slot.orderDeadline)
  };
}

export default function MerchantBatches() {
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [configs, setConfigs] = useState<Record<string, SlotConfig>>({});
  const [selected, setSelected] = useState<Array<string | number>>([]);
  const [title, setTitle] = useState("");
  const [batches, setBatches] = useState<BatchEntry[]>([]);
  const [closingId, setClosingId] = useState<string | number | null>(null);

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
      return;
    }
    void api.listBookingBatches().then(setBatches).catch(() => undefined);
  }, []);

  const loadSlots = async () => {
    const range = buildMenuRange(date);
    if (!range) {
      await Taro.showToast({ title: "请输入有效日期", icon: "none" });
      return;
    }
    try {
      const docs = await api.listMealSlots(range.from, range.to);
      setSlots(docs);
      setSelected([]);
      setConfigs(Object.fromEntries(docs.map((slot) => [String(slot.id), initialConfig(slot)])));
      setBatches(await api.listBookingBatches());
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: "预订配置加载失败", icon: "none" });
    }
  };

  const configure = async (slot: MealSlot, orderStatus: "open" | "closed") => {
    const config = configs[String(slot.id)] ?? initialConfig(slot);
    const input = orderStatus === "closed"
      ? { orderStatus } as const
      : buildBookingConfig({ ...config, orderStatus });
    if (!input) {
      await Taro.showToast({ title: "价格或截止时间无效", icon: "none" });
      return;
    }
    try {
      const doc = await api.updateMealSlotBookingConfig(slot.id, input);
      setSlots((current) => current.map((item) => String(item.id) === String(doc.id) ? doc : item));
      if (doc.orderStatus !== "open") {
        setSelected((current) => current.filter((id) => String(id) !== String(doc.id)));
      }
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: error instanceof Error ? error.message : "配置失败", icon: "none" });
    }
  };

  const createBatch = async () => {
    if (selected.length === 0) {
      await Taro.showToast({ title: "请先选择开放餐次", icon: "none" });
      return;
    }
    try {
      const entry = await api.createBookingBatch({
        ...(title.trim() ? { title: title.trim() } : {}),
        mealSlotIds: selected
      });
      setBatches((current) => [entry, ...current]);
      setSelected([]);
      setTitle("");
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: error instanceof Error ? error.message : "创建失败", icon: "none" });
    }
  };

  const closeBatch = async (id: string | number) => {
    try {
      const entry = await api.closeBookingBatch(id);
      setBatches((current) => current.map((item) => String(item.doc.id) === String(id) ? entry : item));
      setClosingId(null);
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: error instanceof Error ? error.message : "关闭失败", icon: "none" });
    }
  };

  return (
    <View className="page batches-page">
      <Text className="title">预订批次</Text>
      <Button onClick={() => void Taro.navigateTo({ url: "/pages/merchant/menu/index" })}>菜单</Button>

      <View className="card batch-controls">
        <Input
          placeholder="批次起始日期"
          value={date}
          onInput={(event) => setDate(event.detail.value)}
        />
        <Button onClick={() => void loadSlots()}>查看餐次</Button>
      </View>

      {slots.map((slot) => {
        const config = configs[String(slot.id)] ?? initialConfig(slot);
        const label = `${slot.date} ${occasionText(slot.occasion)}`;
        const isSelected = selected.some((id) => String(id) === String(slot.id));
        const isSelectable = selectableBookingSlots([slot], new Date().toISOString()).length === 1;
        return (
          <View className="card batch-slot" key={String(slot.id)}>
            <Text className="section-title">{label}</Text>
            <Text className="meta">状态：{slot.orderStatus === "open" ? "开放" : slot.orderStatus === "closed" ? "已关闭" : "草稿"}</Text>
            <Input
              placeholder="价格（元）"
              value={config.priceYuan}
              onInput={(event) => setConfigs((current) => ({
                ...current,
                [String(slot.id)]: { ...config, priceYuan: event.detail.value }
              }))}
            />
            <Input
              placeholder="截止时间"
              value={config.orderDeadline}
              onInput={(event) => setConfigs((current) => ({
                ...current,
                [String(slot.id)]: { ...config, orderDeadline: event.detail.value }
              }))}
            />
            <View className="batch-actions">
              {slot.orderStatus !== "closed" && (
                <Button className="primary" onClick={() => void configure(slot, "open")}>开放预订</Button>
              )}
              {slot.orderStatus === "open" && (
                <Button className="danger" onClick={() => void configure(slot, "closed")}>关闭餐次</Button>
              )}
              <Button
                className={isSelected ? "selected" : ""}
                aria-label={`选择 ${label}`}
                disabled={!isSelectable}
                onClick={() => setSelected((current) => isSelected
                  ? current.filter((id) => String(id) !== String(slot.id))
                  : [...current, slot.id])}
              >{isSelected ? "已选择" : "选择餐次"}</Button>
            </View>
          </View>
        );
      })}

      <View className="card batch-create">
        <Input placeholder="批次标题（可不填）" value={title} onInput={(event) => setTitle(event.detail.value)} />
        <Text className="meta">已选择 {selected.length} 个餐次</Text>
        <Button className="primary" onClick={() => void createBatch()}>创建预订批次</Button>
      </View>

      {batches.map((entry) => (
        <View className="card batch-card" key={String(entry.doc.id)}>
          <Text className="section-title">{entry.share.title}</Text>
          <Text className="meta">{entry.doc.status === "open" ? "开放中" : "已关闭"}</Text>
          <Text className="share-path">{entry.share.path}</Text>
          <Button
            aria-label="复制分享 path"
            onClick={() => void copyBookingBatchPath(entry.share, (options) => Taro.setClipboardData(options))
              .then(() => Taro.showToast({ title: "path 已复制", icon: "none" }))}
          >复制 path</Button>
          {entry.doc.status === "open" && closingId === null && (
            <Button className="danger" aria-label="关闭预订批次" onClick={() => setClosingId(entry.doc.id)}>关闭批次</Button>
          )}
          {String(closingId) === String(entry.doc.id) && (
            <View className="close-confirmation">
              <Text>{batchCloseText(entry.doc)}</Text>
              <Button className="danger" onClick={() => void closeBatch(entry.doc.id)}>确认关闭批次</Button>
              <Button onClick={() => setClosingId(null)}>取消</Button>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}
