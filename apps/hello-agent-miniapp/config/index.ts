import { defineConfig } from "@tarojs/cli";

export default defineConfig(async () => ({
  projectName: "hello-agent-miniapp",
  date: "2026-09-29",
  designWidth: 375,
  deviceRatio: { 375: 2, 640: 1.17, 750: 1, 828: 0.905 },
  sourceRoot: "src",
  outputRoot: process.env.TARO_ENV === "h5" ? "dist/h5" : "dist/weapp",
  framework: "react",
  compiler: "vite",
  defineConstants: {
    HELLO_API_ORIGIN: JSON.stringify(
      process.env.HELLO_API_ORIGIN || "http://127.0.0.1:3310",
    ),
  },
  mini: {},
  h5: {
    publicPath: "/chat/",
    router: { mode: "hash" },
    postcss: { pxtransform: { enable: false } },
  },
}));
