import path from "node:path";
import { defineConfig } from "@tarojs/cli";

export default defineConfig(async () => ({
  projectName: "kith-inn-v1",
  date: "2026-07-10",
  designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: "src",
  outputRoot: "dist",
  framework: "react",
  compiler: "webpack5",
  alias: { "@": path.resolve(__dirname, "..", "src") },
  plugins: [],
  mini: {
    webpackChain(chain, webpack) {
      chain.plugin("process-env-be-base-url").use(webpack.DefinePlugin, [
        { "process.env.BE_BASE_URL": JSON.stringify(process.env.BE_BASE_URL ?? "") }
      ]);
    }
  },
  h5: {
    publicPath: "/",
    router: { mode: "browser" },
    devServer: { port: 10087, open: false },
    webpackChain(chain, webpack) {
      chain.plugin("process-env-be-base-url").use(webpack.DefinePlugin, [
        { "process.env.BE_BASE_URL": JSON.stringify(process.env.BE_BASE_URL ?? "") }
      ]);
    }
  },
  sourceMap: { enable: process.env.NODE_ENV !== "production" }
}));
