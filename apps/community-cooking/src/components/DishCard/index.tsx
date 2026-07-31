import { Button, Text, View } from "@tarojs/components";
import type { RecipeCategory } from "@cfp/weekly-menu-shared";
import "./index.css";

// 分类取值复用 Weekly Menu 共享契约；底层唯一来源仍是 menu-core。
const CATEGORY_LABELS: Record<RecipeCategory, string> = {
  "big-meat": "大荤",
  "small-meat": "小荤",
  vegetable: "素菜"
};

type DishCardProps = {
  name: string;
  category: RecipeCategory;
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
        <Button className="dish-rotate" onClick={onRotate}>
          换一道
        </Button>
      ) : null}
    </View>
  );
}
