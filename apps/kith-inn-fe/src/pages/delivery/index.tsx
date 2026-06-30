import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import { Progress, Tag } from "@nutui/nutui-react-taro";
import { TabBar } from "@/components/TabBar";
import { deliveryUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";
import { todayShanghai } from "@/logic/time";
import { buildingProgress, fulfillmentStatusLabel, type DeliveryView } from "@/logic/deliveryView";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

export default function Delivery() {
  const [view, setView] = useState<DeliveryView | null>(null);

  useEffect(() => {
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

  return (
    <View style={{ minHeight: "100vh", paddingBottom: "120px" }}>
      <View style={{ padding: "32px 24px 0" }}>
        <Text style={{ fontSize: "44px", fontWeight: "bold" }}>送餐分拣</Text>
        <Text style={{ display: "block", color: "#687076", fontSize: "24px", marginTop: "8px" }}>
          按楼栋装篮。勾销在「今天」说一句（如「26B 送了」）。
        </Text>
        {view && view.gaps.totalPending > 0 && (
          <View style={{ marginTop: "12px" }}>
            <Tag type="danger">还差 {view.gaps.totalPending} 份未送</Tag>
          </View>
        )}
      </View>
      <View style={{ padding: "0 24px" }}>
        {view === null ? (
          <Text style={{ color: "#687076" }}>加载中…</Text>
        ) : view.sort.length === 0 ? (
          <Text style={{ color: "#687076" }}>今天没有要送的。</Text>
        ) : (
          view.sort.map((g) => {
            const p = buildingProgress(g);
            return (
              <View
                key={g.building}
                style={{ margin: "24px 0", padding: "24px", background: "#fff", borderRadius: "16px", border: "1px solid #e6e2da" }}
              >
                <View style={{ display: "flex", alignItems: "center" }}>
                  <Text style={{ fontSize: "30px", fontWeight: "bold" }}>{g.building} · {g.count} 份</Text>
                  <Text style={{ marginLeft: "auto", fontSize: "24px", color: "#687076" }}>
                    {p.done}/{p.total}
                  </Text>
                </View>
                <View style={{ marginTop: "12px" }}>
                  <Progress percent={p.percent} color="#1f8a61" />
                </View>
                {g.fulfillments.map((f) => (
                  <View key={String(f.id)} style={{ display: "flex", padding: "12px 0", borderBottom: "1px solid #e6e2da" }}>
                    <Text style={{ fontSize: "26px" }}>{f.addrUnit ? `${g.building}-${f.addrUnit}` : g.building}</Text>
                    <Text style={{ marginLeft: "auto", fontSize: "24px", color: "#687076" }}>
                      {fulfillmentStatusLabel(f.status)}
                    </Text>
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
