import { getWechatSpeechPlugin } from "./speech";
import path from "node:path";
import { resolveH5DevProxy, resolveWeappProfile } from "./profiles";
import { defineConfig } from "@tarojs/cli";

export default defineConfig(async () => ({
  projectName: "bubu-log-miniapp",
  date: "2026-10-23",
  designWidth: 375,
  deviceRatio: { 375: 2, 640: 1.17, 750: 1, 828: 0.905 },
  sourceRoot: "src",
  outputRoot: process.env.TARO_ENV === "h5" ? "dist/h5" : resolveWeappProfile().outputRoot,
  copy: process.env.TARO_ENV === "h5" ? { patterns: [] } : {
    patterns: [
      {
        from: path.resolve(__dirname, `project.${resolveWeappProfile().name}.json`),
        to: `${resolveWeappProfile().outputRoot}/project.config.json`,
      },
    ],
  },
  framework: "react",
  compiler: "vite",
  alias: {
    "@tarojs/plugin-framework-react/dist/runtime": require.resolve(
      "@tarojs/plugin-framework-react/dist/runtime",
    ),
  },
  defineConstants: {
    BUBU_WECHAT_SI_ENABLED: JSON.stringify(!!getWechatSpeechPlugin()),
    BUBU_API_ORIGIN: JSON.stringify(process.env.TARO_ENV === "h5" ? "" : resolveWeappProfile().apiOrigin),
    BUBU_AUTH_MODE: JSON.stringify(process.env.BUBU_AUTH_MODE === "legacy" ? "legacy" : "sidecar"),
  },
  mini: { imageUrlLoaderOption: { limit: false } },
  h5: {
    publicPath: "/",
    router: { mode: "hash" },
    imageUrlLoaderOption: { limit: false },
    postcss: { pxtransform: { enable: false } },
    devServer: { proxy: { "/api": { target: resolveH5DevProxy(), changeOrigin: true } } },
  },
}));
