import { Text, View } from "@tarojs/components";
import { Input } from "@tarojs/components";
import { Button, Tag } from "@nutui/nutui-react-taro";
import type { CardPayload, ConfirmCustomerItem } from "@cfp/kith-inn-shared";
import { useState } from "react";
import { CUSTOMER_CONFIRM_ACTION_LABEL, type CustomerConfirmActionState } from "@/logic/chatCards";
import { customerName, orderStatusDot, STATUS_DOT_CLASS, yuan } from "@/logic/ordersView";

const occasionZh = (o: "lunch" | "dinner") => (o === "lunch" ? "午餐" : "晚餐");

/**
 * Renders a structured card attached to an assistant reply.
 * - customer-confirm: lists pending new customers + "全部建档并记单" when active.
 * - orders: today's orders with 确认/标已付 buttons (reuse the orders-tab endpoints).
 * - delivery: today's per-address packing list (read-only).
 * Historical cards are restored snapshots; customer-confirm actions stay one-shot.
 */
export function ChatCard({ card, confirmed = false, confirming, customerConfirmAction, onConfirm, onOrderAct, onMarkDelivered }: {
  card: CardPayload;
  confirmed?: boolean;
  confirming: boolean;
  customerConfirmAction?: CustomerConfirmActionState | null;
  onConfirm: (items?: ConfirmCustomerItem[]) => void;
  onOrderAct?: (orderId: string | number, action: "confirm" | "paid") => void;
  onMarkDelivered?: (ids: Array<string | number>) => void;
}) {
  if (card.type === "customer-confirm") {
    return <CustomerConfirmCard card={card} confirmed={confirmed} confirming={confirming} customerConfirmAction={customerConfirmAction} onConfirm={onConfirm} />;
  }

  if (card.type === "orders") {
    const orders = card.data.orders;
    return (
      <View className="mt-[16rpx] rounded-[16rpx] border border-line bg-white p-[24rpx]">
        <Text className="block text-[26rpx] font-semibold text-ink">今天的订单（{orders.length}）</Text>
        {orders.map((o) => {
          const dot = orderStatusDot(o);
          return (
            <View key={String(o.id)} className="mt-[16rpx] flex items-center gap-[16rpx]">
              <Tag className={`inline-flex h-[48rpx] w-[48rpx] flex-none items-center justify-center rounded-[12rpx] text-[22rpx] font-extrabold ${STATUS_DOT_CLASS[dot.tone]}`}>
                {dot.label}
              </Tag>
              <Text className="min-w-0 flex-1 text-[26rpx] font-semibold">{customerName(o)}</Text>
              <Text className="text-[24rpx] text-muted">{yuan(o.totalCents)}</Text>
              {onOrderAct && o.status === "draft" && (
                <Button size="small" type="primary" className="[background:var(--color-red)] text-white" onClick={() => onOrderAct(o.id, "confirm")}>
                  确认
                </Button>
              )}
              {onOrderAct && o.status === "confirmed" && o.paymentStatus === "unpaid" && (
                <Button size="small" className="[background:var(--color-surface)] text-ink" onClick={() => onOrderAct(o.id, "paid")}>
                  标已付
                </Button>
              )}
            </View>
          );
        })}
      </View>
    );
  }

  if (card.type === "operation-confirm") {
    return (
      <View className="mt-[16rpx] card bg-amber-soft p-[24rpx]">
        <Text className="block text-[26rpx] font-semibold text-amber">{card.data.summary}</Text>
        <Text className="mt-[8rpx] block text-[24rpx] text-muted">点确认后执行</Text>
      </View>
    );
  }

  // delivery
  return (
    <View className="mt-[16rpx] rounded-[16rpx] border border-line bg-white p-[24rpx]">
      <View className="flex items-center justify-between gap-[16rpx]">
        <Text className="text-[26rpx] font-semibold text-ink">今天送餐</Text>
        {card.data.totalPending > 0 && <Text className="text-[24rpx] text-red">还差 {card.data.totalPending} 份</Text>}
      </View>
      {card.data.groups.map((g) => (
        <View key={g.address} className="mt-[16rpx] flex items-center gap-[16rpx]">
          <Text className="flex-1 text-[26rpx] font-semibold">{g.address}</Text>
          <Text className="text-[24rpx] text-muted">{g.count} 份 · {g.done}/{g.total}</Text>
          {onMarkDelivered && g.done < g.total && (
            <Button size="small" type="primary" className="[background:var(--color-green)] text-white" onClick={() => onMarkDelivered(g.ids)}>
              送达
            </Button>
          )}
        </View>
      ))}
    </View>
  );
}

/** Customer-confirm card with editable address inputs (PRD US-OI05: new customers need address). */
function CustomerConfirmCard({ card, confirmed, confirming, customerConfirmAction, onConfirm }: {
  card: Extract<CardPayload, { type: "customer-confirm" }>;
  confirmed: boolean;
  confirming: boolean;
  customerConfirmAction?: CustomerConfirmActionState | null;
  onConfirm: (items?: ConfirmCustomerItem[]) => void;
}) {
  const initial = card.data.items.map((it) => ({ ...it }));
  const [items, setItems] = useState<ConfirmCustomerItem[]>(initial);
  const action = customerConfirmAction ?? (
    confirmed
      ? { status: "confirmed" as const, label: CUSTOMER_CONFIRM_ACTION_LABEL, message: "已建" }
      : { status: "active" as const, label: CUSTOMER_CONFIRM_ACTION_LABEL }
  );

  const updateAddr = (i: number, addr: string) => {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, address: addr } : it)));
  };

  return (
    <View className="mt-[16rpx] rounded-[16rpx] border border-line bg-white p-[24rpx]">
      <Text className="block text-[26rpx] font-semibold text-ink">新顾客待建（填地址后确认）</Text>
      {items.map((it, i) => (
        <View key={i} className="mt-[16rpx]">
          <Text className="block text-[26rpx] text-soft">{it.customerName} · {it.quantity}份{occasionZh(it.occasion)}</Text>
          {action.status === "active" ? (
            <Input
              value={it.address ?? ""}
              placeholder="填地址（如 3a27a）"
              onInput={(e) => updateAddr(i, e.detail.value)}
              className="mt-[8rpx] rounded-[8rpx] border border-line bg-paper px-[16rpx] py-[10rpx] text-[26rpx]"
            />
          ) : (
            <Text className="mt-[4rpx] block text-[24rpx] text-muted">{it.address ?? "（未填）"}</Text>
          )}
        </View>
      ))}
      <View className="mt-[20rpx]">
        {action.status === "confirmed" && <Text className="block text-[24rpx] text-green">{action.message} ✓</Text>}
        {action.status === "stale" && <Text className="block text-[24rpx] leading-relaxed text-muted">{action.message}</Text>}
        {action.status === "active" && (
          <Button size="small" type="primary" loading={confirming} className="bg-red text-white" onClick={() => onConfirm(items)}>
            {action.label}
          </Button>
        )}
      </View>
    </View>
  );
}
