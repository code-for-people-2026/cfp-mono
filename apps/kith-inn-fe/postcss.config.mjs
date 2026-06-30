/* global process */
// Tailwind v4 PostCSS entry — generates utility CSS for the **h5** build only.
// For weapp, the WeappTailwindcss webpack plugin (config/index.ts mini.webpackChain)
// OWNS Tailwind generation (class escaping + rem→rpx); running @tailwindcss/postcss
// there too would double-generate app.css.
// (Codex #93 P2; weapp-tailwindcss v5 Taro/Webpack guide: don't additionally
// register @tailwindcss/postcss for mini targets.)
const isMini = process.env.TARO_ENV === "weapp";
export default {
  plugins: isMini ? {} : { "@tailwindcss/postcss": {} },
};
