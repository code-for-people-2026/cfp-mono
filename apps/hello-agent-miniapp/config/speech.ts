// 好人阿 J 已授权此插件版本；其他 AppID 须另行授权，显式传空字符串可禁用。
export function getWechatSpeechPlugin(
  version = process.env.HELLO_WECHAT_SI_VERSION ?? "0.3.10",
) {
  return version ? { version, provider: "wx069ba97219f66d99" } : undefined;
}
