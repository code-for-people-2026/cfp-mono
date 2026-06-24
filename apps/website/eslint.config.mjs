import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Payload-generated migrations: machine-authored SQL wrappers, not hand-maintained.
  { ignores: ["src/payload/migrations/**"] },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;

