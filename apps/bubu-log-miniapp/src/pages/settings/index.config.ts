export default definePageConfig({ navigationBarTitleText: "设置", ...(process.env.TARO_ENV === "h5" ? { usingWindowScroll: true } : {}) });
