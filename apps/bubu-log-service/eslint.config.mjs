import config from "@cfp/eslint-config";
export default [...config, { ignores: ["dist/**", ".data/**", "coverage/**"] }];
