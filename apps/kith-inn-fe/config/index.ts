import path from "node:path";
import { defineConfig } from "@tarojs/cli";
import { WeappTailwindcss } from "weapp-tailwindcss/webpack";

export default defineConfig(async () => ({
  projectName: "kith-inn",
  date: "2026-06-28",
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
  },
  sourceRoot: "src",
  outputRoot: "dist",
  framework: "react",
  // Webpack5 (not Vite): weapp-tailwindcss 官方点名 Taro-Webpack 才是稳定路径，
  // Taro-Vite 有未修 bug (#579，带小数点的类如 w-1.5 在 weapp 失效)。
  compiler: "webpack5",
  alias: {
    "@": path.resolve(__dirname, "..", "src"),
  },
  plugins: [],
  mini: {
    // weapp-tailwindcss@5：给 Tailwind v4 utility 类做微信小程序 WXSS 转义
    // (特殊字符 / : . [ ) + rem→rpx。仅作用于 weapp 目标；h5 走 postcss
    // (@tailwindcss/postcss，见 postcss.config.mjs)。
    // 配方：https://tw.icebreaker.top/docs/quick-start/v4/taro-webpack
    webpackChain(chain, webpack) {
      // Webpack5 不给浏览器/weapp bundle polyfill Node 的 `process` 全局（Vite 会），
      // 且只替换约定 env（TARO_ENV/NODE_ENV）。process.env.BE_BASE_URL 自定义，留作运行时
      // 访问会 ReferenceError。构建期替换；"" → resolveBeBaseUrl 回退 DEFAULT_BE_BASE_URL。
      chain.plugin("process-env-be-base-url").use(webpack.DefinePlugin, [
        { "process.env.BE_BASE_URL": JSON.stringify(process.env.BE_BASE_URL ?? "") },
      ]);
      chain.merge({
        plugin: {
          install: {
            plugin: WeappTailwindcss,
            args: [
              {
                appType: "taro",
                rem2rpx: true,
                cssEntries: [path.resolve(__dirname, "../src/app.css")],
              },
            ],
          },
        },
      });
    },
  },
  h5: {
    publicPath: "/",
    router: { mode: "browser" },
    // Force CSS extraction even in dev: Taro's webpack5-runner defaults
    // enableExtract = (mode === 'production'), so dev used style-loader — which
    // orphaned the entry app.css (compiled to /css/app.css but neither <link>'d
    // nor JS-injected → unstyled dev page). Extracting makes dev link app.css
    // like prod. Weapp is unaffected (separate mini config). HMR falls back to
    // full reload on CSS change, acceptable.
    enableExtract: true,
    webpackChain(chain, webpack) {
      chain.plugin("process-env-be-base-url").use(webpack.DefinePlugin, [
        { "process.env.BE_BASE_URL": JSON.stringify(process.env.BE_BASE_URL ?? "") },
      ]);
    },
  },
}));
