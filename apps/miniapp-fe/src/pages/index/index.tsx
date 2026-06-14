import { useEffect, useState } from "react";
import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import { createMiniappDemoUrl } from "@/lib/api";
import "./index.css";

type DemoResponse = {
  message?: string;
};

export default function IndexPage() {
  const [message, setMessage] = useState("正在连接码成工 API");

  useEffect(() => {
    Taro.request<DemoResponse>({
      url: createMiniappDemoUrl(process.env.TARO_APP_API_BASE_URL),
      success: (result) => {
        setMessage(result.data.message || "API 已响应");
      },
      fail: () => {
        setMessage("API 暂未连接，H5 页面仍可预览");
      }
    });
  }, []);

  return (
    <View className="page">
      <Text className="eyebrow">Code for People</Text>
      <Text className="title">码成工</Text>
      <Text className="body">
        Taro 同时产出微信小程序和 H5。第一版自动化覆盖 H5，小程序端手动测试。
      </Text>
      <Text className="status">{message}</Text>
    </View>
  );
}

