import { Text, View } from "@tarojs/components";
import type { Category, MenuPreview } from "@cfp/kith-inn-contracts";
import { Button } from "./button";

export type DishPosition = { meal: number; category: Category; index: number };
export const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export function firstPosition(menu: MenuPreview): DishPosition | null {
  for (const [meal, value] of menu.meals.entries()) {
    if (!value.enabled) continue;
    for (const category of ["meat", "vegetable", "soup"] as const) {
      if (value[category].length && !(category === "soup" && value.soupOmitted)) return { meal, category, index: 0 };
    }
  }
  return null;
}
export function WeekBoard({ menu, selected, showAll, disabled, onSelect, onFilter }: {
  menu: MenuPreview; selected: DishPosition | null; showAll: boolean; disabled: boolean;
  onSelect: (position: DishPosition) => void; onFilter: (all: boolean) => void;
}) {
  const categories: Category[] = showAll ? ["meat", "vegetable", "soup"] : ["meat"];
  const rows = Math.max(1, categories.reduce((count, category) => count + menu.structure[category], 0));
  const height = rows * 43 + (rows - 1) * 7;
  return <View className="weekly-menu-board week-plans">
    <View className="board-head"><Text>一周菜单</Text><View className="board-filter"><Text>筛选</Text>
      <Button ariaPressed={!showAll} className={!showAll ? "active" : ""} disabled={disabled} onClick={() => onFilter(false)}>荤菜</Button>
      <Button ariaPressed={showAll} className={showAll ? "active" : ""} disabled={disabled} onClick={() => onFilter(true)}>全部</Button>
    </View></View>
    <View className="weekly-menu-grid">
      <View className="meal-axis"><View className="axis-spacer" />{["午饭", "晚饭"].map((name) => <View key={name} style={{ height: `${height}px` }}><Text>{name}</Text></View>)}</View>
      <View className="day-carousel" ariaLabel="周一至周日菜单，左右滑动查看更多日期">{weekdays.map((day, dayIndex) => <View className="day-column" key={day}>
        <View className="column-head"><Text>{day}</Text><Text>{Number(menu.meals[dayIndex * 2]!.date.slice(5, 7))}/{Number(menu.meals[dayIndex * 2]!.date.slice(8))}</Text></View>
        {[dayIndex * 2, dayIndex * 2 + 1].map((mealIndex) => {
          const meal = menu.meals[mealIndex]!;
          return <View className="meal-cells" key={mealIndex} style={{ height: `${height}px` }}>
            {!meal.enabled ? <Button className="empty-meal" disabled={disabled} ariaLabel={`${day}${mealIndex % 2 ? "晚餐" : "午餐"}：不安排`} onClick={() => onSelect({ meal: mealIndex, category: "meat", index: 0 })}>不安排</Button>
              : categories.flatMap((category) => Array.from({ length: menu.structure[category] }, (_, index) => {
                const dish = meal[category][index];
                const omitted = category === "soup" && meal.soupOmitted;
                const active = selected?.meal === mealIndex && selected.category === category && selected.index === index;
                return <Button key={`${category}-${index}`} className={`dish-cell ${category} ${active ? "selected" : ""} ${omitted ? "omitted" : ""}`}
                  ariaLabel={`${day}${mealIndex % 2 ? "晚餐" : "午餐"}：${omitted ? "本餐去汤" : dish?.name}`} ariaPressed={active} disabled={disabled}
                  onClick={() => onSelect({ meal: mealIndex, category, index })}><Text>{omitted ? "本餐去汤" : dish?.name}</Text></Button>;
              }))}
            {meal.enabled && !showAll && !menu.structure.meat && <Button className="empty-meal" disabled={disabled} onClick={() => onFilter(true)}>无荤菜 · 查看全部</Button>}
          </View>;
        })}
      </View>)}</View>
    </View><Text className="board-hint">左右滑动查看七天 · 点一道菜再调整</Text>
  </View>;
}
