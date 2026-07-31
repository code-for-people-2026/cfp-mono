import { useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { Button, Text, View } from "@tarojs/components";
import ScreenContainer from "@/components/ScreenContainer";
import {
  weeklyMenuClient,
  type WeeklyMenuSession
} from "@/lib/weekly-menu-client";
import "./index.css";

export default function IndexPage() {
  const [session, setSession] = useState<WeeklyMenuSession | null>(null);

  useDidShow(() => {
    void weeklyMenuClient.restoreSession().then(setSession);
  });

  async function login() {
    setSession(await weeklyMenuClient.login());
  }

  return (
    <ScreenContainer>
      <Text className="eyebrow">Code for People</Text>
      <Text className="title">Weekly Menu</Text>
      <Text className="body">
        规划一周午餐和晚餐，确认后从历史复制，也可以按菜名逐项备菜核对。
      </Text>
      {!session ? (
        <View className="login-card">
          <Text className="mock-badge">Mock 模式</Text>
          <Text className="login-hint">
            当前仅使用本地学习身份，不调用 wx.login，也不发送网络请求。
          </Text>
          <Button className="primary-button" onClick={() => void login()}>
            Mock 登录
          </Button>
        </View>
      ) : (
        <View className="home-actions">
          <Text className="welcome">你好，{session.displayName}</Text>
          <Button
            className="primary-button"
            onClick={() => Taro.navigateTo({ url: "/pages/menu/index" })}
          >
            制作本周菜单
          </Button>
          <Button
            className="secondary-button"
            onClick={() => Taro.navigateTo({ url: "/pages/history/index" })}
          >
            查看历史
          </Button>
        </View>
      )}
    </ScreenContainer>
  );
}
