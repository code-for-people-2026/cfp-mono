import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import type { Offering } from "@cfp/kith-inn-shared";
import { TopBar } from "@/components/TopBar";
import { groupByMainIngredient, type OfferingGroup } from "@/logic/groupByMainIngredient";
import { offeringsUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

export default function Kitchen() {
  const [groups, setGroups] = useState<OfferingGroup[]>([]);

  useEffect(() => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    Taro.request({ url: offeringsUrl(), header: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        const offerings = (res.data as { offerings?: Offering[] }).offerings ?? [];
        setGroups(groupByMainIngredient(offerings));
      })
      .catch(() => Taro.showToast({ title: "加载失败", icon: "error" }));
  }, []);

  return (
    <View className="min-h-screen bg-linear-to-b from-paper via-wash to-white text-ink">
      <TopBar title="桃子的灶台" subtitle="菜品池" />
      <View className="px-[32rpx] pb-[60rpx] pt-[32rpx]">
        {groups.length === 0 ? (
          <Text className="block py-[24rpx] text-center text-[24rpx] text-muted">菜品池还是空的。</Text>
        ) : (
          groups.map((group) => (
            <View key={group.mainIngredient} className="mt-[32rpx] first:mt-0">
              <Text className="block text-[30rpx] font-bold text-amber">主料 · {group.mainIngredient}</Text>
              {group.offerings.map((offering) => (
                <View
                  key={String(offering.id)}
                  className="flex items-baseline border-b border-line py-[14rpx] last:border-b-0"
                >
                  <Text className="text-[32rpx]">{offering.name}</Text>
                  {offering.category ? (
                    <Text className="ml-[16rpx] text-[24rpx] text-muted">{offering.category}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    </View>
  );
}
