import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { View } from "@tarojs/components";
import Taro from "@tarojs/taro";

interface CollapsibleDaySummaryProps {
  collapsed: boolean;
  children: ReactNode;
  measurementKey: string;
  onHeightChange?: (height: number) => void;
}

/**
 * Measures the inner content, not the clipped outer box, so a closed header can
 * still report the space that DayTimeline should reclaim.
 */
export function CollapsibleDaySummary({
  collapsed,
  children,
  measurementKey,
  onHeightChange,
}: CollapsibleDaySummaryProps) {
  const reactId = useId();
  const innerId = `day-summary-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [naturalHeight, setNaturalHeight] = useState(0);
  const mounted = useRef(true);
  const measureGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      measureGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const generation = ++measureGeneration.current;

    const commit = (height: number) => {
      if (!mounted.current || !active || measureGeneration.current !== generation) return;
      setNaturalHeight((previous) => (Math.abs(previous - height) <= 0.5 ? previous : height));
    };

    const measure = () => Taro.nextTick(() => {
      if (!active || measureGeneration.current !== generation) return;
      Taro.createSelectorQuery()
        .select(`#${innerId}`)
        .boundingClientRect((rect) => {
          if (!active || measureGeneration.current !== generation) return;
          const height = Array.isArray(rect) ? rect[0]?.height : rect?.height;
          if (typeof height === "number" && height > 0) {
            commit(height);
            return;
          }
          if (attempts < 3) {
            attempts += 1;
            retry = setTimeout(measure, 50);
          }
        })
        .exec();
    });

    measure();
    if (process.env.TARO_ENV === "h5") {
      if (typeof window === "undefined") {
        return () => {
          active = false;
          clearTimeout(retry);
        };
      }
      const resize = () => measure();
      window.addEventListener("resize", resize);
      return () => {
        active = false;
        clearTimeout(retry);
        window.removeEventListener("resize", resize);
      };
    }

    const resize = () => measure();
    Taro.onWindowResize(resize);
    return () => {
      active = false;
      clearTimeout(retry);
      Taro.offWindowResize(resize);
    };
  }, [innerId, measurementKey]);

  useEffect(() => {
    if (naturalHeight > 0) onHeightChange?.(naturalHeight);
  }, [naturalHeight, onHeightChange]);

  const ariaHidden = collapsed ? { "aria-hidden": true } : undefined;
  const outerHeight = collapsed ? "0px" : naturalHeight > 0 ? `${naturalHeight}px` : "auto";
  return (
    <View
      className="collapsible-day-summary"
      style={{ height: outerHeight }}
      role="group"
      ariaRole="group"
      {...ariaHidden}
    >
      <View
        id={innerId}
        className="collapsible-day-summary-inner"
        style={{
          opacity: collapsed ? 0 : 1,
          transform: collapsed ? "translateY(-6px)" : "translateY(0px)",
          pointerEvents: collapsed ? "none" : "auto",
        }}
        ariaRole="group"
        {...ariaHidden}
      >
        {children}
      </View>
    </View>
  );
}
