import path from "node:path";
import { defineConfig } from "@tarojs/cli";
import { WeappTailwindcss } from "weapp-tailwindcss/webpack";
import { productionBeBaseUrl } from "./production";

const isDevBuild = process.env.KITH_INN_DEV_BUILD === "1";
const embeddedBeBaseUrl = isDevBuild ? (process.env.BE_BASE_URL ?? "") : productionBeBaseUrl(process.env.BE_BASE_URL);
const embeddedBuildEnv = {
  "process.env.BE_BASE_URL": JSON.stringify(embeddedBeBaseUrl),
  "process.env.KITH_INN_DEV_BUILD": JSON.stringify(isDevBuild ? "1" : "0"),
};

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
    // Taro 只把 target config 传给 runner，故 H5/weapp 各自声明 shared include。
    compile: {
      include: [path.resolve(__dirname, "../../../packages/kith-inn-shared/src"), path.resolve(__dirname)],
    },
    // weapp-tailwindcss@5：给 Tailwind v4 utility 类做微信小程序 WXSS 转义
    // (特殊字符 / : . [ ) + rem→rpx。仅作用于 weapp 目标；h5 走 postcss
    // (@tailwindcss/postcss，见 postcss.config.mjs)。
    // 配方：https://tw.icebreaker.top/docs/quick-start/v4/taro-webpack
    webpackChain(chain, webpack) {
      // Webpack5 不给浏览器/weapp bundle polyfill Node 的 `process` 全局（Vite 会），
      // 且只替换约定 env（TARO_ENV/NODE_ENV）。自定义 build env 留作运行时访问会
      // ReferenceError，因此构建期固化；production 校验在任何 webpack 输出前完成。
      chain.plugin("kith-inn-build-env").use(webpack.DefinePlugin, [embeddedBuildEnv]);
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
    // FE 直接消费 shared 的 Zod runtime schema；将 workspace .ts 纳入 Babel rule。
    compile: {
      include: [path.resolve(__dirname, "../../../packages/kith-inn-shared/src"), path.resolve(__dirname)],
    },
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
      chain.plugin("kith-inn-build-env").use(webpack.DefinePlugin, [embeddedBuildEnv]);
    },
  },
  // Sourcemap: dev 开、prod 关（线上泄露源码）。微信开发者工具 Sources 面板打断点。
  sourceMap: { enable: isDevBuild },
}));
