import config from "@cfp/eslint-config";

export default [{ ignores: ["coverage/**", "dist/**", "playwright-report/**", "test-results/**"] }, ...config];
