import Taro from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import { TabBar } from "@/components/TabBar";
import { TopBar } from "@/components/TopBar";
import { chatUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";

type Msg = { id?: string | number; role: "user" | "assistant"; content: string };

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

export default function Today() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // True once a send starts — the initial history load must not clobber an
  // optimistic turn that raced ahead of it (Codex).
  const sentRef = useRef(false);

  useEffect(() => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    Taro.request({ url: chatUrl(), header: { Authorization: `Bearer ${token}` } })
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
        if (sentRef.current) return; // a send beat the initial load — don't clobber it
        // cms returns newest-first; render chronologically (oldest→newest).
        const messages = ((res.data as { messages?: Msg[] }).messages ?? []) as Msg[];
        setMsgs([...messages].reverse());
      })
      .catch(() => Taro.showToast({ title: "加载失败", icon: "error" }));
  }, []);

  const send = () => {
    const body = text.trim();
    if (!body || sending) return;
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    sentRef.current = true;
    setMsgs((m) => [...m, { role: "user", content: body }]);
    setText("");
    setSending(true);
    Taro.request({ url: chatUrl(), method: "POST", data: { text: body }, header: { Authorization: `Bearer ${token}`, "content-type": "application/json" } })
      .then((res) => {
        if (res.statusCode === 401) {
          tokens.clearToken();
          Taro.redirectTo({ url: "/pages/login/index" });
          return;
        }
        if (res.statusCode !== 200) {
          Taro.showToast({ title: "发送失败", icon: "error" });
          return;
        }
        const reply = (res.data as { reply?: string }).reply ?? "（没听清，能再说一遍吗？）";
        setMsgs((m) => [...m, { role: "assistant", content: reply }]);
      })
      .catch(() => Taro.showToast({ title: "发送失败", icon: "error" }))
      .finally(() => setSending(false));
  };

  return (
    <View className="min-h-screen bg-linear-to-b from-paper via-wash to-white text-ink">
      <TopBar title="街坊味" subtitle="桃子的灶台" />
      <View className="px-[32rpx] pb-[260rpx] pt-[32rpx]">
        <Text className="my-[24rpx] block text-center text-[22rpx] text-soft">展示今天和昨天，更早的已清理</Text>
        {msgs.length === 0 ? (
          <Text className="block py-[24rpx] text-center text-[24rpx] text-muted">
            还没有对话。粘一段接龙，或直接说一句「王燕萍 午餐 2 份」。
          </Text>
        ) : (
          msgs.map((m, i) => {
            const me = m.role === "user";
            return (
              <View key={i} className={`my-[28rpx] flex gap-[20rpx]${me ? " flex-row-reverse" : ""}`}>
                {!me && (
                  <View className="flex h-[60rpx] w-[60rpx] flex-none items-center justify-center rounded-[16rpx] bg-red text-[26rpx] font-extrabold text-white">
                    味
                  </View>
                )}
                <View
                  className={`max-w-[608rpx] break-words rounded-[16rpx] p-[24rpx] text-[26rpx] leading-relaxed ${
                    me ? "bg-red text-white" : "border border-line bg-surface"
                  }`}
                >
                  <Text>{m.content}</Text>
                </View>
              </View>
            );
          })
        )}
      </View>
      <View className="fixed inset-x-0 bottom-[108rpx] z-40 border-t border-line bg-paper px-[20rpx] pb-[20rpx] pt-[16rpx]">
        <View className="flex items-center gap-[16rpx]">
          <Input
            className="h-[80rpx] min-w-0 flex-1 rounded-[40rpx] bg-surface px-[32rpx] text-[28rpx] text-ink"
            value={text}
            onInput={(e) => setText(e.detail.value)}
            placeholder="粘接龙，或说 26B 送了"
          />
          <View
            className={`flex h-[80rpx] w-[80rpx] flex-none items-center justify-center rounded-full bg-red text-[36rpx] text-white${sending ? " opacity-60" : ""}`}
            onClick={send}
          >
            {sending ? "…" : "↑"}
          </View>
        </View>
      </View>
      <TabBar active="today" />
    </View>
  );
}
