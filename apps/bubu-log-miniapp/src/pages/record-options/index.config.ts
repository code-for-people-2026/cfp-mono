export default definePageConfig({ navigationBarTitleText: "常用选项", ...(process.env.TARO_ENV === "h5" ? { usingWindowScroll: true } : {}) });
