export default definePageConfig({
  navigationStyle: process.env.TARO_ENV === "h5" ? "custom" : "default",
  navigationBarTitleText: "连接方式",
  disableScroll: false,
  ...(process.env.TARO_ENV === "h5" ? { usingWindowScroll: true } : {}),
});
