import Taro from "@tarojs/taro";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import { Button, Progress, Tag } from "@nutui/nutui-react-taro";
import { TabBar } from "@/components/TabBar";
import { TopBar } from "@/components/TopBar";
import { deliveryUrl, markDeliveredUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";
import { todayShanghai } from "@/logic/time";
import { buildingProgress, fulfillmentStatusLabel, type AddressGroup, type DeliveryView } from "@/logic/deliveryView";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

export default function Delivery() {
  const [view, setView] = useState<DeliveryView | null>(null);

  const load = useCallback(() => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    Taro.request({ url: deliveryUrl(todayShanghai()), header: { Authorization: `Bearer ${token}` } })
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
        setView(res.data as DeliveryView);
      })
      .catch(() => Taro.showToast({ title: "加载失败", icon: "error" }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 「这栋送到了」→ PATCH /delivery/fulfillments { ids } (exact — no substring
   *  spillover) → refetch. Marks only this group's still-open orderItems. */
  const markBuilding = (g: AddressGroup) => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    const ids = g.fulfillments
      .filter((f) => f.status === "pending" || f.status === "handed-off")
      .map((f) => (typeof f.orderItem === "object" ? f.orderItem.id : f.orderItem));
    if (ids.length === 0) return;
    Taro.request({
      url: markDeliveredUrl(),
      method: "PATCH",
      data: { ids },
      header: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    })
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
            <Text className="block text-[44rpx] font-bold leading-tight">送餐分拣</Text>
            <Text className="mt-[12rpx] block text-[26rpx] text-muted">按地址装篮。勾销在「今天」说一句（如「3e23a 送了」）。</Text>
          </View>
          <Text className="flex-none rounded-[16rpx] border border-line bg-white px-[20rpx] py-[16rpx] text-[24rpx] font-extrabold">午餐</Text>
        </View>

        {view && view.gaps.totalPending > 0 && (
          <View className="mb-[20rpx]">
            <Tag className="inline-flex h-[40rpx] items-center rounded-[8rpx] bg-red-soft px-[14rpx] text-[22rpx] leading-none text-red">
              还差 {view.gaps.totalPending} 份未送
            </Tag>
          </View>
        )}

        {view === null ? (
          <Text className="block text-[24rpx] text-muted">加载中…</Text>
        ) : view.sort.length === 0 ? (
          <Text className="block text-[24rpx] text-muted">今天没有要送的。</Text>
        ) : (
          view.sort.map((g) => {
            const p = buildingProgress(g);
            return (
              <View key={g.address} className="my-[24rpx] rounded-[16rpx] border border-line bg-surface p-[24rpx]">
                <View className="mb-[20rpx] flex items-center justify-between gap-[20rpx]">
                  <Text className="text-[32rpx] font-bold">{g.address} · {g.count} 份</Text>
                  <Text className="text-[24rpx] text-muted">{p.done}/{p.total}</Text>
                </View>
                <Progress percent={p.percent} />
                {p.done < p.total && (
                  <View className="mt-[16rpx]">
                    <Button size="small" type="primary" className="[background:var(--color-green)] text-white" onClick={() => markBuilding(g)}>
                      这栋送到了
                    </Button>
                  </View>
                )}
                {g.fulfillments.map((f) => (
                  <View key={String(f.id)} className="flex items-center gap-[20rpx] border-b border-line py-[22rpx] last:border-b-0">
                    <Text className="text-[26rpx] font-semibold">{g.address}</Text>
                    <Text className="ml-auto text-[24rpx] text-muted">{fulfillmentStatusLabel(f.status)}</Text>
                  </View>
                ))}
              </View>
            );
          })
        )}
      </View>
      <TabBar active="delivery" />
    </View>
  );
}
