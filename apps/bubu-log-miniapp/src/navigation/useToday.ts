import Taro from "@tarojs/taro";
import { useCallback, useEffect, useRef, useState } from "react";
import { millisecondsUntilNextShanghaiDay, todayKey } from "../model";

/**
 * Current Shanghai calendar day for relative titles and no-future limits.
 *
 * Refreshes on page/app show, when the H5 tab becomes visible, and at the next
 * Shanghai midnight. It intentionally never touches the browsing date state.
 */
export function useTodayKey(): string {
  const [today, setToday] = useState(todayKey);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    const next = todayKey();
    setToday((previous) => previous === next ? previous : next);
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const delay = millisecondsUntilNextShanghaiDay() + 100;
    timerRef.current = setTimeout(() => {
      refresh();
      schedule();
    }, Math.min(delay, 2_147_483_647));
  }, [refresh]);

  useEffect(() => {
    schedule();
    if (process.env.TARO_ENV !== "h5" || typeof document === "undefined") {
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        schedule();
      }
    };
    const onFocus = () => {
      refresh();
      schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh, schedule]);

  useEffect(() => {
    if (process.env.TARO_ENV === "h5") return;
    const onShow = () => {
      refresh();
      schedule();
    };
    Taro.onAppShow(onShow);
    return () => Taro.offAppShow(onShow);
  }, [refresh, schedule]);

  return today;
}
