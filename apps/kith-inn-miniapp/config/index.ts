import path from "node:path";
import { defineConfig } from "@tarojs/cli";

export default defineConfig({
  projectName: "kith-inn", designWidth: 750,
  deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
  sourceRoot: "src", outputRoot: "dist", framework: "react", compiler: "vite",
  alias: { "@": path.resolve(__dirname, "..", "src") },
  plugins: [], mini: {}, h5: { publicPath: "/", router: { mode: "browser" } }
});
