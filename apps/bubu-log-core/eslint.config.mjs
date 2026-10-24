import config from "@cfp/eslint-config";
export default [...config, { ignores: ["dist/**", ".next/**", "next-env.d.ts", ".data/**", "coverage/**"] }];
