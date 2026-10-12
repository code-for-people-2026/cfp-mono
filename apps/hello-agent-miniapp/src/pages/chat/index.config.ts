export default definePageConfig({
  disableScroll: false,
  ...(process.env.TARO_ENV === "h5" ? { usingWindowScroll: true } : {}),
});
