/* global module */
// babel config for the Webpack5 compiler (Vite used esbuild for TS/JSX and
// didn't need this). babel-preset-taro bundles preset-env + preset-react +
// preset-typescript + Taro platform transforms. See Taro docs / babel-preset-taro.
module.exports = {
  presets: [
    ["taro", { framework: "react", ts: true, compiler: "webpack5" }],
  ],
};
