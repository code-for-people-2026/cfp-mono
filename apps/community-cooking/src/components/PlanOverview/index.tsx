import { Text, View } from "@tarojs/components";
import {
  type DishSlot,
  type RecipeCategory,
  type ReplaceDishInput,
  type WeeklyMenuPlanDto
} from "@cfp/weekly-menu-shared";
import DishCard from "@/components/DishCard";
import "./index.css";

const DISHES: readonly {
  slot: DishSlot;
  category: RecipeCategory;
}[] = [
  { slot: "bigMeat", category: "big-meat" },
  { slot: "smallMeat", category: "small-meat" },
  { slot: "vegetable", category: "vegetable" }
];

type PlanOverviewProps = {
  plan: WeeklyMenuPlanDto;
  onRotate?: (input: ReplaceDishInput) => void;
};

export default function PlanOverview({ plan, onRotate }: PlanOverviewProps) {
  return (
    <View>
      {plan.days.map((day, dayIndex) => (
        <View className="plan-day" key={day.day}>
          <Text className="plan-day-label">{day.day}</Text>
          {day.meals.map((meal, mealIndex) => (
            <View className="plan-meal" key={meal.label}>
              <Text className="plan-meal-label">{meal.label}</Text>
              {DISHES.map(({ slot, category }) => (
                <DishCard
                  key={slot}
                  name={meal[slot]}
                  category={category}
                  onRotate={
                    onRotate
                      ? () => onRotate({ dayIndex, mealIndex, slot })
                      : undefined
                  }
                />
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
