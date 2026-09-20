import path from "node:path";
import { defineConfig } from "@tarojs/cli";

export default defineConfig({
  projectName: "kith-inn", designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: "src", outputRoot: "dist", framework: "react", compiler: "vite",
  alias: { "@": path.resolve(__dirname, "..", "src") },
  plugins: [], mini: {}, h5: { publicPath: "/", router: { mode: "hash" } },
  env: { TARO_APP_KITH_INN_API_BASE_URL: JSON.stringify(process.env.TARO_APP_KITH_INN_API_BASE_URL ?? "") }
});
