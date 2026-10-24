import Taro from "@tarojs/taro";

// Keep the same status-bar / capsule geometry as Hello Agent, without its chat domain.
export function readNavigationLayout() {
  if (process.env.TARO_ENV !== "weapp") return undefined;
  let statusBarHeight = 24;
  let windowWidth = 375;
  try {
    const info = Taro.getWindowInfo();
    statusBarHeight = info.statusBarHeight || statusBarHeight;
    windowWidth = info.windowWidth || windowWidth;
  } catch { /* Safe cold-start geometry. */ }
  let height = 48;
  let side = 96;
  try {
    const capsule = Taro.getMenuButtonBoundingClientRect();
    if (capsule.height > 0 && capsule.top >= statusBarHeight && capsule.left > windowWidth / 2) {
      height = Math.max(44, capsule.height + (capsule.top - statusBarHeight) * 2);
      side = Math.max(side, windowWidth - capsule.left + 8);
    }
  } catch { /* The capsule is not ready yet. */ }
  return { statusBarHeight, height, side };
}
