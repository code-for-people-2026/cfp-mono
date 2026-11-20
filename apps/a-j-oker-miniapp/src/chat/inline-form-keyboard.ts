import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Taro, { useDidHide } from "@tarojs/taro";
import { keyboardOverlayHeight } from "@cfp/chat-ui-taro";

const SCROLL_MARGIN = 24;

interface NodeRect {
  top?: number;
  bottom?: number;
}

interface ScrollOffset {
  scrollTop?: number;
}

function viewportHeight() {
  const height = Taro.getWindowInfo().windowHeight;
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}

function eventHeight(height: number) {
  return Number.isFinite(height) ? Math.max(0, height) : 0;
}

export function useInlineFormKeyboard() {
  const [state, setState] = useState({ overlay: 0, active: false });
  const focusId = useRef("");
  const focusViewport = useRef(0);
  const keyboardHeight = useRef(0);
  const queryToken = useRef(0);

  const scrollFieldIntoHost = useCallback((id: string, height: number) => {
    const token = ++queryToken.current;
    Taro.createSelectorQuery()
      .select(`#${id}`)
      .boundingClientRect()
      .select(".chat-header")
      .boundingClientRect()
      .selectViewport()
      .scrollOffset()
      .exec((results) => {
        if (
          token !== queryToken.current ||
          focusId.current !== id ||
          keyboardHeight.current !== height
        )
          return;
        const field = results[0] as NodeRect | null;
        const header = results[1] as NodeRect | null;
        const offset = results[2] as ScrollOffset | null;
        const fieldTop = field?.top;
        const fieldBottom = field?.bottom;
        const headerBottomValue =
          header && !Array.isArray(header) ? header.bottom : undefined;
        const scrollTop = offset?.scrollTop;
        if (
          !field ||
          Array.isArray(field) ||
          !offset ||
          Array.isArray(offset) ||
          typeof fieldTop !== "number" ||
          !Number.isFinite(fieldTop) ||
          typeof fieldBottom !== "number" ||
          !Number.isFinite(fieldBottom) ||
          typeof scrollTop !== "number" ||
          !Number.isFinite(scrollTop)
        )
          return;

        const currentViewport = viewportHeight();
        const overlay = keyboardOverlayHeight({
          keyboardHeight: height,
          focusViewportHeight: focusViewport.current,
          currentViewportHeight: currentViewport,
        });
        const availableBottom = currentViewport - overlay - SCROLL_MARGIN;
        const headerBottom =
          typeof headerBottomValue === "number" &&
          Number.isFinite(headerBottomValue)
          ? Math.max(0, headerBottomValue + SCROLL_MARGIN)
          : -Infinity;

        // A repeated focus/keyboard event must not disturb an already visible
        // input. The header threshold only applies when its rect was returned.
        if (
          fieldBottom <= availableBottom &&
          fieldTop >= headerBottom
        )
          return;

        const overflow = fieldBottom - availableBottom;
        let delta = Math.max(0, overflow);
        if (Number.isFinite(headerBottom)) {
          delta =
            fieldTop < headerBottom
              ? fieldTop - headerBottom
              : Math.min(delta, fieldTop - headerBottom);
        }
        if (delta === 0) return;

        void Taro.pageScrollTo({
          scrollTop: Math.max(0, scrollTop + delta),
          duration: 0,
        }).catch(() => undefined);
      });
  }, []);

  const applyKeyboard = useCallback(
    (id: string, height: number) => {
      if (focusId.current !== id) return;
      queryToken.current += 1;
      keyboardHeight.current = eventHeight(height);
      const currentViewport = viewportHeight();
      const safeHeight = keyboardHeight.current;
      const overlay = safeHeight
        ? keyboardOverlayHeight({
            keyboardHeight: safeHeight,
            focusViewportHeight: focusViewport.current || currentViewport,
            currentViewportHeight: currentViewport,
          })
        : 0;
      setState({ overlay, active: safeHeight > 0 });
      if (safeHeight === 0) return;
      Taro.nextTick(() => scrollFieldIntoHost(id, safeHeight));
    },
    [scrollFieldIntoHost],
  );

  const reset = useCallback(() => {
    queryToken.current += 1;
    focusId.current = "";
    focusViewport.current = 0;
    keyboardHeight.current = 0;
    setState({ overlay: 0, active: false });
  }, []);

  const handlers = useMemo(
    () => ({
      focus: (id: string, height: number) => {
        if (!id) return;
        queryToken.current += 1;
        focusId.current = id;
        keyboardHeight.current = 0;
        if (!focusViewport.current) focusViewport.current = viewportHeight();
        applyKeyboard(id, eventHeight(height));
      },
      blur: (id: string) => {
        if (focusId.current !== id) return;
        reset();
      },
      keyboardHeight: (id: string, height: number) => {
        if (focusId.current !== id) return;
        applyKeyboard(id, eventHeight(height));
      },
    }),
    [applyKeyboard, reset],
  );

  useDidHide(reset);

  useEffect(() => {
    if (process.env.TARO_ENV === "h5") return;
    const resize = () => {
      if (!focusId.current || keyboardHeight.current <= 0) return;
      applyKeyboard(focusId.current, keyboardHeight.current);
    };
    Taro.onWindowResize(resize);
    return () => {
      queryToken.current += 1;
      Taro.offWindowResize(resize);
    };
  }, [applyKeyboard]);

  return { handlers, overlay: state.overlay, active: state.active };
}
