import Taro from "@tarojs/taro";

export function readNavigationLayout() {
  if (process.env.TARO_ENV !== "weapp") return undefined;
  // 冷启动时胶囊可能尚未给出有效位置，保留状态栏和右侧安全空间。
  let statusBarHeight = 24;
  let windowWidth = 375;
  try {
    const info = Taro.getWindowInfo();
    statusBarHeight = info.statusBarHeight || statusBarHeight;
    windowWidth = info.windowWidth || windowWidth;
  } catch {
    /* 首屏使用安全默认值 */
  }
  let height = 48;
  let right = 104;
  try {
    const capsule = Taro.getMenuButtonBoundingClientRect();
    if (
      capsule.height > 0 &&
      capsule.top >= statusBarHeight &&
      capsule.left > windowWidth / 2
    ) {
      height = Math.max(
        44,
        capsule.height + (capsule.top - statusBarHeight) * 2,
      );
      right = Math.max(96, windowWidth - capsule.left + 8);
    }
  } catch {
    /* 微信尚未返回胶囊坐标 */
  }
  return { statusBarHeight, height, side: Math.max(96, right) };
}
