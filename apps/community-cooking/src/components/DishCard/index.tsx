import { Text, View } from "@tarojs/components";
import "./index.css";

// 与 CMS 菜谱库的 category 取值对齐（apps/site 的 recipes 集合）。
export type DishCategory = "big-meat" | "small-meat" | "vegetable";

const CATEGORY_LABELS: Record<DishCategory, string> = {
  "big-meat": "大荤",
  "small-meat": "小荤",
  vegetable: "素菜"
};

type DishCardProps = {
  name: string;
  category: DishCategory;
  // 旋转换菜的回调；不传则只展示，不显示换菜按钮。
  onRotate?: () => void;
};

// 领域组件：一道菜。展示用，数据由页面（pages/）通过 props 传入。
export default function DishCard({ name, category, onRotate }: DishCardProps) {
  return (
    <View className="dish-card">
      <Text className={`dish-tag dish-tag--${category}`}>
        {CATEGORY_LABELS[category]}
      </Text>
      <Text className="dish-name">{name}</Text>
      {onRotate ? (
        <Text className="dish-rotate" onClick={onRotate}>
          换一道
        </Text>
      ) : null}
    </View>
  );
}
