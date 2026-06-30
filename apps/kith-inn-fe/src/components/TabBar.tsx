import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";

/** The 4 top-level tabs. ponytail: text-only for now (no icon dep); add
 *  @nutui/icons-react-taro glyphs when visual fidelity matters. Switching uses
 *  redirectTo (plain pages, no native tabBar config) — works on both h5 + weapp. */
const TABS = [
  { key: "today", label: "今天", path: "/pages/today/index" },
  { key: "menu", label: "菜单", path: "/pages/menu/index" },
  { key: "orders", label: "订单", path: "/pages/orders/index" },
  { key: "delivery", label: "送餐", path: "/pages/delivery/index" },
] as const;

export function TabBar({ active }: { active: string }) {
  return (
    <View style={{ position: "fixed", bottom: 0, left: 0, right: 0, borderTop: "1px solid #e6e2da", background: "#fffdf7" }}>
      <View style={{ display: "flex", height: "100px" }}>
        {TABS.map((t) => {
          const on = t.key === active;
          return (
            <View
              key={t.key}
              onClick={() => {
                if (!on) Taro.redirectTo({ url: t.path });
              }}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: on ? "#d7462f" : "#687076",
                fontSize: "24px",
                fontWeight: 700,
              }}
            >
              <Text>{t.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
