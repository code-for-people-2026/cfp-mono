import { Text, View } from "@tarojs/components";
import type { RecipeCategory } from "@cfp/weekly-menu-shared";
import ScreenContainer from "@/components/ScreenContainer";
import DishCard from "@/components/DishCard";
import "./index.css";

// 骨架占位数据，仅用于展示页面结构。
// TODO(#317): 改由 Weekly Menu API adapter 提供数据；小程序不得直连 website Payload。
const PLACEHOLDER_MEALS: { name: string; category: RecipeCategory }[] = [
  { name: "红烧肉", category: "big-meat" },
  { name: "青椒土豆丝", category: "small-meat" },
  { name: "蒜蓉西兰花", category: "vegetable" }
];

export default function MenuPage() {
  return (
    <ScreenContainer>
      <Text className="menu-title">本周菜单</Text>
      <Text className="menu-hint">骨架预览 —— 待接入菜谱库与生成逻辑</Text>
      <View className="menu-day">
        <Text className="menu-day-label">周一 · 午餐</Text>
        {PLACEHOLDER_MEALS.map((dish) => (
          <DishCard key={dish.name} name={dish.name} category={dish.category} />
        ))}
      </View>
    </ScreenContainer>
  );
}
