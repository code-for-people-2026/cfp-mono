import { getWechatSpeechPlugin } from "../config/speech";
const speech = getWechatSpeechPlugin();

export default defineAppConfig({
  plugins: speech ? { WechatSI: speech } : {},
  pages: ["pages/index/index", "pages/settings/index", "pages/privacy/index"],
  window: {
    navigationBarTitleText: "卜卜日记",
    navigationBarBackgroundColor: "#faf7f2",
    navigationBarTextStyle: "black",
    backgroundColor: "#faf7f2",
  },
});
