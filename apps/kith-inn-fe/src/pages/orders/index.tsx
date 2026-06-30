import Taro from "@tarojs/taro";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import { Button, Tag } from "@nutui/nutui-react-taro";
import type { Order } from "@cfp/kith-inn-shared";
import { TabBar } from "@/components/TabBar";
import { orderConfirmUrl, orderUrl, ordersUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";
import { customerName, orderStatusDot, yuan } from "@/logic/ordersView";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

const TONE = { green: "success", red: "danger", amber: "warning", muted: "default" } as const;

export default function Orders() {
  const [orders, setOrders] = useState<Order[] | null>(null);

  const load = useCallback(() => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    Taro.request({ url: ordersUrl(), header: { Authorization: `Bearer ${token}` } })
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
    <View style={{ minHeight: "100vh", paddingBottom: "120px" }}>
      <View style={{ padding: "32px 24px 0" }}>
        <Text style={{ fontSize: "44px", fontWeight: "bold" }}>订单台账</Text>
        <Text style={{ display: "block", color: "#687076", fontSize: "24px", marginTop: "8px" }}>
          草稿能找回，确认后才进入经营口径。
        </Text>
      </View>
      <View style={{ padding: "0 24px" }}>
        {orders === null ? (
          <Text style={{ color: "#687076" }}>加载中…</Text>
        ) : orders.length === 0 ? (
          <Text style={{ color: "#687076" }}>今天还没有订单。</Text>
        ) : (
          orders.map((o) => {
            const dot = orderStatusDot(o);
            return (
              <View
                key={String(o.id)}
                style={{ margin: "24px 0", padding: "24px", background: "#fff", borderRadius: "16px", border: "1px solid #e6e2da" }}
              >
                <View style={{ display: "flex", alignItems: "center" }}>
                  <Tag type={TONE[dot.tone]}>{dot.label}</Tag>
                  <Text style={{ marginLeft: "12px", fontSize: "30px", fontWeight: "bold" }}>{customerName(o)}</Text>
                  <Text style={{ marginLeft: "auto", fontSize: "26px", color: "#687076" }}>{yuan(o.totalCents)}</Text>
                </View>
                <View style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
                  {o.status === "draft" && (
                    <Button size="small" type="primary" onClick={() => act(orderConfirmUrl(o.id), "POST")}>
                      确认
                    </Button>
                  )}
                  {o.status === "confirmed" && o.paymentStatus === "unpaid" && (
                    <Button size="small" onClick={() => act(orderUrl(o.id), "PATCH", { paymentStatus: "paid" })}>
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
