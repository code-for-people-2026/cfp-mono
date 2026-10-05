import { useState, type PropsWithChildren } from "react";
import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";

// One page header on both targets; WeChat only adds the system status-bar inset.
export function PageHeading({ title, children }: PropsWithChildren<{ title: string }>) {
  const [statusBarHeight] = useState(() => process.env.TARO_ENV === "weapp" ? Taro.getWindowInfo().statusBarHeight ?? 0 : 0);
  return <View className="page-heading" style={{ paddingTop: `${statusBarHeight}px` }}>
    <View className="app-heading flow-heading">{children}<Text className="heading-title">{title}</Text></View>
  </View>;
}
