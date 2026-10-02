export default defineAppConfig({
  pages: ["pages/week/index", "pages/dishes/index", "pages/history/index"],
  lazyCodeLoading: "requiredComponents",
  window: { navigationBarTitleText: "街坊味", navigationBarBackgroundColor: "#fffdf7", navigationBarTextStyle: "black" }
});
