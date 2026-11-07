import { useCallback, useEffect, useId, useRef, useState } from "react";
import Taro from "@tarojs/taro";
import type { BaseEventOrig, ITouchEvent } from "@tarojs/components";
import {
  cancelGesture,
  createGestureState,
  pointerDown,
  pointerMove,
  pointerUp,
  type FeedbackPlacement,
  type GestureConfig,
  type GestureMetrics,
  type GesturePoint,
  type GestureState,
  type GestureUpdate,
  type PeriodDirection,
} from "./model";

export interface TimelineGestureOptions {
  /** Current shared time-axis scale (1 = normal). */
  scale: number;
  onScaleChange?: (scale: number) => void;
  onNavigate?: (direction: PeriodDirection) => void;
  /** False at the newest period. Never navigate into the future. */
  canNext: boolean;
  previousLabel: string;
  nextLabel: string;
  currentLabel: string;
  /** Overlay/menu/detail open: terminate and ignore axis gestures. */
  disabled?: boolean;
  /** Date/mode/baby changes cancel any pending gesture. */
  resetKey?: string;
}

export interface TimelineScrollDetail {
  scrollTop: number;
  scrollHeight: number;
  scrollWidth?: number;
  deltaX?: number;
  deltaY?: number;
  isDrag?: boolean;
}

export type TimelineScrollEvent = BaseEventOrig<TimelineScrollDetail>;

type TouchLike = { clientX: number; clientY: number };
type NativeTouchHandler = (event: BaseEventOrig) => void;
interface NativeScrollView {
  scrollTo?: (options: { top?: number; animated?: boolean }) => void;
  scrollEnabled?: boolean;
}

interface Feedback {
  text: string;
  placement: FeedbackPlacement;
}

export interface TimelineGestures {
  scrollId: string;
  canvasId: string;
  /** Measured canvas height for the current scale; 0 until geometry is available. */
  canvasHeight: number;
  /** Controlled fallback offset for native ScrollView; H5 is moved directly. */
  scrollTop: number;
  isPinching: boolean;
  feedback: string;
  feedbackPlacement: FeedbackPlacement;
  onScroll: (event: TimelineScrollEvent) => void;
  /** Spread onto the time canvas on native; H5 installs element-scoped listeners. */
  nativeTouchProps: {
    onTouchStart?: NativeTouchHandler;
    onTouchMove?: NativeTouchHandler;
    onTouchEnd?: NativeTouchHandler;
    onTouchCancel?: NativeTouchHandler;
  };
  consumeClickSuppression: () => boolean;
  cancel: () => void;
}

const pointsFromTouches = (touches: ArrayLike<TouchLike> | undefined, viewportTop: number): GesturePoint[] =>
  Array.from(touches || []).map((touch) => ({
    x: touch.clientX,
    y: touch.clientY - viewportTop,
  }));

export function useTimelineGestures(options: TimelineGestureOptions): TimelineGestures {
  const rawId = useId();
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const scrollId = `bubu-axis-scroll-${safeId}`;
  const canvasId = `${scrollId}-canvas`;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const stateRef = useRef<GestureState>(createGestureState(options.scale));
  const scaleRef = useRef(options.scale);
  const metricsRef = useRef<GestureMetrics>({
    scrollTop: 0, viewportHeight: 0, contentHeight: 0, canvasTop: 0, canvasHeight: 0,
  });
  const viewportTopRef = useRef(0);
  const scrollContextRef = useRef<NativeScrollView | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const [feedback, setFeedback] = useState<Feedback>({ text: "", placement: "center" });
  const [isPinching, setIsPinching] = useState(false);
  const [baseCanvasHeight, setBaseCanvasHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const showFeedback = useCallback((text: string, placement: FeedbackPlacement = "center") => {
    setFeedback((previous) => previous.text === text && previous.placement === placement
      ? previous
      : { text, placement });
  }, []);

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
  }, []);

  const showTransientFeedback = useCallback((text: string, placement: FeedbackPlacement = "center") => {
    clearFeedbackTimer();
    showFeedback(text, placement);
    feedbackTimerRef.current = setTimeout(() => {
      if (mountedRef.current) showFeedback("", "center");
    }, 1600);
  }, [clearFeedbackTimer, showFeedback]);

  const markSuppressed = useCallback(() => {
    suppressClickRef.current = true;
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false;
    }, 700);
  }, []);

  const config = useCallback((): GestureConfig => {
    const current = optionsRef.current;
    return {
      canNext: current.canNext,
      labels: {
        previous: current.previousLabel,
        next: current.nextLabel,
        current: current.currentLabel,
      },
    };
  }, []);

  const applyScrollTopNow = useCallback((top: number) => {
    const next = Math.max(0, top);
    metricsRef.current.scrollTop = next;
    if (process.env.TARO_ENV === "h5") {
      if (typeof document !== "undefined") {
        const element = document.getElementById(scrollId);
        if (element) element.scrollTop = next;
      }
    } else {
      scrollContextRef.current?.scrollTo?.({ top: next, animated: false });
    }
    // Keep the fallback prop moving even when the optimistic value matches the
    // previously rendered one; the native context above is the primary path.
    setScrollTop((previous) => Math.abs(previous - next) < 0.5 ? next + 0.01 : next);
  }, [scrollId]);

  const setNativeScrollEnabled = useCallback((enabled: boolean) => {
    if (process.env.TARO_ENV === "h5") return;
    const context = scrollContextRef.current;
    if (context) context.scrollEnabled = enabled;
  }, []);

  const measureNow = useCallback(() => {
    const scale = scaleRef.current || 1;
    const generation = ++measureGenerationRef.current;
    if (process.env.TARO_ENV === "h5") {
      if (typeof document === "undefined") return;
      const element = document.getElementById(scrollId);
      const canvas = document.getElementById(canvasId);
      if (!element || !canvas) return;
      const viewRect = element.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const canvasHeight = canvasRect.height;
      const base = canvasHeight > 0 ? canvasHeight / scale : 0;
      metricsRef.current = {
        scrollTop: element.scrollTop,
        viewportHeight: element.clientHeight,
        contentHeight: element.scrollHeight,
        canvasTop: canvasRect.top - viewRect.top + element.scrollTop,
        canvasHeight,
      };
      viewportTopRef.current = viewRect.top;
      if (base > 0) setBaseCanvasHeight((previous) => Math.abs(previous - base) > 0.5 ? base : previous);
      return;
    }
    const query = Taro.createSelectorQuery();
    query.select(`#${scrollId}`).boundingClientRect();
    query.select(`#${canvasId}`).boundingClientRect();
    query.exec((result) => {
      // Native selector queries resolve asynchronously. A newer pinch frame or a
      // different scale may already be current, so stale callbacks must not write.
      if (!mountedRef.current || generation !== measureGenerationRef.current) return;
      if (Math.abs((scaleRef.current || 1) - scale) > 0.001) return;
      const view = result?.[0] as { top: number; height: number } | undefined;
      const canvas = result?.[1] as { top: number; height: number } | undefined;
      if (!view || !canvas) return;
      const scroll = metricsRef.current.scrollTop;
      const canvasHeight = canvas.height;
      const base = canvasHeight > 0 ? canvasHeight / scale : 0;
      const canvasTop = canvas.top - view.top + scroll;
      metricsRef.current = {
        ...metricsRef.current,
        viewportHeight: view.height,
        canvasHeight,
        canvasTop,
        // Recompute rather than max(): zooming out must shrink the content height.
        contentHeight: Math.max(view.height, canvasTop + canvasHeight),
      };
      viewportTopRef.current = view.top;
      if (base > 0) setBaseCanvasHeight((previous) => Math.abs(previous - base) > 0.5 ? base : previous);
    });
  }, [scrollId, canvasId]);

  const scheduleMeasure = useCallback(() => {
    if (measureTimerRef.current) clearTimeout(measureTimerRef.current);
    measureTimerRef.current = setTimeout(() => {
      if (mountedRef.current) measureNow();
    }, 0);
  }, [measureNow]);

  const syncVisual = useCallback((next: GestureState) => {
    setIsPinching(next.phase === "pinch");
    // Apply the native scroll lock synchronously on the second touchstart, before
    // the state-driven catchMove update commits.
    setNativeScrollEnabled(next.phase !== "pinch");
    if (next.feedback) showFeedback(next.feedback, next.placement);
    else showFeedback("", "center");
  }, [setNativeScrollEnabled, showFeedback]);

  const handleStartPoints = useCallback((points: GesturePoint[]) => {
    if (!points.length || optionsRef.current.disabled) return;
    const fresh = stateRef.current.phase === "idle" || stateRef.current.phase === "done";
    if (fresh && points.length === 1) {
      suppressClickRef.current = false;
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
    if (points.length >= 2) measureNow();
    const next = pointerDown(stateRef.current, {
      points,
      metrics: metricsRef.current,
      scale: scaleRef.current,
      config: config(),
    });
    stateRef.current = next;
    if (next.suppressClick) markSuppressed();
    syncVisual(next);
  }, [config, markSuppressed, measureNow, syncVisual]);

  const handleMovePoints = useCallback((points: GesturePoint[]) => {
    if (!points.length || optionsRef.current.disabled) return;
    const update: GestureUpdate = pointerMove(stateRef.current, {
      points,
      metrics: metricsRef.current,
      config: config(),
    });
    stateRef.current = update.state;
    if (update.state.suppressClick) markSuppressed();
    if (update.scaleChanged && optionsRef.current.onScaleChange) {
      scaleRef.current = update.state.scale;
      if (update.scrollTop != null) pendingScrollTopRef.current = update.scrollTop;
      optionsRef.current.onScaleChange(update.state.scale);
    } else if (update.scrollTop != null) {
      applyScrollTopNow(update.scrollTop);
    }
    syncVisual(update.state);
  }, [applyScrollTopNow, config, markSuppressed, syncVisual]);

  const cancel = useCallback(() => {
    const next = cancelGesture(stateRef.current);
    stateRef.current = next;
    pendingScrollTopRef.current = null;
    setIsPinching(false);
    setNativeScrollEnabled(true);
    clearFeedbackTimer();
    showFeedback("", "center");
  }, [clearFeedbackTimer, setNativeScrollEnabled, showFeedback]);

  const handleEndPoints = useCallback((remaining: GesturePoint[], changed: GesturePoint[]) => {
    if (optionsRef.current.disabled) {
      cancel();
      return;
    }
    const update = pointerUp(stateRef.current, {
      remaining,
      changed,
      metrics: metricsRef.current,
      config: config(),
    });
    stateRef.current = update.state;
    setIsPinching(false);
    setNativeScrollEnabled(true);
    if (update.state.suppressClick) markSuppressed();
    if (update.navigation) {
      clearFeedbackTimer();
      showFeedback("", "center");
      optionsRef.current.onNavigate?.(update.navigation);
    } else if (update.blocked) {
      showTransientFeedback(update.state.feedback, "center");
    } else {
      clearFeedbackTimer();
      showFeedback("", "center");
    }
    if (update.ended) scheduleMeasure();
  }, [cancel, clearFeedbackTimer, config, markSuppressed, scheduleMeasure, setNativeScrollEnabled, showFeedback, showTransientFeedback]);

  const handleCancel = useCallback(() => {
    cancel();
    markSuppressed();
  }, [cancel, markSuppressed]);

  const consumeClickSuppression = useCallback(() => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    suppressTimerRef.current = null;
    return suppressed;
  }, []);

  const onScroll = useCallback((event: TimelineScrollEvent) => {
    const detail = event?.detail;
    if (!detail) return;
    if (typeof detail.scrollTop === "number" && Number.isFinite(detail.scrollTop)) {
      metricsRef.current.scrollTop = detail.scrollTop;
    }
    if (typeof detail.scrollHeight === "number" && detail.scrollHeight > 0) {
      metricsRef.current.contentHeight = detail.scrollHeight;
    }
  }, []);

  // Keep the prop scale available to gesture handlers before the next render.
  scaleRef.current = options.scale;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (measureTimerRef.current) clearTimeout(measureTimerRef.current);
      stateRef.current = cancelGesture(stateRef.current);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (mountedRef.current) measureNow();
    }, 0);
    return () => clearTimeout(timer);
  }, [measureNow]);

  useEffect(() => {
    if (process.env.TARO_ENV === "h5") {
      if (typeof window === "undefined") return;
      const resize = () => measureNow();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const resize = () => measureNow();
    Taro.onWindowResize(resize);
    return () => Taro.offWindowResize(resize);
  }, [measureNow]);

  useEffect(() => {
    if (process.env.TARO_ENV === "h5") return;
    const query = Taro.createSelectorQuery();
    query.select(`#${scrollId}`).node();
    query.exec((result) => {
      if (!mountedRef.current) return;
      const node = result?.[0]?.node as NativeScrollView | undefined;
      if (node?.scrollTo) {
        scrollContextRef.current = node;
        // The node may resolve after a pinch already began.
        node.scrollEnabled = stateRef.current.phase !== "pinch";
      }
    });
  }, [scrollId]);

  useEffect(() => {
    // Enhanced ScrollView exposes scrollEnabled on native; disable only the user
    // drag while pinching so programmatic anchoring still works and one-finger
    // scrolling immediately returns after the pinch ends.
    setNativeScrollEnabled(!isPinching);
  }, [isPinching, setNativeScrollEnabled]);

  useEffect(() => () => {
    setNativeScrollEnabled(true);
  }, [setNativeScrollEnabled]);

  useEffect(() => {
    scaleRef.current = options.scale;
    if (pendingScrollTopRef.current != null) {
      const top = pendingScrollTopRef.current;
      pendingScrollTopRef.current = null;
      applyScrollTopNow(top);
    }
    if (stateRef.current.phase !== "pinch") scheduleMeasure();
  }, [applyScrollTopNow, options.scale, scheduleMeasure]);

  useEffect(() => {
    cancel();
  }, [cancel, options.resetKey]);

  useEffect(() => {
    if (options.disabled) cancel();
  }, [cancel, options.disabled]);

  // H5's ScrollView host stops touchmove propagation before React's synthetic
  // listener, so gesture listeners are installed directly on the scroll element.
  useEffect(() => {
    if (process.env.TARO_ENV !== "h5" || typeof document === "undefined") return;
    const element = document.getElementById(scrollId);
    if (!element) return;
    const localTop = () => element.getBoundingClientRect().top;
    const refreshScrollMetrics = () => {
      metricsRef.current.viewportHeight = element.clientHeight;
      metricsRef.current.contentHeight = element.scrollHeight;
    };
    const start = (event: TouchEvent) => {
      // Read geometry synchronously at every gesture start. Programmatic or
      // momentum scrolling may have moved the offset since the last scroll event,
      // and boundary detection must use the exact offset under the finger.
      refreshScrollMetrics();
      measureNow();
      const points = pointsFromTouches(event.touches, localTop());
      handleStartPoints(points);
    };
    const move = (event: TouchEvent) => {
      const points = pointsFromTouches(event.touches, localTop());
      handleMovePoints(points);
      const phase = stateRef.current.phase;
      if (points.length >= 2 || phase === "pinch" || phase === "horizontal" || phase === "pull") {
        event.preventDefault();
      }
    };
    const end = (event: TouchEvent) => {
      handleEndPoints(
        pointsFromTouches(event.touches, localTop()),
        pointsFromTouches(event.changedTouches, localTop()),
      );
    };
    const cancelTouch = () => handleCancel();
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false, capture: true });
    element.addEventListener("touchend", end, { passive: true });
    element.addEventListener("touchcancel", cancelTouch, { passive: true });
    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move, { capture: true });
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", cancelTouch);
    };
  }, [scrollId, handleCancel, handleEndPoints, handleMovePoints, handleStartPoints, measureNow]);

  const nativeTouchProps = process.env.TARO_ENV === "h5" ? {} : {
    onTouchStart: (event: BaseEventOrig) => {
      const touchEvent = event as ITouchEvent;
      handleStartPoints(pointsFromTouches(touchEvent.touches, viewportTopRef.current));
    },
    onTouchMove: (event: BaseEventOrig) => {
      const touchEvent = event as ITouchEvent;
      handleMovePoints(pointsFromTouches(touchEvent.touches, viewportTopRef.current));
    },
    onTouchEnd: (event: BaseEventOrig) => {
      const touchEvent = event as ITouchEvent;
      handleEndPoints(
        pointsFromTouches(touchEvent.touches, viewportTopRef.current),
        pointsFromTouches(touchEvent.changedTouches, viewportTopRef.current),
      );
    },
    onTouchCancel: () => handleCancel(),
  };

  return {
    scrollId,
    canvasId,
    canvasHeight: baseCanvasHeight > 0 ? baseCanvasHeight * options.scale : 0,
    scrollTop,
    isPinching,
    feedback: feedback.text,
    feedbackPlacement: feedback.placement,
    onScroll,
    nativeTouchProps,
    consumeClickSuppression,
    cancel,
  };
}
