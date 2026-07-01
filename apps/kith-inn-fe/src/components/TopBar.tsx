import { Text, View } from "@tarojs/components";

/** Shared top bar — 味 brand mark + title/subtitle. Used by every tab.
 *  Styled with Tailwind atomic utilities (PR2 #87 rewrite). */
export function TopBar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="flex items-center gap-[24rpx] border-b border-line bg-surface px-[32rpx] pb-[20rpx]">
      <View className="flex h-[68rpx] w-[68rpx] items-center justify-center rounded-[16rpx] bg-red text-[34rpx] font-extrabold text-white">
        味
      </View>
      <View className="min-w-0">
        <Text className="block text-[34rpx] font-bold leading-tight">{title}</Text>
        {subtitle ? <Text className="mt-[6rpx] block text-[22rpx] text-soft">{subtitle}</Text> : null}
      </View>
    </View>
  );
}
