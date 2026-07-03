import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Build/coverage artifacts are generated, not source.
  { ignores: ["coverage/**", ".next/**"] },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
