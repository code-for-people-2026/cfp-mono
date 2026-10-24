import { Button, Picker, ScrollView, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import type { AuthContext } from "../model";
import { readNavigationLayout } from "./layout";
import { identityEnabled } from "../api";
import { MembershipStatus } from "../membership/MembershipStatus";
import "./navigation.css";

export type DiaryView = "day" | "week" | "month" | "trend" | "list";
type Props = {
  context?: AuthContext | null;
  mode?: DiaryView;
  title?: string;
  open?: boolean;
  busy?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  onSelect?: (view: DiaryView) => void;
  onBabyChange?: (index: number) => void;
  onRefresh?: () => void;
  onSettings?: () => void;
  onLogout?: () => void;
  onAccessRevoked?: () => void;
};

export function DiaryNavigation(props: Props) {
  const [layout, setLayout] = useState(readNavigationLayout);
  useEffect(() => {
    if (process.env.TARO_ENV !== "weapp") return;
    const update = () => setLayout(readNavigationLayout());
    Taro.nextTick(update);
    Taro.onWindowResize(update);
    return () => Taro.offWindowResize(update);
  }, []);
  useEffect(() => {
    if (!props.open || process.env.TARO_ENV !== "h5") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose?.(); };
    document.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", escape); };
  }, [props.open, props.onClose]);
  const context = props.context;
  return <>
    <View className="diary-header" style={layout ? { paddingTop: `${layout.statusBarHeight}px` } : undefined}>
      <View className="diary-navigation-row" style={layout ? { height: `${layout.height}px` } : undefined}>
        {props.onOpen && <Button className="diary-icon-button" ariaLabel="打开菜单" onClick={props.onOpen}><View className="menu-glyph"><View className="menu-glyph-line" /><View className="menu-glyph-line" /><View className="menu-glyph-line menu-glyph-short" /></View></Button>}
        <Text className="diary-title" style={layout ? { left: `${layout.side}px`, right: `${layout.side}px` } : undefined}>{props.title || "卜卜日记"}</Text>
      </View>
    </View>
    {props.open && context && <View className="diary-menu-overlay" catchMove>
      <View className="diary-menu-backdrop" onClick={props.onClose} />
      <View className="diary-drawer" role="dialog" ariaLabel="卜卜日记菜单" style={layout ? { paddingTop: `${layout.statusBarHeight + layout.height + 8}px` } : undefined}>
        <View className="diary-drawer-heading">
          <Text className="diary-drawer-brand">卜卜日记</Text>
          <Button className="diary-icon-button" ariaLabel="关闭菜单" onClick={props.onClose}>×</Button>
        </View>
        <View className="diary-family">
          <View className="diary-avatar">{context.baby?.name.slice(0, 1) || "哺"}</View>
          <View className="diary-family-copy">
            <Text className="diary-menu-caption">正在陪伴</Text>
            {context.babies.length > 1 ? <Picker mode="selector" range={context.babies.map((baby) => baby.name)} value={Math.max(0, context.babies.findIndex((baby) => baby.id === context.baby?.id))} onChange={(event) => props.onBabyChange?.(Number(event.detail.value))}>
              <View className="diary-baby-name">{context.baby?.name || "选择宝宝"}<Text> ⌄</Text></View>
            </Picker> : <Text className="diary-baby-name">{context.baby?.name || "尚未关联宝宝"}</Text>}
          </View>
        </View>
        <ScrollView scrollY className="diary-menu-content">
          {([
            ["day", "日历首页", "看看今天的日常"],
            ["list", "历史数据", "按日期查看全部记录"],
            ["trend", "趋势统计", "睡眠、奶量与尿布的变化"],
          ] as const).map(([mode, label, caption]) => <Button key={mode} className={`diary-menu-link ${(props.mode === mode || (mode === "day" && ["week", "month"].includes(props.mode || ""))) ? "current" : ""}`} onClick={() => props.onSelect?.(mode)}>
            <View><Text className="diary-menu-label">{label}</Text><Text className="diary-menu-caption">{caption}</Text></View><Text className="diary-menu-arrow">›</Text>
          </Button>)}
          {identityEnabled && context.baby && <MembershipStatus key={`${context.identityId}:${context.baby.id}`} babyId={context.baby.id} onAccessRevoked={props.onAccessRevoked} />}
        </ScrollView>
        <View className="diary-menu-footer">
          <Button className="diary-menu-link" onClick={props.onSettings}><View><Text className="diary-menu-label">设置</Text><Text className="diary-menu-caption">宝宝昵称与姓名</Text></View><Text className="diary-menu-arrow">›</Text></Button>
          <View className="diary-menu-utilities">
            <Button className="text-button" onClick={props.onRefresh}>刷新数据</Button>
            <Button className="text-button" disabled={props.busy || undefined} onClick={props.onLogout}>退出登录</Button>
          </View>
        </View>
      </View>
    </View>}
  </>;
}
