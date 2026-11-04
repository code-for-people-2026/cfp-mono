import { Button, Picker, Text, View } from "@tarojs/components";
import { useEffect } from "react";
import { addDays, dateLabel, mondayOfWeek, shortDateLabel, todayKey, weekdayLabel } from "../model";
import type { DiaryView } from "./DiaryNavigation";

const calendarViews = [
  { key: "day", label: "日历" }, { key: "week", label: "周历" }, { key: "month", label: "月历" },
] as const;
type Props = {
  date: string;
  mode: DiaryView;
  days: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onNavigate: (direction: number) => void;
  onDateChange: (date: string) => void;
  onModeChange: (mode: DiaryView) => void;
};

export function CalendarNavigation(props: Props) {
  const { date, mode, days, open, onClose } = props;
  const weekStart = mondayOfWeek(date);
  const calendar = mode !== "list" && mode !== "trend";
  const start = mode === "month" ? addDays(weekStart, -21) : mode === "week" ? weekStart : addDays(date, 1 - days);
  const end = mode === "trend" ? date : addDays(weekStart, 6);
  const label = mode === "day" || mode === "list" ? dateLabel(date) : `${shortDateLabel(start)}–${shortDateLabel(end)}`;
  const subtitle = mode === "day" ? weekdayLabel(date) : mode === "week" ? "周历" : mode === "month" ? "近四周" : mode === "list" ? "历史记录" : "趋势";
  useEffect(() => {
    if (!open || process.env.TARO_ENV !== "h5") return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, onClose]);
  return <View className="calendar-navigation">
    <Button className="calendar-arrow" ariaLabel="上一段日期" onClick={() => props.onNavigate(-1)}>‹</Button>
    <Button className="calendar-date-button" ariaLabel="展开日期与日历视图" onClick={props.onToggle}>
      <View className="date-title"><Text>{label}</Text><Text className="date-dropdown">⌄</Text></View>
      <Text className="date-subtitle">{subtitle}</Text>
    </Button>
    <Button className="calendar-arrow" ariaLabel="下一段日期" disabled={(mode === "week" || mode === "month" ? weekStart >= mondayOfWeek(todayKey()) : date >= todayKey()) || undefined} onClick={() => props.onNavigate(1)}>›</Button>
    {open && <>
      <View className="calendar-view-backdrop" onClick={onClose} catchMove />
      <View className="calendar-view-popover" role="dialog" ariaLabel="日期与日历视图">
        <Text className="calendar-selected-date">{date.replace(/-/g, "/")} · {weekdayLabel(date)}</Text>
        {calendar && calendarViews.map((item) => <Button key={item.key} className={`calendar-view-option ${item.key === mode ? "current" : ""}`} onClick={() => { props.onModeChange(item.key); onClose(); }}>
          <Text>{item.label}</Text>{item.key === mode && <Text>✓</Text>}
        </Button>)}
        <Picker mode="date" value={date} end={todayKey()} onChange={(event) => { props.onDateChange(event.detail.value); onClose(); }}>
          <View className="calendar-view-option calendar-date-picker">选择日期<Text>›</Text></View>
        </Picker>
        <Button className="calendar-view-option" onClick={() => { props.onDateChange(todayKey()); onClose(); }}>回到今天</Button>
      </View>
    </>}
  </View>;
}
