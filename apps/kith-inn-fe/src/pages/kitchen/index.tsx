import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import type { Offering } from "@cfp/kith-inn-shared";
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
    <View style={{ padding: "24px" }}>
      <Text style={{ fontSize: "40px", fontWeight: "bold" }}>桃子的灶台</Text>
      {groups.map((group) => (
        <View key={group.mainIngredient} style={{ marginTop: "32px" }}>
          <Text style={{ fontSize: "30px", color: "#b06b00" }}>主料 · {group.mainIngredient}</Text>
          {group.offerings.map((offering) => (
            <View
              key={String(offering.id)}
              style={{ padding: "14px 0", borderBottom: "1px solid #eee" }}
            >
              <Text style={{ fontSize: "32px" }}>{offering.name}</Text>
              {offering.category ? (
                <Text style={{ color: "#999", marginLeft: "16px" }}>{offering.category}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
