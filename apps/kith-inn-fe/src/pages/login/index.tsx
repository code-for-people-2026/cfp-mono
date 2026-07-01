import Taro from "@tarojs/taro";
import { useEffect } from "react";
import { Text, View } from "@tarojs/components";
import { Button } from "@nutui/nutui-react-taro";
import { createTokenStore, type Storage } from "@/store/auth";
import { devLoginUrl, wxLoginUrl } from "@/services/api";

// Taro storage adapter — lives in the page (UI layer) so the pure store logic
// stays unit-testable without Taro.
const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

// H5 dev shortcut: no Taro.login on H5, so the dev-login endpoint (be,
// non-production) mints a token for a known seeded operator openid.
const DEV_OPENID = "taozi-dev-openid";

async function login(): Promise<void> {
  try {
    let token: string;
    if (process.env.TARO_ENV === "weapp") {
      const { code } = await Taro.login();
      const res = await Taro.request({
        url: wxLoginUrl(),
        method: "POST",
        data: { code },
        header: { "content-type": "application/json" },
      });
      token = (res.data as { token: string }).token;
    } else {
      const res = await Taro.request({
        url: devLoginUrl(),
        method: "POST",
        data: { openid: DEV_OPENID },
        header: { "content-type": "application/json" },
      });
      token = (res.data as { token: string }).token;
    }
    tokens.setToken(token);
    Taro.redirectTo({ url: "/pages/today/index" });
  } catch {
    Taro.showToast({ title: "登录失败", icon: "error" });
  }
}

export default function Login() {
  useEffect(() => {
    if (tokens.getToken()) Taro.redirectTo({ url: "/pages/today/index" });
  }, []);

  return (
    <View className="flex min-h-screen flex-col items-center justify-center bg-linear-to-b from-paper via-wash to-white px-[80rpx] text-ink">
      <Text className="text-[96rpx] font-bold">街坊味</Text>
      <View className="mt-[160rpx] w-full">
        <Button type="primary" onClick={login} className="[background:var(--color-red)] text-white h-[96rpx] w-full rounded-[16rpx] text-[32rpx]">
          微信登录
        </Button>
      </View>
    </View>
  );
}
