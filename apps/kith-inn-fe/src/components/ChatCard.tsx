import { Text, View } from "@tarojs/components";
import { Input } from "@tarojs/components";
import { Button, Tag } from "@nutui/nutui-react-taro";
import type { CardPayload, ConfirmCustomerItem } from "@cfp/kith-inn-shared";
import { useState } from "react";
import { customerName, orderStatusDot, STATUS_DOT_CLASS, yuan } from "@/logic/ordersView";

const occasionZh = (o: "lunch" | "dinner") => (o === "lunch" ? "午餐" : "晚餐");

/**
 * Renders a structured card attached to an assistant reply.
 * - operation-confirm: write-op preview + 「确认」button (record_orders lists items
 *   with address inputs for new customers). One-shot: historical cards go read-only.
 * - orders: today's orders with 确认/标已付 buttons (reuse the orders-tab endpoints).
 * - delivery: today's per-address packing list (read-only).
 */
export function ChatCard({ card, confirmed = false, confirming, fromHistory, onConfirmOperation, onOrderAct, onMarkDelivered }: {
  card: CardPayload;
  confirmed?: boolean;
  confirming: boolean;
  fromHistory?: boolean;
  onConfirmOperation?: (items?: ConfirmCustomerItem[]) => void;
  onOrderAct?: (orderId: string | number, action: "confirm" | "paid") => void;
  onMarkDelivered?: (ids: Array<string | number>) => void;
}) {
  if (card.type === "operation-confirm") {
    if (card.data.toolName === "record_orders") {
      return (
        <RecordOrdersConfirmCard
          card={card}
          confirmed={confirmed}
          confirming={confirming}
          fromHistory={fromHistory}
          onConfirmOperation={onConfirmOperation}
        />
      );
    }
    const active = !confirmed && !fromHistory && onConfirmOperation;
    return (
      <View className="mt-[16rpx] card bg-amber-soft p-[24rpx]">
        <Text className="block text-[28rpx] font-semibold text-amber">{card.data.summary}</Text>
        <View className="mt-[16rpx]">
          {confirmed && <Text className="block text-[26rpx] text-green">已处理 ✓</Text>}
          {!confirmed && fromHistory && <Text className="block text-[24rpx] text-muted">这张确认卡已过期</Text>}
          {active && (
            <Button type="primary" disabled={confirming} className={confirming ? "bg-surface text-muted" : "bg-amber text-white"} onClick={() => onConfirmOperation?.()}>
              {confirming ? "处理中..." : "确认"}
            </Button>
          )}
        </View>
      </View>
    );
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

/** operation-confirm card for record_orders: lists every parsed item, with an
 *  address input for each NEW customer (isNew[i]). One 确认 builds all (#126 US1). */
function RecordOrdersConfirmCard({ card, confirmed, confirming, fromHistory, onConfirmOperation }: {
  card: Extract<CardPayload, { type: "operation-confirm" }>;
  confirmed: boolean;
  confirming: boolean;
  fromHistory?: boolean;
  onConfirmOperation?: (items?: ConfirmCustomerItem[]) => void;
}) {
  const args = card.data.args as { items: ConfirmCustomerItem[]; isNew: boolean[] };
  const [items, setItems] = useState<ConfirmCustomerItem[]>(args.items.map((it) => ({ ...it })));
  const active = !confirmed && !fromHistory && !!onConfirmOperation;
  const updateAddr = (i: number, addr: string) => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, address: addr } : it)));
  return (
    <View className="mt-[16rpx] card bg-amber-soft p-[24rpx]">
      <Text className="block text-[28rpx] font-semibold text-amber">{card.data.summary}</Text>
      {items.map((it, i) => (
        <View key={i} className="mt-[12rpx]">
          <Text className="block text-[26rpx] text-soft">
            {it.customerName} · {it.quantity}份{occasionZh(it.occasion)}{args.isNew[i] ? " · 新顾客" : ""}
          </Text>
          {active && args.isNew[i] ? (
            <Input
              value={it.address ?? ""}
              placeholder="填地址（如 3a27a）"
              onInput={(e) => updateAddr(i, e.detail.value)}
              className="mt-[8rpx] rounded-[8rpx] border border-line bg-paper px-[16rpx] py-[10rpx] text-[26rpx]"
            />
          ) : (
            args.isNew[i] && <Text className="mt-[4rpx] block text-[24rpx] text-muted">{it.address ?? "（未填）"}</Text>
          )}
        </View>
      ))}
      <View className="mt-[20rpx]">
        {confirmed && <Text className="block text-[26rpx] text-green">已记为草稿 ✓</Text>}
        {!confirmed && fromHistory && <Text className="block text-[24rpx] text-muted">这张确认卡已过期</Text>}
        {active && (
          <Button type="primary" disabled={confirming} className={confirming ? "bg-surface text-muted" : "bg-amber text-white"} onClick={() => onConfirmOperation?.(items)}>
            {confirming ? "记录中..." : "记为草稿"}
          </Button>
        )}
      </View>
    </View>
  );
}
