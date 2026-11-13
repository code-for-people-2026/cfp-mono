import { defineConfig } from "@tarojs/cli";

export default defineConfig(async () => ({
  projectName: "bubu-log-miniapp",
  date: "2026-10-23",
  designWidth: 375,
  deviceRatio: { 375: 2, 640: 1.17, 750: 1, 828: 0.905 },
  sourceRoot: "src",
  outputRoot: process.env.TARO_ENV === "h5" ? "dist/h5" : "dist/weapp",
  framework: "react",
  compiler: "vite",
  alias: {
    "@tarojs/plugin-framework-react/dist/runtime": require.resolve(
      "@tarojs/plugin-framework-react/dist/runtime",
    ),
  },
  defineConstants: {
    BUBU_API_ORIGIN: JSON.stringify(process.env.BUBU_API_ORIGIN || ""),
    BUBU_AUTH_MODE: JSON.stringify(process.env.BUBU_AUTH_MODE === "sidecar" ? "sidecar" : "legacy"),
  },
  mini: { imageUrlLoaderOption: { limit: false } },
  h5: {
    publicPath: "/",
    router: { mode: "hash" },
    imageUrlLoaderOption: { limit: false },
    postcss: { pxtransform: { enable: false } },
    devServer: process.env.BUBU_DEV_PROXY
      ? { proxy: { "/api": { target: process.env.BUBU_DEV_PROXY, changeOrigin: true } } }
      : {},
  },
}));
