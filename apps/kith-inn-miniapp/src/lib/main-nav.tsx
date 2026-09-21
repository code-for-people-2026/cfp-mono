import { Image, Text, View } from "@tarojs/components";
import { Button } from "./button";
import weekIcon from "../assets/nav-week.svg";
import dishesIcon from "../assets/nav-dishes.svg";
import historyIcon from "../assets/nav-history.svg";

const tabs = [
  { page: "week", label: "排菜单", icon: weekIcon },
  { page: "dishes", label: "菜品池", icon: dishesIcon },
  { page: "history", label: "历史", icon: historyIcon },
] as const;
export type MainPage = typeof tabs[number]["page"];
export function MainNav({ active, disabled, onNavigate }: { active: MainPage; disabled?: boolean; onNavigate: (page: MainPage) => void }) {
  return <View className="main-nav" ariaLabel="主导航">{tabs.map((tab) => <Button key={tab.page}
    className={tab.page === active ? "nav-item active" : "nav-item"} ariaPressed={tab.page === active}
    disabled={disabled} onClick={() => { if (tab.page !== active) onNavigate(tab.page); }}>
    <Image src={tab.icon} className="nav-icon" mode="scaleToFill" /><Text>{tab.label}</Text>
  </Button>)}</View>;
}
