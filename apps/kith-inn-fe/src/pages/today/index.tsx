import Taro from "@tarojs/taro";
import { useEffect } from "react";
import { Text, View } from "@tarojs/components";
import { TabBar } from "@/components/TabBar";
import { createTokenStore, type Storage } from "@/store/auth";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

export default function Today() {
  // Entry page guard (Codex): on cold start with no token, go to login — same as
  // kitchen/menu do. (PR7b-3 replaces this placeholder with the real chat page.)
  useEffect(() => {
    if (!tokens.getToken()) Taro.redirectTo({ url: "/pages/login/index" });
  }, []);

  return (
    <View style={{ minHeight: "100vh", paddingBottom: "120px", padding: "32px 24px" }}>
      <Text style={{ fontSize: "44px", fontWeight: "bold" }}>今天</Text>
      <Text style={{ display: "block", color: "#687076", fontSize: "26px", marginTop: "16px" }}>
        「今天」聊天页即将上线（PR7b-3）。
      </Text>
      <TabBar active="today" />
    </View>
  );
}
