import { useEffect, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import * as api from "../../chat/api";
import { type Settings } from "../../chat/model";
import { ChatIcon } from "../../chat/icon";

const h5 = process.env.TARO_ENV === "h5";
export default function ConnectionPage() {
  const [settings, setSettings] = useState<Settings>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api.establishIdentity().then(api.getSettings)
      .then((config) => { if (active) setSettings(config); })
      .catch((value) => { if (active) setError(value instanceof Error ? value.message : "暂时无法连接，请稍后重试"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function back() {
    try {
      if (Taro.getCurrentPages().length > 1) await Taro.navigateBack();
      else await Taro.reLaunch({ url: "/pages/chat/index" });
    } catch (value) { setError(value instanceof Error ? value.message : "暂时无法返回"); }
  }
  return <View className={h5 ? "h5-shell" : "native-shell"}>
    <View className="settings-page">
      {h5 && <View className="settings-header">
        <Button className="control nav-icon" ariaLabel="返回设置" onClick={back}><ChatIcon name="chevronLeft" /></Button>
        <Text>连接方式</Text><View className="settings-header-spacer" />
      </View>}
      <View className="settings-content">
        <View className="settings-intro"><Text className="settings-title">聊得自在，用得安心</Text>
          <Text className="settings-description">由平台提供 DeepSeek 对话和万相图片生成服务。</Text></View>
        {error && <Text className="error settings-error">{error}</Text>}
        <View className="settings-section">
          <Text className="settings-section-title">平台助手</Text>
          <Text className="sheet-description">使用微信账号登录后即可聊天，不需要填写模型密钥。</Text>
          <Text className="sheet-note">当前模型：{settings?.model || (loading ? "连接中" : "暂不可用")}</Text>
          {settings && !settings.platformConfigured && <Text className="error">对话服务暂不可用，请稍后重试。</Text>}
          <Text className="sheet-note">图片生成：{loading ? "连接中" : settings?.imageGenerationConfigured ? "已启用" : "暂未开放"}</Text>
        </View>
      </View>
    </View>
  </View>;
}
