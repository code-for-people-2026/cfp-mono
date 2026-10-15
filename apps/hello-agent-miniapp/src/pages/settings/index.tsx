import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { ChatIcon } from "../../chat/icon";
import { modes } from "../../chat/model";
import { useChatMode } from "../../chat/preferences";
import { SettingsRow, leavePage } from "../../chat/settings-page";
import { openHelp, openPrivacy } from "../../chat/settings-navigation";

export default function SettingsPage() {
  const mode = useChatMode();
  return <View className={process.env.TARO_ENV === "h5" ? "h5-shell" : "native-shell"}>
    <View className="settings-page">
      {process.env.TARO_ENV === "h5" && <View className="settings-header">
        <Button className="control nav-icon" ariaLabel="返回聊天" onClick={leavePage}><ChatIcon name="chevronLeft" /></Button>
        <Text>设置</Text><View className="settings-header-spacer" />
      </View>}
      <View className="settings-content">
        <View className="settings-intro"><Text className="settings-title">聊得自在，用得安心</Text><Text className="settings-description">按你的需要，管理连接方式和自己的数据。</Text></View>
        <View className="page-card">
          <SettingsRow title="连接方式" detail={modes.find((item) => item.id === mode)?.label} onClick={() => void Taro.navigateTo({ url: "/pages/connection/index" })} />
          <SettingsRow title="隐私与数据" description="授权、导出与删除" onClick={() => void openPrivacy()} />
          <SettingsRow title="帮助与反馈" description="提交问题，查看处理进度" onClick={() => void openHelp()} />
        </View>
      </View>
    </View>
  </View>;
}
