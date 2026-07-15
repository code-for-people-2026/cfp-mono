import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "smoke-deployed": "src/smoke/deployed-cli.ts",
  },
  clean: true,
  format: ["esm"],
  platform: "node",
  noExternal: [/.*/],
  sourcemap: false,
});
