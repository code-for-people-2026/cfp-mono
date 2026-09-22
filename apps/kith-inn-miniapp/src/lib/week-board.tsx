import { useEffect, useId, useRef, useState } from "react";
import { ScrollView, Text, View } from "@tarojs/components";
import type { Category, MenuPreview } from "@cfp/kith-inn-contracts";
import { Button } from "./button";

export type DishPosition = { meal: number; category: Category; index: number };
export const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export function weekRange(menu: { weekStart: string; meals: { date: string }[] }, includeYear = false): string {
  const start = menu.weekStart, end = menu.meals[13]!.date;
  const crossYear = start.slice(0, 4) !== end.slice(0, 4);
  return `${includeYear || crossYear ? `${start.slice(0, 4)}年` : ""}${Number(start.slice(5, 7))}月${Number(start.slice(8))}日—${crossYear ? `${end.slice(0, 4)}年` : ""}${start.slice(0, 7) === end.slice(0, 7) ? "" : `${Number(end.slice(5, 7))}月`}${Number(end.slice(8))}日`;
}
export function firstPosition(menu: MenuPreview): DishPosition | null {
  for (const [meal, value] of menu.meals.entries()) {
    if (!value.enabled) continue;
    for (const category of ["meat", "vegetable", "soup"] as const) {
      if (value[category].length && !(category === "soup" && value.soupOmitted)) return { meal, category, index: 0 };
    }
  }
  return null;
}
export function WeekBoard({ menu, selected = null, showAll = true, disabled = false, onSelect, onFilter, readonly = false, showMealCount = true }: {
  menu: MenuPreview; selected?: DishPosition | null; showAll?: boolean; disabled?: boolean; readonly?: boolean; showMealCount?: boolean;
  onSelect?: (position: DishPosition) => void; onFilter?: (all: boolean) => void;
}) {
  const scrollId = useId(), [scrollLeft, setScrollLeft] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const settling = useRef<ReturnType<typeof setTimeout>>(), touching = useRef(false);
  const lastScroll = useRef({ scrollLeft: 0, scrollWidth: 0 });
  function settle() {
    clearTimeout(settling.current);
    if (process.env.TARO_ENV === "h5" || touching.current) return;
    // Native scroll-view has no CSS snap. Seven equal columns include six 8px gaps.
    const { scrollLeft: left, scrollWidth: width } = lastScroll.current;
    if (width) setScrollLeft(Math.min(5, Math.max(0, Math.round(left / ((width + 8) / 7)))) * ((width + 8) / 7));
  }
  function endTouch() { touching.current = false; clearTimeout(settling.current); settling.current = setTimeout(settle, 180); }
  useEffect(() => {
    if (process.env.TARO_ENV !== "h5") return () => clearTimeout(settling.current);
    const element = document.getElementById(scrollId)!;
    const updateEdge = () => { element.closest(".weekly-menu-board")?.classList.toggle("scroll-at-end", element.scrollLeft + element.clientWidth >= element.scrollWidth - 2); };
    element.addEventListener("scroll", updateEdge);
    updateEdge();
    let start: { x: number; left: number; pointer: number } | null = null, moved = false;
    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button === 0) { start = { x: event.clientX, left: element.scrollLeft, pointer: event.pointerId }; moved = false; }
    };
    const move = (event: PointerEvent) => {
      if (!start) return;
      if (!event.buttons) { finish(); return; }
      const distance = event.clientX - start.x;
      if (!moved && Math.abs(distance) < 5) return;
      moved = true; element.setPointerCapture(start.pointer); element.classList.add("dragging");
      event.preventDefault(); element.scrollLeft = start.left - distance;
    };
    const finish = () => {
      if (start && element.hasPointerCapture(start.pointer)) element.releasePointerCapture(start.pointer);
      start = null; element.classList.remove("dragging");
    };
    const click = (event: MouseEvent) => { if (moved) { event.preventDefault(); event.stopPropagation(); moved = false; } };
    element.addEventListener("pointerdown", down); element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", finish); element.addEventListener("pointercancel", finish); element.addEventListener("click", click, true);
    return () => {
      element.removeEventListener("scroll", updateEdge);
      element.removeEventListener("pointerdown", down); element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", finish); element.removeEventListener("pointercancel", finish); element.removeEventListener("click", click, true);
    };
  }, [scrollId]);
  const categories: Category[] = showAll ? ["meat", "vegetable", "soup"] : ["meat"];
  // Taro's H5 adapter assigns even undefined props to the DOM; scrollLeft = undefined resets to 0.
  const scrollPosition = process.env.TARO_ENV === "h5" ? {} : { scrollLeft, scrollWithAnimation: true };
  const rows = Math.max(1, categories.reduce((count, category) => count + menu.structure[category], 0));
  // Keep readonly long names complete and align the same slot across all seven days.
  const rowHeights = categories.flatMap((category) => Array.from({ length: menu.structure[category] }, (_, index) => readonly
    ? Math.max(48, ...menu.meals.map((meal) => Math.ceil((meal[category][index]?.name.length ?? 0) / 4) * 17 + 14)) : 48));
  const height = rowHeights.reduce((sum, row) => sum + row, 0) + (rows - 1) * 7 || 48;
  return <View className={`weekly-menu-board week-plans ${readonly ? "readonly-board" : ""} ${atEnd ? "scroll-at-end" : ""}`} ariaLabel={readonly ? "只读菜单表格" : "编辑菜单表格"}>
    <View className="board-head"><View>{!readonly && <Text className="board-date">{weekRange(menu)}</Text>}<Text className="board-title">{readonly ? "菜单明细" : `7 天 ${menu.meals.filter((meal) => meal.enabled).length} 餐菜单`}</Text></View>{onFilter && <View className="board-filter">
      <Button ariaPressed={!showAll} className={!showAll ? "active" : ""} disabled={disabled} onClick={() => onFilter?.(false)}>荤菜</Button>
      <Button ariaPressed={showAll} className={showAll ? "active" : ""} disabled={disabled} onClick={() => onFilter?.(true)}>全部</Button>
    </View>}{readonly && showMealCount && <Text className="board-count">7 天 · {menu.meals.filter((meal) => meal.enabled).length} 餐</Text>}</View>
    <View className="weekly-menu-grid">
      <View className="meal-axis"><View className="axis-spacer" />{["午饭", "晚饭"].map((name) => <View key={name} style={{ height: `${height}px` }}><Text>{name}</Text></View>)}</View>
      <ScrollView id={scrollId} scrollX enhanced showScrollbar={false} {...scrollPosition} className="day-scroll"
        onTouchStart={() => { touching.current = true; clearTimeout(settling.current); }} onTouchEnd={endTouch} onTouchCancel={endTouch}
        onScrollToLower={() => { if (process.env.TARO_ENV !== "h5") setAtEnd(true); }} onScrollEnd={settle} onScroll={(event) => { if (process.env.TARO_ENV === "h5") return; if (event.detail.scrollLeft < lastScroll.current.scrollLeft) setAtEnd(false); lastScroll.current = event.detail; setScrollLeft(event.detail.scrollLeft); clearTimeout(settling.current); settling.current = setTimeout(settle, 180); }}><View className="day-carousel" ariaLabel="周一至周日菜单，左右滑动查看更多日期">{weekdays.map((day, dayIndex) => <View className="day-column" key={day}>
        <View className="column-head"><Text>{day}</Text><Text>{Number(menu.meals[dayIndex * 2]!.date.slice(5, 7))}/{Number(menu.meals[dayIndex * 2]!.date.slice(8))}</Text></View>
        {[dayIndex * 2, dayIndex * 2 + 1].map((mealIndex) => {
          const meal = menu.meals[mealIndex]!;
          return <View className="meal-cells" key={mealIndex} style={{ height: `${height}px`, gridTemplateRows: rowHeights.map((row) => `${row}px`).join(" ") }}>
            {!meal.enabled ? <Button className="empty-meal" disabled={disabled || readonly} ariaLabel={`${day}${mealIndex % 2 ? "晚餐" : "午餐"}：不安排`} onClick={() => onSelect?.({ meal: mealIndex, category: "meat", index: 0 })}>不安排</Button>
              : categories.flatMap((category) => Array.from({ length: menu.structure[category] }, (_, index) => {
                const dish = meal[category][index];
                const omitted = category === "soup" && meal.soupOmitted;
                const active = selected?.meal === mealIndex && selected.category === category && selected.index === index;
                if (readonly) return <View key={`${category}-${index}`} className={`dish-cell ${category} ${omitted ? "omitted" : ""}`}><Text selectable>{omitted ? "本餐不做汤" : dish?.name}</Text></View>;
                return <Button key={`${category}-${index}`} className={`dish-cell ${category} ${active ? "selected" : ""} ${omitted ? "omitted" : ""}`}
                  ariaLabel={`${day}${mealIndex % 2 ? "晚餐" : "午餐"}：${omitted ? "本餐不做汤" : dish?.name}`} ariaPressed={active} disabled={disabled}
                  onClick={() => onSelect?.({ meal: mealIndex, category, index })}><Text>{omitted ? "本餐不做汤" : dish?.name}</Text></Button>;
              }))}
            {meal.enabled && !showAll && !menu.structure.meat && <Button className="empty-meal" disabled={disabled} onClick={() => onFilter?.(true)}>无荤菜 · 查看全部</Button>}
          </View>;
        })}
      </View>)}</View></ScrollView>
    </View>
  </View>;
}
