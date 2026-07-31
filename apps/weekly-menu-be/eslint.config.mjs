import config from "@cfp/eslint-config";

export default [
  ...config,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        URL: "readonly"
      }
    }
  }
];
