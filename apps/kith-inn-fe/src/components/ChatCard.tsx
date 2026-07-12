import { Text, View } from "@tarojs/components";
import { Input } from "@tarojs/components";
import { Button, Tag } from "@nutui/nutui-react-taro";
import type { CardPayload, OrderReconciliationPreview } from "@cfp/kith-inn-shared";
import { useState } from "react";
import { customerName, orderStatusDot, STATUS_DOT_CLASS, yuan } from "@/logic/ordersView";
import { orderReconciliationLine } from "@/logic/orderConfirmView";

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
  onConfirmOperation?: (items?: Array<{ address?: string }>) => void;
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
 *  address input for each newCustomer candidate. One confirmation applies the reconciliation. */
function RecordOrdersConfirmCard({ card, confirmed, confirming, fromHistory, onConfirmOperation }: {
  card: Extract<CardPayload, { type: "operation-confirm" }>;
  confirmed: boolean;
  confirming: boolean;
  fromHistory?: boolean;
  onConfirmOperation?: (items?: Array<{ address?: string }>) => void;
}) {
  const raw = card.data.args as Partial<OrderReconciliationPreview>;
  const supported = Array.isArray(raw.candidates) && Array.isArray(raw.rows);
  const candidates = supported ? raw.candidates! : [];
  const rows = supported ? raw.rows! : [];
  const increment = raw.mode === "increment";
  const [addresses, setAddresses] = useState<Array<{ address?: string }>>(candidates.map((candidate) => ({ address: candidate.newCustomer?.address })));
  const active = !confirmed && !fromHistory && !!onConfirmOperation;
  const updateAddr = (i: number, address: string) => setAddresses((prev) => prev.map((item, idx) => idx === i ? { address } : item));
  if (!supported) {
    return (
      <View className="mt-[16rpx] card bg-amber-soft p-[24rpx]">
        <Text className="block text-[28rpx] font-semibold text-amber">{card.data.summary}</Text>
        <Text className="mt-[12rpx] block text-[24rpx] text-muted">这张旧版确认卡已过期，请重新粘贴接龙</Text>
      </View>
    );
  }
  return (
    <View className="mt-[16rpx] card bg-amber-soft p-[24rpx]">
      <Text className="block text-[28rpx] font-semibold text-amber">{card.data.summary}</Text>
      {rows.map((row, i) => (
        <View key={i} className="mt-[12rpx]">
          <Text className="block text-[26rpx] text-soft">
            {orderReconciliationLine(row, increment ? raw.operation : undefined)}
          </Text>
        </View>
      ))}
      {candidates.map((candidate, i) => candidate.newCustomer && (
        <View key={`new-${i}`} className="mt-[12rpx]">
          <Text className="block text-[24rpx] text-muted">{candidate.newCustomer.displayName} · 新顾客</Text>
          {active ? (
            <Input
              value={addresses[i]?.address ?? ""}
              placeholder="填地址（如 3a27a）"
              onInput={(e) => updateAddr(i, e.detail.value)}
              className="mt-[8rpx] rounded-[8rpx] border border-line bg-paper px-[16rpx] py-[10rpx] text-[26rpx]"
            />
          ) : (
            <Text className="mt-[4rpx] block text-[24rpx] text-muted">{addresses[i]?.address ?? "（未填）"}</Text>
          )}
        </View>
      ))}
      <View className="mt-[20rpx]">
        {confirmed && <Text className="block text-[26rpx] text-green">{increment ? "已完成单独补单 ✓" : "已按本次接龙更新 ✓"}</Text>}
        {!confirmed && fromHistory && <Text className="block text-[24rpx] text-muted">这张确认卡已过期</Text>}
        {active && (
          <Button type="primary" disabled={confirming} className={confirming ? "bg-surface text-muted" : "bg-amber text-white"} onClick={() => onConfirmOperation?.(addresses)}>
            {confirming ? "更新中..." : increment ? "确认补单" : "确认按本次更新"}
          </Button>
        )}
      </View>
    </View>
  );
}
