import Taro from "@tarojs/taro";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import { Button, Tag } from "@nutui/nutui-react-taro";
import type { Order } from "@cfp/kith-inn-shared";
import { TabBar } from "@/components/TabBar";
import { TopBar } from "@/components/TopBar";
import { orderConfirmUrl, orderUrl, ordersUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";
import { todayShanghai } from "@/logic/time";
import { customerName, orderStatusDot, STATUS_DOT_CLASS, yuan } from "@/logic/ordersView";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

export default function Orders() {
  const [orders, setOrders] = useState<Order[] | null>(null);

  const load = useCallback(() => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    Taro.request({ url: ordersUrl(todayShanghai()), header: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.statusCode === 401) {
          tokens.clearToken();
          Taro.redirectTo({ url: "/pages/login/index" });
          return;
        }
        if (res.statusCode !== 200) {
          Taro.showToast({ title: "加载失败", icon: "error" });
          return;
        }
        setOrders((res.data as { orders?: Order[] }).orders ?? []);
      })
      .catch(() => Taro.showToast({ title: "加载失败", icon: "error" }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Fire an order action (confirm=POST / mark-paid=PATCH), then refetch. */
  const act = (url: string, method: "POST" | "PATCH", body?: unknown) => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    Taro.request({ url, method, data: body, header: { Authorization: `Bearer ${token}`, "content-type": "application/json" } })
      .then((res) => {
        if (res.statusCode === 401) {
          tokens.clearToken();
          Taro.redirectTo({ url: "/pages/login/index" });
          return;
        }
        if (res.statusCode >= 400) {
          Taro.showToast({ title: "操作失败", icon: "error" });
          return;
        }
        load();
      })
      .catch(() => Taro.showToast({ title: "操作失败", icon: "error" }));
  };

  return (
    <View className="min-h-screen bg-linear-to-b from-paper via-wash to-white text-ink">
      <TopBar title="街坊味" subtitle="桃子的灶台" />
      <View className="px-[32rpx] pb-[200rpx] pt-[32rpx]">
        <View className="mb-[28rpx] flex items-start justify-between gap-[24rpx]">
          <View>
            <Text className="block text-[44rpx] font-bold leading-tight">订单台账</Text>
            <Text className="mt-[12rpx] block text-[26rpx] text-muted">草稿能找回，确认后才进入经营口径。</Text>
          </View>
          <Text className="flex-none rounded-[16rpx] border border-line bg-white px-[20rpx] py-[16rpx] text-[24rpx] font-extrabold">今天</Text>
        </View>

        {orders === null ? (
          <Text className="block text-[24rpx] text-muted">加载中…</Text>
        ) : orders.length === 0 ? (
          <Text className="block text-[24rpx] text-muted">今天还没有订单。</Text>
        ) : (
          orders.map((o) => {
            const dot = orderStatusDot(o);
            return (
              <View key={String(o.id)} className="my-[24rpx] rounded-[16rpx] border border-line bg-surface p-[24rpx]">
                <View className="flex items-center gap-[20rpx]">
                  <Tag
                    className={`inline-flex h-[68rpx] w-[68rpx] items-center justify-center rounded-[16rpx] text-[24rpx] font-extrabold ${STATUS_DOT_CLASS[dot.tone]}`}
                  >
                    {dot.label}
                  </Tag>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[26rpx] font-semibold">{customerName(o)}</Text>
                  </View>
                  <Text className="text-[24rpx] text-muted">{yuan(o.totalCents)}</Text>
                </View>
                <View className="mt-[16rpx] flex gap-[16rpx]">
                  {o.status === "draft" && (
                    <Button size="small" type="primary" className="[background:var(--color-red)] text-white" onClick={() => act(orderConfirmUrl(o.id), "POST")}>
                      确认
                    </Button>
                  )}
                  {o.status === "confirmed" && o.paymentStatus === "unpaid" && (
                    <Button size="small" className="[background:var(--color-surface)] text-ink" onClick={() => act(orderUrl(o.id), "PATCH", { paymentStatus: "paid" })}>
                      标已付
                    </Button>
                  )}
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
