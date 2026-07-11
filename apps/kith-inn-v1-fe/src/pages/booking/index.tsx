import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import type { CustomerBookingBatchView } from "@cfp/kith-inn-v1-shared";
import {
  beginCustomerSession,
  bookingBatchPublicId,
  bookingUnavailableText,
  formatBookingPrice
} from "@/logic/customerBooking";
import { createApiClient, type RequestAdapter } from "@/services/api";
import { createCustomerSessionStore, type CustomerStorage } from "@/store/customerSession";
import { createSessionStore, type Storage } from "@/store/session";

const storage: Storage & CustomerStorage = {
  get: (key) => Taro.getStorageSync(key) || null,
  set: (key, value) => Taro.setStorageSync(key, value),
  remove: (key) => Taro.removeStorageSync(key)
};
const sessions = createSessionStore(storage);
const customerSessions = createCustomerSessionStore(storage);
const request: RequestAdapter = async (options) => {
  const response = await Taro.request(options);
  return { statusCode: response.statusCode, data: response.data };
};
const api = createApiClient({ request, sessions, customerSessions });
const occasionText = (occasion: "lunch" | "dinner") => occasion === "lunch" ? "午餐" : "晚餐";

export default function CustomerBooking() {
  const [view, setView] = useState<CustomerBookingBatchView | null>(null);
  const [error, setError] = useState("");
  const params = Taro.getCurrentInstance().router?.params ?? {};
  const publicId = bookingBatchPublicId(params);

  useEffect(() => {
    if (!publicId) {
      setError("这个预订登记链接已失效");
      return;
    }
    void beginCustomerSession(
      process.env.TARO_ENV === "weapp" ? "weapp" : "h5",
      publicId,
      {
        api,
        devOpenid: process.env.KITH_INN_V1_CUSTOMER_DEV_OPENID ?? "",
        wxCode: async () => {
          const { code } = await Taro.login();
          if (!code) throw new Error("wx.login 未返回 code");
          return code;
        }
      }
    ).then((response) => {
      customerSessions.setSession({ token: response.token, ...response.session });
      return api.getPublicBookingBatch(publicId);
    }).then(setView).catch(() => setError("预订信息加载失败，请稍后重试"));
  }, [publicId]);

  if (error) return <View className="page booking-page"><Text className="notice">{error}</Text></View>;
  if (!view) return <View className="page booking-page"><Text>正在加载预订信息…</Text></View>;

  return (
    <View className="page booking-page">
      <Text className="title">{view.sellerName}</Text>
      <Text className="subtitle">{view.title}</Text>
      <Text className="batch-status">
        {view.status === "open" ? "开放登记" : view.status === "closed" ? "批次已关闭" : "批次已归档"}
      </Text>
      {view.slots.map((slot) => (
        <View className="card booking-slot" key={`${slot.date}-${slot.occasion}`}>
          <Text className="section-title">{slot.date} {occasionText(slot.occasion)}</Text>
          {slot.menuItems.map((item) => (
            <Text className="booking-menu-item" key={String(item.offeringId)}>{item.nameSnapshot}</Text>
          ))}
          <Text className="booking-price">{formatBookingPrice(slot.unitPriceCents)} / 份</Text>
          <Text className="meta">截止：{slot.orderDeadline ?? "未设置"}</Text>
          <Text className={slot.canBook ? "available" : "notice"}>
            {bookingUnavailableText(slot.unavailableReason)}
          </Text>
        </View>
      ))}
    </View>
  );
}
