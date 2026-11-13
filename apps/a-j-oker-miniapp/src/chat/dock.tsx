import { useEffect, useState, type ReactNode } from "react";
import { View } from "@tarojs/components";
import Taro from "@tarojs/taro";

// WeChat's automatic textarea lift fights a sticky footer on Android. Lift the
// entire dock ourselves, keeping the send button beside the input above the IME.
export function ChatDock({ children }: { children: ReactNode }) {
  const [keyboard, setKeyboard] = useState(0);
  const [dockHeight, setDockHeight] = useState(0);
  useEffect(() => {
    if (process.env.TARO_ENV === "h5") return;
    let active = true;
    const resize = ({ height }: { height: number }) => {
      const next = Number.isFinite(height) ? Math.max(0, height) : 0;
      setKeyboard(next);
      if (next) Taro.createSelectorQuery().select(".chat-dock").boundingClientRect((rect) => {
        if (active && !Array.isArray(rect) && rect?.height) setDockHeight(rect.height);
      }).exec();
    };
    const hide = () => setKeyboard(0);
    Taro.onKeyboardHeightChange(resize);
    Taro.onAppHide(hide);
    return () => {
      active = false;
      Taro.offKeyboardHeightChange(resize);
      Taro.offAppHide(hide);
    };
  }, []);
  return <>
    {keyboard > 0 && <View className="chat-dock-space" style={{ height: `${keyboard + dockHeight}px` }} />}
    <View className="chat-dock" style={keyboard > 0 ? { position: "fixed", left: 0, right: 0, bottom: `${keyboard}px` } : undefined}>
      {children}
    </View>
  </>;
}
