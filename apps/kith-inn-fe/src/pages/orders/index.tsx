import Taro from "@tarojs/taro";
import { useCallback, useEffect, useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import { Button, Tag } from "@nutui/nutui-react-taro";
import type { DeliveryView, Fulfillment, Order } from "@cfp/kith-inn-shared";
import { TabBar } from "@/components/TabBar";
import { TopBar } from "@/components/TopBar";
import { deliveryUrl, markDeliveredUrl, orderConfirmUrl, orderUrl, ordersUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";
import { todayShanghai } from "@/logic/time";
import { customerName, yuan } from "@/logic/ordersView";
import {
  gapCount,
  isCheckable,
  joinOrdersFulfillments,
  lifecycleDots,
  mealFocus,
  sortByAddress,
  toggleSelection,
  visibleRows,
  type Occasion,
  type Row,
} from "@/logic/ordersLifecycle";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

const OCCASION_LABEL: Record<Occasion, string> = { lunch: "午餐", dinner: "晚餐" };

export default function Orders() {
  const [rows, setRows] = useState<Row[]>([]);
  const [occasion, setOccasion] = useState<Occasion>("lunch");
  const [prefix, setPrefix] = useState("");
  const [selected, setSelected] = useState<Array<string | number>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = tokens.getToken();
    if (!token) return Taro.redirectTo({ url: "/pages/login/index" });
    const date = todayShanghai();
    try {
      const [ordRes, delRes] = await Promise.all([
        Taro.request({ url: ordersUrl(date), header: { Authorization: `Bearer ${token}` } }),
        Taro.request({ url: deliveryUrl(date), header: { Authorization: `Bearer ${token}` } }),
      ]);
      if (ordRes.statusCode === 401 || delRes.statusCode === 401) {
        tokens.clearToken();
        return Taro.redirectTo({ url: "/pages/login/index" });
      }
      const orders = (ordRes.data as { orders?: Order[] }).orders ?? [];
      const dv = delRes.data as DeliveryView;
      const fulfillments = (dv.sort ?? []).flatMap((g) => g.fulfillments ?? []) as Fulfillment[];
      const joined = sortByAddress(joinOrdersFulfillments(orders, fulfillments));
      setRows(joined);
      // only apply mealFocus on initial load (not refetch after user manually switched, Codex #120 P2)
      if (loading) {
        const focus = mealFocus(joined);
        if (focus) setOccasion(focus);
      }
    } catch {
      Taro.showToast({ title: "加载失败", icon: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Clear selection when the meal tab or address filter changes (avoid跨集误操作).
  useEffect(() => {
    setSelected([]);
  }, [occasion, prefix]);

  const act = async (url: string, method: "POST" | "PATCH", body?: unknown) => {
    const token = tokens.getToken();
    if (!token) return Taro.redirectTo({ url: "/pages/login/index" });
    try {
      const res = await Taro.request({ url, method, data: body, header: { Authorization: `Bearer ${token}`, "content-type": "application/json" } });
      if (res.statusCode === 401) {
        tokens.clearToken();
        return Taro.redirectTo({ url: "/pages/login/index" });
      }
      if (res.statusCode >= 400) return Taro.showToast({ title: "操作失败", icon: "error" });
      load();
    } catch {
      Taro.showToast({ title: "操作失败", icon: "error" });
    }
  };

  const bulkDeliver = async () => {
    if (selected.length === 0) return;
    await act(markDeliveredUrl(), "PATCH", { ids: selected, set: { status: "done" } });
    setSelected([]);
  };

  const visible = visibleRows(rows, occasion, prefix);
  const gaps = gapCount(rows, occasion);

  return (
    <View className="page-shell">
      <TopBar title="街坊味" subtitle="桃子的灶台" />
      <View className="px-[32rpx] pb-[200rpx] pt-[32rpx]">
        {/* meal toggle */}
        <View className="mb-[20rpx] flex items-center justify-between">
          <View className="flex gap-[16rpx]">
            {(["lunch", "dinner"] as Occasion[]).map((occ) => (
              <Button key={occ} type={occasion === occ ? "primary" : "default"} className={occasion === occ ? "bg-red text-white" : "bg-surface text-ink"} onClick={() => setOccasion(occ)}>
                {OCCASION_LABEL[occ]}
              </Button>
            ))}
          </View>
          <Text className="text-[24rpx] text-muted">{gaps > 0 ? `${gaps} 单未送` : "全送完"}</Text>
        </View>

        {/* 地址筛选（缩候选集，大小写不敏感）+ 批量送达 */}
        <View className="mb-[24rpx] flex gap-[16rpx]">
          <Input
            value={prefix}
            placeholder="按地址筛选（如 3a）"
            onInput={(e) => setPrefix(e.detail.value)}
            className="flex-1 rounded-[12rpx] border border-line bg-white px-[16rpx] py-[12rpx] text-[28rpx]"
          />
          <Button
            type="primary"
            disabled={selected.length === 0}
            className={selected.length === 0 ? "bg-surface text-muted" : "bg-red text-white"}
            onClick={bulkDeliver}
          >
            批量送达{selected.length > 0 ? `(${selected.length})` : ""}
          </Button>
        </View>

        {loading ? (
          <Text className="block text-[24rpx] text-muted">加载中…</Text>
        ) : visible.length === 0 ? (
          <Text className="block text-[24rpx] text-muted">{prefix.trim() ? "没匹配到。" : "本餐次还没有订单。"}</Text>
        ) : (
          visible.map((row) => {
            const o = row.order;
            const d = lifecycleDots(row);
            const checkable = isCheckable(row) && !!row.fulfillment;
            const isSelected = checkable && row.fulfillment ? selected.includes(row.fulfillment.id) : false;
            const toggle = () => {
              if (checkable && row.fulfillment) setSelected((prev) => toggleSelection(prev, row.fulfillment!.id));
            };
            return (
              <View key={String(o.id)} className={`my-[16rpx] flex card bg-surface p-[24rpx] ${d.base === "canceled" ? "opacity-40" : ""} ${d.base === "draft" ? "opacity-60" : ""}`}>
                {/* 勾选格（checkable 行可点 toggle；其余占位对齐） */}
                <View onClick={toggle} className={`mr-[16rpx] mt-[4rpx] h-[40rpx] w-[40rpx] shrink-0 items-center justify-center rounded-[8rpx] border ${isSelected ? "border-green bg-green-soft" : checkable ? "border-line" : "border-transparent"}`}>
                  {isSelected && <Text className="text-[28rpx] font-bold text-green">✓</Text>}
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex items-center gap-[16rpx]">
                    <View className="min-w-0 flex-1">
                      <Text className={`text-[28rpx] font-semibold ${d.base === "canceled" ? "line-through" : ""}`}>{customerName(o)}</Text>
                      {o.address && <Text className="ml-[12rpx] text-[24rpx] text-muted">{o.address}</Text>}
                    </View>
                    {/* two-axis lifecycle dots */}
                    <View className="flex gap-[8rpx]">
                      {d.delivery !== "none" && (
                        <Tag className={`inline-flex h-[44rpx] items-center rounded-[8rpx] px-[12rpx] text-[22rpx] ${d.delivery === "done" ? "bg-green-soft text-green" : "bg-amber-soft text-amber"}`}>
                          {d.delivery === "done" ? "送✓" : "送○"}
                        </Tag>
                      )}
                      <Tag className={`inline-flex h-[44rpx] items-center rounded-[8rpx] px-[12rpx] text-[22rpx] ${d.payment === "paid" ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>
                        {d.payment === "paid" ? "付✓" : "付○"}
                      </Tag>
                    </View>
                    <Text className="text-[24rpx] text-muted">{yuan(o.totalCents)}</Text>
                  </View>
                  <View className="mt-[14rpx] flex flex-wrap gap-[12rpx]">
                    {d.base === "draft" && (
                      <Button type="primary" className="bg-red text-white" onClick={() => act(orderConfirmUrl(o.id), "POST")}>确认</Button>
                    )}
                    {d.base === "confirmed" && d.payment === "unpaid" && (
                      <Button className="bg-surface text-ink" onClick={() => act(orderUrl(o.id), "PATCH", { paymentStatus: "paid" })}>标已付</Button>
                    )}
                    {d.base === "confirmed" && o.paymentStatus === "paid" && (
                      <Button className="bg-surface text-muted" onClick={() => act(orderUrl(o.id), "PATCH", { paymentStatus: "unpaid" })}>回退未付</Button>
                    )}
                    {row.fulfillment && d.delivery === "pending" && (
                      <Button className="bg-surface text-ink" onClick={() => act(markDeliveredUrl(), "PATCH", { ids: [row.fulfillment!.id], set: { status: "done" } })}>标送达</Button>
                    )}
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>
      <TabBar active="orders" />
    </View>
  );
}
