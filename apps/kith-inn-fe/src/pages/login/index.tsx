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
      try {
        const { code } = await Taro.login();
        const res = await Taro.request({
          url: wxLoginUrl(),
          method: "POST",
          data: { code },
          header: { "content-type": "application/json" },
        });
        if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`wx-login ${res.statusCode}`);
        token = (res.data as { token: string }).token;
      } catch {
        // wx-login 不可用（没配 WX_APPID/SECRET 或 DevTools 网络不通）→ dev-login 兜底
        token = await devLogin();
      }
    } else {
      token = await devLogin();
    }
    tokens.setToken(token);
    Taro.redirectTo({ url: "/pages/today/index" });
  } catch {
    Taro.showToast({ title: "登录失败", icon: "error" });
  }
}

/** Dev-login shortcut (bypass wx.login; for local testing without WX_APPID/SECRET). */
async function devLogin(): Promise<string> {
  const res = await Taro.request({
    url: devLoginUrl(),
    method: "POST",
    data: { openid: DEV_OPENID },
    header: { "content-type": "application/json" },
  });
  return (res.data as { token: string }).token;
}

export default function Login() {
  useEffect(() => {
    if (tokens.getToken()) Taro.redirectTo({ url: "/pages/today/index" });
  }, []);

  return (
    <View className="flex min-h-screen flex-col items-center justify-center bg-linear-to-b from-paper via-wash to-white px-[80rpx] text-ink">
      <Text className="text-[96rpx] font-bold">街坊味</Text>
      <View className="mt-[160rpx] w-full">
        <Button type="primary" onClick={login} className="bg-red text-white h-[96rpx] w-full rounded-[16rpx] text-[32rpx]">
          微信登录
        </Button>
        <View className="mt-[32rpx] text-center">
          <Text className="text-[24rpx] text-muted" onClick={async () => { try { tokens.setToken(await devLogin()); Taro.redirectTo({ url: "/pages/today/index" }); } catch { Taro.showToast({ title: "登录失败", icon: "error" }); } }}>
            开发登录（跳过微信）
          </Text>
        </View>
      </View>
    </View>
  );
}
