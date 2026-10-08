import path from "node:path";
import { defineConfig } from "@tarojs/cli";

export default defineConfig({
  projectName: "kith-inn", designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: "src", outputRoot: "dist", framework: "react", compiler: "vite",
  alias: {
    "@": path.resolve(__dirname, "..", "src"),
    // pnpm 的不同 peer 快照可能产生两份运行时，生命周期必须共用入口初始化的 React 上下文。
    "@tarojs/plugin-framework-react": path.dirname(require.resolve("@tarojs/plugin-framework-react/package.json"))
  },
  plugins: [], mini: {}, h5: { publicPath: "/", router: { mode: "hash" } },
  env: { TARO_APP_KITH_INN_API_BASE_URL: JSON.stringify(process.env.TARO_APP_KITH_INN_API_BASE_URL ?? "") }
});
