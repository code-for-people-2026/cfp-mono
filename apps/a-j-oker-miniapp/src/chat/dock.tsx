import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { keyboardOverlayHeight } from "@cfp/chat-ui-taro";

interface ChatDockProps {
  active: boolean;
  children: ReactNode;
  keyboardHeight?: number;
  onOverlayChange?(overlay: boolean): void;
}

function viewportHeight() {
  const height = Taro.getWindowInfo().windowHeight;
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}

// WeChat's textarea auto-lift is disabled so one owner controls the composer.
// Native hosts either overlay the keyboard over an unchanged viewport or resize
// that viewport. Shared geometry subtracts the resized portion before this dock
// floats; a resized host keeps its normal sticky-bottom layout.
export function ChatDock({
  active,
  children,
  keyboardHeight,
  onOverlayChange,
}: ChatDockProps) {
  const [keyboard, setKeyboard] = useState({ height: 0, lift: 0 });
  const [dockHeight, setDockHeight] = useState(0);
  const activeRef = useRef(active);
  const mountedRef = useRef(true);
  const hiddenRef = useRef(false);
  const stableViewport = useRef(0);
  const pendingViewport = useRef(0);
  const focusViewport = useRef(0);
  const latestKeyboard = useRef(0);

  const applyGeometry = useCallback((height: number, focusHeight?: number) => {
    const current = viewportHeight();
    const baseline =
      focusHeight ??
      (focusViewport.current || stableViewport.current || current);
    const lift = activeRef.current && !hiddenRef.current && height > 0
      ? keyboardOverlayHeight({
          keyboardHeight: height,
          focusViewportHeight: baseline,
          currentViewportHeight: current,
        })
      : 0;
    latestKeyboard.current = Math.max(0, height);
    setKeyboard({ height: Math.max(0, height), lift });
    if (lift > 0) {
      Taro.createSelectorQuery()
        .select(".chat-dock")
        .boundingClientRect((rect) => {
          if (mountedRef.current && !Array.isArray(rect) && rect?.height)
            setDockHeight(rect.height);
        })
        .exec();
    }
  }, []);

  useEffect(() => {
    activeRef.current = active;
    if (active) {
      // The keyboard event/viewport resize may precede React's focus state.
      // Keep the pre-keyboard stable baseline captured while inactive.
      focusViewport.current = stableViewport.current || viewportHeight();
      pendingViewport.current = 0;
      if (latestKeyboard.current)
        applyGeometry(latestKeyboard.current, focusViewport.current);
    } else {
      focusViewport.current = 0;
      applyGeometry(0);
    }
  }, [active, applyGeometry]);

  useEffect(() => {
    if (keyboardHeight === undefined) return;
    applyGeometry(keyboardHeight);
  }, [applyGeometry, keyboardHeight]);

  useEffect(() => {
    mountedRef.current = true;
    if (process.env.TARO_ENV === "h5") return;
    stableViewport.current = viewportHeight();
    const keyboardChange = ({ height }: { height: number }) => {
      applyGeometry(height);
      if (height === 0) {
        stableViewport.current = viewportHeight();
        pendingViewport.current = 0;
      }
    };
    const windowResize = () => {
      const current = viewportHeight();
      if (activeRef.current || latestKeyboard.current > 0) {
        applyGeometry(latestKeyboard.current);
        return;
      }
      // A native keyboard may resize the viewport before textarea focus and
      // before its height event. Keep a first inactive shrink provisional so
      // it cannot replace the pre-keyboard baseline. Repeated resize events at
      // the same height confirm a settled rotation/layout change.
      if (current >= stableViewport.current || pendingViewport.current === current) {
        stableViewport.current = current;
        pendingViewport.current = 0;
      } else {
        pendingViewport.current = current;
      }
    };
    const hide = () => {
      hiddenRef.current = true;
      pendingViewport.current = 0;
      applyGeometry(0);
    };
    const show = () => {
      hiddenRef.current = false;
      if (!activeRef.current) {
        stableViewport.current = viewportHeight();
        pendingViewport.current = 0;
      }
    };
    Taro.onKeyboardHeightChange(keyboardChange);
    Taro.onWindowResize(windowResize);
    Taro.onAppHide(hide);
    Taro.onAppShow(show);
    return () => {
      mountedRef.current = false;
      Taro.offKeyboardHeightChange(keyboardChange);
      Taro.offWindowResize(windowResize);
      Taro.offAppHide(hide);
      Taro.offAppShow(show);
    };
  }, [applyGeometry]);

  useEffect(() => {
    onOverlayChange?.(keyboard.lift > 0);
  }, [keyboard.lift, onOverlayChange]);

  const floating = keyboard.lift > 0;
  return <>
    {floating && (
      <View
        className="chat-dock-space"
        style={{ height: `${keyboard.lift + dockHeight}px` }}
      />
    )}
    <View
      className={`chat-dock${floating ? " is-keyboard-overlay" : ""}`}
      style={
        floating
          ? {
              position: "fixed",
              left: 0,
              right: 0,
              bottom: `${keyboard.lift}px`,
            }
          : undefined
      }
    >
      {children}
    </View>
  </>;
}
