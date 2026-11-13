export default definePageConfig({
  navigationStyle: "custom",
  disableScroll: false,
  ...(process.env.TARO_ENV === "h5" ? { usingWindowScroll: true } : {}),
});
