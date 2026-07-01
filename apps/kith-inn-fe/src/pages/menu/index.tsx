import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import { Button, Tag } from "@nutui/nutui-react-taro";
import { TabBar } from "@/components/TabBar";
import { TopBar } from "@/components/TopBar";
import { menuWeekUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";
import { dayLabel, dishChips, formatWeekRange, occasionLabel, type ChipTone, type MenuSlot, type WeekMenu } from "@/logic/menuView";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

/** ChipTone → per-component NutUI Tag override class (sets --nutui-tag-*). */
/** ChipTone → atomic utilities on the NutUI Tag root (direct utilities win;
 *  NutUI Tag has no !important). Sets soft bg + warm text per tone. */
const CHIP_CLASS: Record<ChipTone, string> = {
  red: "bg-red-soft text-red",
  green: "bg-green-soft text-green",
  amber: "bg-amber-soft text-amber",
  blue: "bg-blue-soft text-blue",
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
      .then((res) => {
        // Validate before storing (Codex): a 401 (expired token) returns {error},
        // not a WeekMenu — casting blindly crashes the render on `week.menu.map`.
        if (res.statusCode === 401) {
          tokens.clearToken();
          Taro.redirectTo({ url: "/pages/login/index" });
          return;
        }
        if (res.statusCode !== 200) {
          Taro.showToast({ title: "加载失败", icon: "error" });
          return;
        }
        setWeek(res.data as WeekMenu);
      })
      .catch(() => Taro.showToast({ title: "加载失败", icon: "error" }));
  }, []);

  return (
    <View className="min-h-screen bg-linear-to-b from-paper via-wash to-white text-ink">
      <TopBar title="街坊味" subtitle="桃子的灶台" />
      <View className="px-[32rpx] pb-[200rpx] pt-[32rpx]">
        <View className="mb-[28rpx] flex items-start justify-between gap-[24rpx]">
          <View>
            <Text className="block text-[44rpx] font-bold leading-tight">本周菜单</Text>
            <Text className="mt-[12rpx] block text-[26rpx] text-muted">只从桃子的菜品池里选，主料避开近两天重复。</Text>
          </View>
          <Text className="flex-none rounded-[16rpx] border border-line bg-white px-[20rpx] py-[16rpx] text-[24rpx] font-extrabold">
            {formatWeekRange(new Date())}
          </Text>
        </View>

        {week === null ? (
          <Text className="block text-[24rpx] text-muted">加载中…</Text>
        ) : week.ok === false ? (
          <Text className="block text-[24rpx] text-muted">
            菜品池不够：缺 {week.missing.category}（需 {week.missing.needed} 道，池里只有 {week.missing.available} 道）。
          </Text>
        ) : (
          week.menu.map((slot: MenuSlot) => (
            <View key={`${slot.day}-${slot.occasion}`} className="my-[24rpx] rounded-[16rpx] border border-line bg-surface p-[24rpx]">
              <View className="mb-[20rpx] flex items-center justify-between gap-[20rpx]">
                <Text className="text-[32rpx] font-bold">{dayLabel(slot.day)} · {occasionLabel(slot.occasion)}</Text>
              </View>
              {slot.dishes.map((d) => (
                <View key={String(d.id)} className="border-b border-line py-[20rpx] last:border-b-0">
                  <Text className="text-[26rpx] font-semibold">{d.name}</Text>
                  <View className="mt-[10rpx] flex flex-wrap gap-[12rpx]">
                    {dishChips(d).map((c, i) => (
                      <Tag
                        key={i}
                        className={`inline-flex h-[40rpx] items-center rounded-[8rpx] px-[14rpx] text-[22rpx] leading-none ${CHIP_CLASS[c.tone]}`}
                      >
                        {c.label}
                      </Tag>
                    ))}
                  </View>
                </View>
              ))}
              <View className="mt-[24rpx]">
                <Button type="primary" size="small" className="[background:var(--color-red)] text-white" onClick={() => Taro.showToast({ title: "群文案待生成", icon: "none" })}>
                  发群文案
                </Button>
              </View>
            </View>
          ))
        )}
      </View>

      <TabBar active="menu" />
    </View>
  );
}
