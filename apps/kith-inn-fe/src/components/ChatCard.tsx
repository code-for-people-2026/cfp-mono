import { Text, View } from "@tarojs/components";
import { Button } from "@nutui/nutui-react-taro";
import type { CardPayload } from "@cfp/kith-inn-shared";

const occasionZh = (o: "lunch" | "dinner") => (o === "lunch" ? "午餐" : "晚餐");

/**
 * Renders a structured card attached to an assistant reply (PR1: customer-confirm).
 * The 「都建」 button drives POST /chat/confirm-customers — a deterministic click
 * that replaces the flaky LLM-recall multi-turn confirm (#97). `confirmed` swaps
 * the button for a「已建」chip (the card is one-shot). PR2 will add orders/delivery.
 */
export function ChatCard({ card, confirmed, confirming, onConfirm }: {
  card: CardPayload;
  confirmed: boolean;
  confirming: boolean;
  onConfirm: () => void;
}) {
  if (card.type !== "customer-confirm") return null; // PR2: orders/delivery cards
  return (
    <View className="mt-[16rpx] rounded-[16rpx] border border-line bg-white p-[24rpx]">
      <Text className="block text-[26rpx] font-semibold text-ink">新顾客待建</Text>
      {card.data.items.map((it, i) => (
        <Text key={i} className="mt-[10rpx] block text-[26rpx] text-soft">
          {it.customerName}（{it.address ?? "地址？"}）{it.quantity}份{occasionZh(it.occasion)}
        </Text>
      ))}
      <View className="mt-[20rpx]">
        {confirmed ? (
          <Text className="block text-[24rpx] text-green">已建 ✓</Text>
        ) : (
          <Button size="small" type="primary" loading={confirming} className="[background:var(--color-red)] text-white" onClick={onConfirm}>
            都建
          </Button>
        )}
      </View>
    </View>
  );
}
