import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";

/** Bottom nav — 4 tabs. ponytail: text labels for now (no icon dep); add
 *  @nutui/icons-react-taro glyphs when visual fidelity matters. Switching uses
 *  redirectTo (plain pages, no native tabBar config) — works on both h5 + weapp.
 *
 *  PR1 (#87): restyled to Tailwind utilities as the de-risk proof — utilities +
 *  a @layer component class (.nav-tab) + a decimal class (h-1.5 w-1.5 active dot)
 *  must render on both h5 and weapp (the #579 decimal-class failure mode). */
const TABS = [
  { key: "today", label: "今天", path: "/pages/today/index" },
  { key: "menu", label: "菜单", path: "/pages/menu/index" },
  { key: "orders", label: "订单", path: "/pages/orders/index" },
  { key: "delivery", label: "送餐", path: "/pages/delivery/index" },
] as const;

export function TabBar({ active }: { active: string }) {
  return (
    <View className="fixed inset-x-0 bottom-0 z-50 flex h-[100px] border-t border-line bg-paper">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <View
            key={t.key}
            className="nav-tab"
            onClick={() => {
              if (!on) Taro.redirectTo({ url: t.path });
            }}
          >
            {on && <View className="h-1.5 w-1.5 rounded-full bg-red" />}
            <Text className={`text-[24px] font-bold ${on ? "text-red" : "text-muted"}`}>
              {t.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
