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

async function wxLogin(): Promise<string> {
  const { code } = await Taro.login();
  const res = await Taro.request({
    url: wxLoginUrl(),
    method: "POST",
    data: { code },
    header: { "content-type": "application/json" },
  });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`wx-login ${res.statusCode}`);
  return (res.data as { token: string }).token;
}

function finishLogin(token: string): void {
  tokens.setToken(token);
  Taro.redirectTo({ url: "/pages/today/index" });
}

export async function productionLogin(taroEnv = process.env.TARO_ENV): Promise<void> {
  if (taroEnv !== "weapp") {
    Taro.showToast({ title: "请使用微信小程序登录", icon: "none" });
    return;
  }

  try {
    finishLogin(await wxLogin());
  } catch {
    Taro.showToast({ title: "登录失败", icon: "error" });
  }
}

async function developmentLogin(taroEnv = process.env.TARO_ENV): Promise<void> {
  try {
    const token = taroEnv === "weapp" ? await wxLogin().catch(devLogin) : await devLogin();
    finishLogin(token);
  } catch {
    Taro.showToast({ title: "登录失败", icon: "error" });
  }
}

const login = process.env.KITH_INN_DEV_BUILD === "1" ? developmentLogin : productionLogin;

/** Dev-login shortcut (bypass wx.login; for local testing without WX_APPID/SECRET). */
async function devLogin(): Promise<string> {
  if (process.env.KITH_INN_DEV_BUILD !== "1") throw new Error("production dev-login disabled");
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
        <Button type="primary" onClick={() => void login()} className="bg-red text-white h-[96rpx] w-full rounded-[16rpx] text-[32rpx]">
          微信登录
        </Button>
        {process.env.KITH_INN_DEV_BUILD === "1" ? (
          <View className="mt-[32rpx] text-center">
            <Text className="text-[24rpx] text-muted" onClick={async () => { try { tokens.setToken(await devLogin()); Taro.redirectTo({ url: "/pages/today/index" }); } catch { Taro.showToast({ title: "登录失败", icon: "error" }); } }}>
              开发登录（跳过微信）
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
