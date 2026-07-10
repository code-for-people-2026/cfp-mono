import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import type { SellerSelectionResponse } from "@cfp/kith-inn-v1-shared/api";
import { beginLogin, completeLogin, completeSellerSelection, merchantRoute } from "@/logic/login";
import { createApiClient, type RequestAdapter } from "@/services/api";
import { createSessionStore, type Storage } from "@/store/session";

const DEV_OPENID = "taozi-v1-dev-openid";
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
const api = createApiClient({ request, sessions });

export default function MerchantLogin() {
  const [selection, setSelection] = useState<SellerSelectionResponse | null>(null);

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "offerings") {
      void Taro.redirectTo({ url: "/pages/merchant/offerings/index" });
    }
  }, []);

  const enter = async () => {
    try {
      const result = completeLogin(await beginLogin(
        process.env.TARO_ENV === "weapp" ? "weapp" : "h5",
        {
          api,
          devOpenid: DEV_OPENID,
          wxCode: async () => {
            const { code } = await Taro.login();
            if (!code) throw new Error("wx.login 未返回 code");
            return code;
          }
        }
      ), sessions);
      if (result.next === "select-seller") {
        setSelection({
          status: "seller-selection-required",
          selectionToken: result.selectionToken,
          sellers: result.sellers
        });
      } else {
        await Taro.redirectTo({ url: "/pages/merchant/offerings/index" });
      }
    } catch {
      await Taro.showToast({ title: "登录失败，请稍后重试", icon: "none" });
    }
  };

  const choose = async (sellerId: string | number) => {
    if (!selection) return;
    try {
      await completeSellerSelection(selection.selectionToken, sellerId, api, sessions);
      await Taro.redirectTo({ url: "/pages/merchant/offerings/index" });
    } catch {
      await Taro.showToast({ title: "商家身份已失效", icon: "none" });
    }
  };

  return (
    <View className="page login-page">
      <Text className="title">街坊味</Text>
      <Text className="subtitle">桃子的商家工作台</Text>
      {selection ? (
        <View className="card seller-list">
          <Text className="section-title">请选择本次经营的商家</Text>
          {selection.sellers.map((seller) => (
            <Button key={String(seller.sellerId)} onClick={() => void choose(seller.sellerId)}>
              {seller.sellerName}
            </Button>
          ))}
        </View>
      ) : (
        <Button className="primary" onClick={() => void enter()}>
          {process.env.TARO_ENV === "weapp" ? "微信登录" : "开发登录"}
        </Button>
      )}
    </View>
  );
}
