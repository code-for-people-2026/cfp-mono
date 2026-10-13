import { readNavigationLayout } from "./navigation-layout";
import { useState, type ReactNode } from "react";
import { Button as TaroButton, type ButtonProps, ScrollView, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import "./settings-page.css";

export function PageButton(props: ButtonProps) {
  return <TaroButton {...props} disabled={props.disabled || undefined} className={`control page-button ${props.className || ""}`} />;
}

export function PageIcon({ kind }: { kind: "close" | "refresh" | "back" | "arrow" }) {
  return <View aria-hidden className={`page-icon page-icon-${kind}`} />;
}

export function leavePage() {
  if (Taro.getCurrentPages().length > 1) void Taro.navigateBack();
  else void Taro.reLaunch({ url: "/pages/chat/index" });
}

export function SettingsPage({ title, children, back = false, onRefresh, refreshing = false, scrollIntoView }: {
  title: string; children: ReactNode; back?: boolean; onRefresh?: () => void; refreshing?: boolean; scrollIntoView?: string;
}) {
  const [layout] = useState(readNavigationLayout);
  return <View className="privacy-settings-page">
    <View className="page-header" style={layout ? { paddingTop: `${layout.statusBarHeight}px`, paddingRight: `${layout.side}px`, paddingBottom: 0, minHeight: `${layout.statusBarHeight + layout.height}px` } : undefined}>
      {back && <PageButton className="page-icon-button page-back" aria-label="返回上一级" onClick={leavePage}><PageIcon kind="back" /></PageButton>}
      <Text className="page-title">{title}</Text>
      <View className="page-header-actions">
        {onRefresh && <PageButton className={`page-icon-button ${refreshing ? "is-refreshing" : ""}`} aria-label="刷新受理记录" disabled={refreshing} onClick={onRefresh}><PageIcon kind="refresh" /></PageButton>}
        {!back && <PageButton className="page-icon-button" aria-label={`关闭${title}`} onClick={leavePage}><PageIcon kind="close" /></PageButton>}
      </View>
    </View>
    <ScrollView scrollY scrollIntoView={scrollIntoView} scrollWithAnimation className="page-scroll"><View className="page-content">{children}</View></ScrollView>
  </View>;
}

export function SettingsRow({ title, description, detail, danger = false, onClick }: {
  title: string; description?: string; detail?: string; danger?: boolean; onClick: () => void;
}) {
  return <PageButton className={`page-row ${danger ? "page-row-danger" : ""}`} onClick={onClick}>
    <View className="page-row-copy"><Text className="page-row-title">{title}</Text>{description && <Text className="page-row-description">{description}</Text>}</View>
    {detail && <Text className="page-row-detail">{detail}</Text>}<PageIcon kind="arrow" />
  </PageButton>;
}
