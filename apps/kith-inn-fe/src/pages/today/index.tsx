import Taro from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import type { CardPayload, ConfirmCustomerItem } from "@cfp/kith-inn-shared";
import { ChatCard } from "@/components/ChatCard";
import { TabBar } from "@/components/TabBar";
import { TopBar } from "@/components/TopBar";
import { getCustomerConfirmActionState, type ChatCardMessage } from "@/logic/chatCards";
import { chatUrl, confirmCustomersUrl, markDeliveredUrl, orderConfirmUrl, orderUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";

type Msg = ChatCardMessage & { id?: string | number; cardUnavailable?: boolean };

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
  // Indexes of customer-confirm cards already acted on (one-shot button).
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
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
        setMsgs([...messages].reverse().map((m) => ({ ...m, fromHistory: true })));
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
        const data = res.data as { reply?: string; card?: CardPayload };
        const reply = data.reply ?? "（没听清，能再说一遍吗？）";
        setMsgs((m) => [...m, { role: "assistant", content: reply, card: data.card }]);
      })
      .catch(() => Taro.showToast({ title: "发送失败", icon: "error" }))
      .finally(() => setSending(false));
  };

  /** "全部建档并记单" on an active customer-confirm card → POST /chat/confirm-customers
   *  with this card's items (possibly address-edited by 桃子); server validates they still match pending. */
  const confirmCustomers = (i: number, editedItems?: ConfirmCustomerItem[]) => {
    if (confirming) return;
    const card = msgs[i]?.card;
    if (card?.type !== "customer-confirm") return;
    const action = getCustomerConfirmActionState(msgs, i, confirmed);
    if (action?.status !== "active") {
      if (action?.status === "stale") Taro.showToast({ title: "确认卡已过期，请重新识别", icon: "none" });
      return;
    }
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    setConfirming(true);
    Taro.request({
      url: confirmCustomersUrl(),
      method: "POST",
      data: { items: editedItems ?? card.data.items },
      header: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    })
      .then((res) => {
        if (res.statusCode === 401) {
          tokens.clearToken();
          Taro.redirectTo({ url: "/pages/login/index" });
          return;
        }
        if (res.statusCode === 409) {
          Taro.showToast({ title: "确认卡已过期，请重新识别", icon: "none" });
          return;
        }
        if (res.statusCode >= 400) {
          Taro.showToast({ title: "操作失败", icon: "error" });
          return;
        }
        const n = ((res.data as { created?: unknown[] }).created ?? []).length;
        setConfirmed((s) => new Set(s).add(i));
        setMsgs((m) => [...m, { role: "assistant", content: n > 0 ? `已建 ${n} 单。` : "没有建成，再看看？" }]);
      })
      .catch(() => Taro.showToast({ title: "操作失败", icon: "error" }))
      .finally(() => setConfirming(false));
  };

  /** 确认 / 标已付 on an orders card → reuse the orders-tab endpoints, then
   *  optimistically update that order inside the card so the button flips. */
  const onOrderAct = (msgIdx: number, orderId: string | number, action: "confirm" | "paid") => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    Taro.request({
      url: action === "confirm" ? orderConfirmUrl(orderId) : orderUrl(orderId),
      method: action === "confirm" ? "POST" : "PATCH",
      data: action === "paid" ? { paymentStatus: "paid" } : undefined,
      header: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    })
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
        Taro.showToast({ title: action === "confirm" ? "已确认" : "已收款", icon: "success" });
        setMsgs((ms) =>
          ms.map((m, i) =>
            i !== msgIdx || !m.card || m.card.type !== "orders"
              ? m
              : {
                  ...m,
                  card: {
                    ...m.card,
                    data: {
                      ...m.card.data,
                      orders: m.card.data.orders.map((o) =>
                        o.id !== orderId
                          ? o
                          : {
                              ...o,
                              status: action === "confirm" ? "confirmed" : o.status,
                              paymentStatus: action === "paid" ? ("paid" as const) : o.paymentStatus,
                            },
                      ),
                    },
                  },
                },
          ),
        );
      })
      .catch(() => Taro.showToast({ title: "操作失败", icon: "error" }));
  };

  /** 「送达」 on a delivery card → PATCH /delivery/fulfillments { ids } (exact),
   *  then optimistically mark the matching group(s) fully done inside the card. */
  const onMarkDelivered = (msgIdx: number, ids: Array<string | number>) => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    Taro.request({
      url: markDeliveredUrl(),
      method: "PATCH",
      data: { ids },
      header: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    })
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
        const count = ((res.data as { count?: number }).count ?? 0) as number;
        Taro.showToast({ title: count > 0 ? `已标记 ${count} 份送达` : "没有待送的", icon: count > 0 ? "success" : "none" });
        const idSet = new Set(ids);
        setMsgs((ms) =>
          ms.map((m, i) =>
            i !== msgIdx || !m.card || m.card.type !== "delivery"
              ? m
              : {
                  ...m,
                  card: {
                    ...m.card,
                    data: {
                      totalPending: Math.max(0, m.card.data.totalPending - count),
                      groups: m.card.data.groups.map((g) => (g.ids.some((id) => idSet.has(id)) ? { ...g, done: g.total } : g)),
                    },
                  },
                },
          ),
        );
      })
      .catch(() => Taro.showToast({ title: "操作失败", icon: "error" }));
  };

  return (
    <View className="page-shell">
      <TopBar title="街坊味" subtitle="桃子的灶台" />
      <View className="px-[32rpx] pb-[260rpx] pt-[32rpx]">
        <Text className="my-[24rpx] block text-center text-[22rpx] text-soft">最近消息</Text>
        {msgs.length === 0 ? (
          <Text className="block py-[24rpx] text-center text-[24rpx] text-muted">
            还没有对话。粘一段接龙，或直接说一句「王燕萍 午餐 2 份」。
          </Text>
        ) : (
          msgs.map((m, i) => {
            const me = m.role === "user";
            const customerConfirmAction = getCustomerConfirmActionState(msgs, i, confirmed);
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
                  {!me && m.card && (
                    <ChatCard
                      card={m.card}
                      confirmed={confirmed.has(i)}
                      confirming={confirming}
                      customerConfirmAction={customerConfirmAction}
                      onConfirm={(editedItems) => confirmCustomers(i, editedItems)}
                      onOrderAct={(orderId, action) => onOrderAct(i, orderId, action)}
                      onMarkDelivered={(ids) => onMarkDelivered(i, ids)}
                    />
                  )}
                  {!me && !m.card && m.cardUnavailable && (
                    <View className="mt-[16rpx] card bg-white p-[24rpx]">
                      <Text className="block text-[26rpx] font-semibold text-ink">卡片数据已过期</Text>
                      <Text className="mt-[10rpx] block text-[24rpx] leading-relaxed text-muted">原始对话仍保留，这张历史卡片无法恢复。</Text>
                    </View>
                  )}
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
