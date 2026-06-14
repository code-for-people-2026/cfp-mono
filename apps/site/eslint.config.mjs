import config from "@cfp/eslint-config";

export default [
  ...config,
  {
    ignores: ["src/app/(payload)/admin/importMap.js"]
  }
];

