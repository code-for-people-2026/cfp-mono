export default definePageConfig({
  navigationBarTitleText: "开始记录",
  navigationStyle: "custom",
  navigationBarBackgroundColor: "#fcfcfa",
  backgroundColor: "#fcfcfa",
  ...(process.env.TARO_ENV === "h5" ? { usingWindowScroll: false } : {}),
});
