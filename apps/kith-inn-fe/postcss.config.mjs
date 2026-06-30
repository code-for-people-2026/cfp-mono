// Tailwind v4 PostCSS entry — generates utility CSS for both h5 and weapp.
// (weapp class-name escaping + rem→rpx is handled separately by the
// weapp-tailwindcss WeappTailwindcss webpack plugin in config/index.ts.)
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
