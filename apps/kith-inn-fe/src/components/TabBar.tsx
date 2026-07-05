import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";

/** Bottom nav — 3 tabs (feature 004: 配送并入订单). ponytail: text labels for now
 *  (no icon dep); add @nutui/icons-react-taro glyphs when visual fidelity matters.
 *  Switching uses redirectTo (plain pages, no native tabBar config) — works on both
 *  h5 + weapp. Styled with Tailwind atomic utilities. */
const TABS = [
  { key: "today", label: "今天", path: "/pages/today/index" },
  { key: "menu", label: "菜单", path: "/pages/menu/index" },
  { key: "orders", label: "订单", path: "/pages/orders/index" },
] as const;

export function TabBar({ active }: { active: string }) {
  return (
    <View className="fixed inset-x-0 bottom-0 z-50 flex h-[108rpx] border-t border-line bg-paper">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <View
            key={t.key}
            className="flex flex-1 flex-col items-center justify-center gap-[8rpx]"
            onClick={() => {
              if (!on) Taro.redirectTo({ url: t.path });
            }}
          >
            {on && <View className="h-[12rpx] w-[12rpx] rounded-full bg-red" />}
            <Text className={`text-[24rpx] font-bold ${on ? "text-red" : "text-muted"}`}>{t.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
