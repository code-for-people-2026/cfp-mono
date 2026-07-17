const pages = [
  "pages/merchant/login/index",
  "pages/merchant/offerings/index",
  "pages/merchant/menu/index",
  "pages/merchant/batches/index",
  "pages/merchant/orders/index",
  "pages/booking/index",
  "pages/customer/orders/index",
  "pages/privacy/index"
];
if (process.env.KITH_INN_V1_ENABLE_JIELONG_IMPORT === "1") {
  pages.push("pages/merchant/jielong-import/index");
}

export default defineAppConfig({
  pages,
  window: {
    backgroundTextStyle: "light",
    backgroundColor: "#fff8ed",
    navigationBarBackgroundColor: "#fff8ed",
    navigationBarTitleText: "街坊味",
    navigationBarTextStyle: "black"
  }
});
