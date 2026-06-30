import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import { Button, Tag } from "@nutui/nutui-react-taro";
import { TabBar } from "@/components/TabBar";
import { menuWeekUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";
import { dayLabel, dishChips, formatWeekRange, occasionLabel, type ChipTone, type MenuSlot, type WeekMenu } from "@/logic/menuView";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

/** ChipTone → NutUI Tag type. */
const TONE: Record<ChipTone, "primary" | "success" | "warning" | "danger"> = {
  red: "danger",
  green: "success",
  amber: "warning",
  blue: "primary",
};

export default function Menu() {
  const [week, setWeek] = useState<WeekMenu | null>(null);

  useEffect(() => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    Taro.request({ url: menuWeekUrl(), header: { Authorization: `Bearer ${token}` } })
      .then((res) => setWeek(res.data as WeekMenu))
      .catch(() => Taro.showToast({ title: "加载失败", icon: "error" }));
  }, []);

  return (
    <View style={{ minHeight: "100vh", paddingBottom: "120px" }}>
      <View style={{ padding: "32px 24px 0" }}>
        <Text style={{ fontSize: "44px", fontWeight: "bold" }}>本周菜单</Text>
        <Text style={{ display: "block", color: "#687076", fontSize: "24px", marginTop: "8px" }}>
          只从桃子的菜品池里选，主料避开近两天重复。
        </Text>
        <Text style={{ display: "block", marginTop: "12px", color: "#8a7f70", fontSize: "22px", fontWeight: 700 }}>
          {formatWeekRange(new Date())}
        </Text>
      </View>

      <View style={{ padding: "0 24px" }}>
        {week === null ? (
          <Text style={{ color: "#687076" }}>加载中…</Text>
        ) : week.ok === false ? (
          <Text>
            菜品池不够：缺 {week.missing.category}（需 {week.missing.needed} 道，池里只有 {week.missing.available} 道）。
          </Text>
        ) : (
          week.menu.map((slot: MenuSlot) => (
            <View
              key={`${slot.day}-${slot.occasion}`}
              style={{ margin: "24px 0", padding: "24px", background: "#fff", borderRadius: "16px", border: "1px solid #e6e2da" }}
            >
              <Text style={{ fontSize: "32px", fontWeight: "bold" }}>
                {dayLabel(slot.day)} · {occasionLabel(slot.occasion)}
              </Text>
              {slot.dishes.map((d) => (
                <View key={String(d.id)} style={{ padding: "16px 0", borderBottom: "1px solid #e6e2da" }}>
                  <Text style={{ fontSize: "28px" }}>{d.name}</Text>
                  <View style={{ display: "flex", flexWrap: "wrap", marginTop: "8px" }}>
                    {dishChips(d).map((c, i) => (
                      <View key={i} style={{ marginRight: "8px", marginBottom: "8px" }}>
                        <Tag type={TONE[c.tone]}>{c.label}</Tag>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
              <Button
                type="primary"
                size="small"
                style={{ marginTop: "16px" }}
                onClick={() => Taro.showToast({ title: "群文案待生成", icon: "none" })}
              >
                发群文案
              </Button>
            </View>
          ))
        )}
      </View>

      <TabBar active="menu" />
    </View>
  );
}
