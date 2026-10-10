import { getWechatSpeechPlugin } from "../config/speech";

const speechPlugin = getWechatSpeechPlugin();

export default defineAppConfig({
  pages: ["pages/chat/index"],
  // 插件声明与界面开关共用一份配置，避免显示语音入口却没有打包插件。
  plugins: speechPlugin
    ? {
        WechatSI: speechPlugin,
      }
    : {},
  // 录音在用户按住时通过 scope.record 请求授权，不属于 app.json 的 permission 字段。
  window: {
    navigationBarTitleText: "好人阿 J",
    navigationBarBackgroundColor: "#f6f8f7",
    navigationBarTextStyle: "black",
    backgroundColor: "#f6f8f7",
  },
});
