// Each AppID must explicitly configure its authorized plugin version.
export function getWechatSpeechPlugin(version = process.env.BUBU_WECHAT_SI_VERSION || "") {
  return version ? { version, provider: "wx069ba97219f66d99" } : undefined;
}
