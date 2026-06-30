import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import { Input, ScrollView, Text, View } from "@tarojs/components";
import { TabBar } from "@/components/TabBar";
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
    <View style={{ minHeight: "100vh", paddingBottom: "220px" }}>
      <View style={{ padding: "32px 24px 0" }}>
        <Text style={{ fontSize: "44px", fontWeight: "bold" }}>今天</Text>
        <Text style={{ display: "block", color: "#8a7f70", fontSize: "22px", marginTop: "6px" }}>
          跟「味」说一句，比如「王燕萍 午餐 2 份」或「26B 送了」。
        </Text>
      </View>
      <ScrollView scrollY style={{ padding: "16px 24px", maxHeight: "60vh" }}>
        {msgs.length === 0 ? (
          <Text style={{ color: "#687076", fontSize: "26px" }}>还没有对话。粘一段接龙，或直接说一句话。</Text>
        ) : (
          msgs.map((m, i) => {
            const me = m.role === "user";
            return (
              <View key={i} style={{ display: "flex", justifyContent: me ? "flex-end" : "flex-start", margin: "14px 0" }}>
                <View
                  style={{
                    maxWidth: "80%",
                    padding: "16px",
                    borderRadius: "12px",
                    background: me ? "#d7462f" : "#fff",
                    color: me ? "#fff" : "#202124",
                    border: me ? "0" : "1px solid #e6e2da",
                  }}
                >
                  <Text style={{ fontSize: "26px" }}>{m.content}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
      <View
        style={{
          position: "fixed",
          bottom: "100px",
          left: "12px",
          right: "12px",
          display: "flex",
          gap: "8px",
          alignItems: "center",
          padding: "8px",
          background: "#fffdf7",
          borderTop: "1px solid #e6e2da",
        }}
      >
        <Input
          value={text}
          onInput={(e) => setText(e.detail.value)}
          placeholder="粘接龙，或说 26B 送了"
          style={{ flex: 1, height: "56px", fontSize: "26px" }}
        />
        <View
          onClick={send}
          style={{
            padding: "0 20px",
            height: "56px",
            display: "flex",
            alignItems: "center",
            background: sending ? "#b9b9b9" : "#d7462f",
            color: "#fff",
            borderRadius: "8px",
            fontSize: "26px",
            fontWeight: 700,
          }}
        >
          {sending ? "…" : "发送"}
        </View>
      </View>
      <TabBar active="today" />
    </View>
  );
}
