import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Payload-generated migrations: machine-authored SQL wrappers, not hand-maintained.
  // Build/coverage artifacts are generated, not source.
  { ignores: ["src/payload/migrations/**", "coverage/**", ".next/**"] },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
