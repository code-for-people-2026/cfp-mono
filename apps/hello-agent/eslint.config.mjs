import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
const config = [
  { ignores: [".next/**", ".data/**", "coverage/**", "next-env.d.ts", "public/chat/**"] },
  ...nextVitals,
  ...nextTypescript,
  // 私有图片依赖当前访客 Cookie，不能交给公开的图片优化代理。
  { rules: { "@next/next/no-img-element": "off" } },
];
export default config;
