export default definePageConfig({
  navigationStyle: process.env.TARO_ENV === "h5" ? "custom" : "default",
  navigationBarTitleText: "设置",
  disableScroll: false,
  ...(process.env.TARO_ENV === "h5" ? { usingWindowScroll: true } : {}),
});
