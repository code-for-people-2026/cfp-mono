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
  type PaperTurnState,
} from "./model";
import { paperTurnTransition, type PaperTurnPhase } from "./paper-turn";
import {
  createScrollChromeState,
  resetScrollChromeState,
  shouldTrackScrollIntent,
  updateScrollIntent,
} from "./scroll-chrome";

export interface TimelineGestureOptions {
  /** Current shared time-axis scale (1 = normal). */
  scale: number;
  onScaleChange?: (scale: number) => void;
  onNavigate?: (direction: PeriodDirection) => void;
  /** Returns whether the adjacent real page can be committed without a placeholder. */
  onNavigateReady?: (direction: PeriodDirection) => boolean;
  /** Ordinary one-finger vertical scrolling asks the timeline chrome to hide/show. */
  onScrollIntent?: (intent: "hide" | "show") => void;
  /** False at the newest period. Never navigate into the future. */
  canNext: boolean;
  previousLabel: string;
  nextLabel: string;
  currentLabel: string;
  /** Overlay/menu/detail open: terminate and ignore axis gestures. */
  disabled?: boolean;
  /** Date/mode/baby changes cancel any pending gesture. */
  resetKey?: string;
  /** Layout shift outside the ScrollView (for example a collapsing summary). */
  viewportExpansion?: number;
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
type ViewportOrigin = { left: number; top: number };
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
  paperTurn: PaperTurnState;
  /** ScrollView offset captured when the gesture began. */
  gestureScrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
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
  applyScrollTop: (top: number) => void;
}

const pointsFromTouches = (touches: ArrayLike<TouchLike> | undefined, viewportOrigin: ViewportOrigin): GesturePoint[] =>
  Array.from(touches || []).map((touch) => ({
    x: touch.clientX - viewportOrigin.left,
    y: touch.clientY - viewportOrigin.top,
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
  const viewportOriginRef = useRef<ViewportOrigin>({ left: 0, top: 0 });
  const h5TouchViewportOriginRef = useRef<ViewportOrigin | null>(null);
  const scrollContextRef = useRef<NativeScrollView | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnGenerationRef = useRef(0);
  const measureGenerationRef = useRef(0);
  const scrollChromeRef = useRef(createScrollChromeState());
  const reducedMotionRef = useRef(false);
  const mountedRef = useRef(true);

  const [feedback, setFeedback] = useState<Feedback>({ text: "", placement: "center" });
  const [isPinching, setIsPinching] = useState(false);
  const [baseCanvasHeight, setBaseCanvasHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [paperTurn, setPaperTurn] = useState<PaperTurnState>(createGestureState(options.scale).paperTurn);
  const [gestureScrollTop, setGestureScrollTop] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(320);
  const [viewportHeight, setViewportHeight] = useState(440);

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

  const clearTurnTimer = useCallback(() => {
    if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
    turnTimerRef.current = null;
    // A cleared callback must also lose its generation lease. This covers reset,
    // disable and unmount even when the platform timer fires late.
    turnGenerationRef.current += 1;
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
    // Programmatic offsets are not user scrolling. Rebase before the platform
    // echoes the change through onScroll, and never emit a chrome intent here.
    scrollChromeRef.current = resetScrollChromeState(next, scrollChromeRef.current);
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
    if (stateRef.current.paperTurn.phase !== "idle") return;
    const scale = scaleRef.current || 1;
    const generation = ++measureGenerationRef.current;
    if (process.env.TARO_ENV === "h5") {
      if (typeof document === "undefined") return;
      const element = document.getElementById(scrollId);
      const canvas = document.getElementById(canvasId);
      if (!element || !canvas) return;
      const anchor = element.closest(".bubu-timeline-viewport") ?? element;
      const anchorRect = anchor.getBoundingClientRect();
      const viewRect = element.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const canvasHeight = canvasRect.height;
      const base = canvasHeight > 0 ? canvasHeight / scale : 0;
      metricsRef.current = {
        scrollTop: element.scrollTop,
        viewportHeight: element.clientHeight,
        contentHeight: element.scrollHeight,
        canvasTop: canvasRect.top - anchorRect.top + element.scrollTop,
        canvasHeight,
      };
      if (stateRef.current.phase === "idle" || stateRef.current.phase === "done") {
        viewportOriginRef.current = { left: anchorRect.left, top: anchorRect.top };
      }
      setViewportWidth((previous) => Math.abs(previous - viewRect.width) > 0.5 ? viewRect.width : previous);
      setViewportHeight((previous) => Math.abs(previous - viewRect.height) > 0.5 ? viewRect.height : previous);
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
      if (stateRef.current.paperTurn.phase !== "idle") return;
      if (Math.abs((scaleRef.current || 1) - scale) > 0.001) return;
      const selectorResults = result as Array<{
        left?: number;
        top: number;
        height: number;
        width?: number;
      } | null | undefined> | undefined;
      const view = selectorResults?.[0];
      const canvas = selectorResults?.[1];
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
      if ((stateRef.current.phase === "idle" || stateRef.current.phase === "done")
        && typeof view.left === "number" && Number.isFinite(view.left)) {
        viewportOriginRef.current = { left: view.left, top: view.top };
      }
      const width = view.width;
      if (typeof width === "number") {
        setViewportWidth((previous) => Math.abs(previous - width) > 0.5 ? width : previous);
      }
      setViewportHeight((previous) => Math.abs(previous - view.height) > 0.5 ? view.height : previous);
      if (base > 0) setBaseCanvasHeight((previous) => Math.abs(previous - base) > 0.5 ? base : previous);
    });
  }, [scrollId, canvasId]);

  const scheduleMeasure = useCallback(() => {
    if (measureTimerRef.current) clearTimeout(measureTimerRef.current);
    measureTimerRef.current = setTimeout(() => {
      if (mountedRef.current) measureNow();
    }, 0);
  }, [measureNow]);

  const scheduleTurnEnd = useCallback((phase: PaperTurnPhase) => {
    clearTurnTimer();
    const generation = ++turnGenerationRef.current;
    const duration = paperTurnTransition(phase, reducedMotionRef.current).durationMs;
    turnTimerRef.current = setTimeout(() => {
      if (!mountedRef.current || generation !== turnGenerationRef.current) return;
      turnTimerRef.current = null;
      const next: PaperTurnState = {
        ...stateRef.current.paperTurn,
        phase: "idle",
        direction: null,
        displacement: 0,
        origin: undefined,
        crossDisplacement: undefined,
      };
      stateRef.current = { ...stateRef.current, phase: "done", paperTurn: next };
      setPaperTurn(next);
      setNativeScrollEnabled(true);
      scheduleMeasure();
    }, duration);
  }, [clearTurnTimer, scheduleMeasure, setNativeScrollEnabled]);

  const syncVisual = useCallback((next: GestureState) => {
    setIsPinching(next.phase === "pinch");
    // Apply the native scroll lock synchronously on the second touchstart, before
    // the state-driven catchMove update commits.
    setNativeScrollEnabled(next.phase === "idle"
      || next.phase === "pending"
      || next.phase === "done"
      || next.phase === "scroll"
      || next.phase === "blocked");
    setPaperTurn({ ...next.paperTurn, reducedMotion: reducedMotionRef.current });
    if (next.feedback) showFeedback(next.feedback, next.placement);
    else showFeedback("", "center");
  }, [setNativeScrollEnabled, showFeedback]);

  const handleStartPoints = useCallback((points: GesturePoint[]) => {
    if (!points.length || optionsRef.current.disabled) return;
    // A settling turn owns the short animation interval. New touches neither
    // cancel nor restart its timer, so the pending commit cannot be duplicated.
    if (stateRef.current.phase === "settling") return;
    const fresh = stateRef.current.phase === "idle" || stateRef.current.phase === "done";
    if (fresh && points.length === 1) {
      suppressClickRef.current = false;
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
      setGestureScrollTop(metricsRef.current.scrollTop);
      scrollChromeRef.current = resetScrollChromeState(metricsRef.current.scrollTop);
      clearTurnTimer();
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
  }, [clearTurnTimer, config, markSuppressed, measureNow, syncVisual]);

  const handleMovePoints = useCallback((points: GesturePoint[]) => {
    if (!points.length || optionsRef.current.disabled) return;
    if (stateRef.current.phase === "settling") return;
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

  const cancel = useCallback((animate = false) => {
    const next = cancelGesture(stateRef.current, animate);
    stateRef.current = next;
    pendingScrollTopRef.current = null;
    if (animate && next.paperTurn.phase === "recoil") scheduleTurnEnd("recoil");
    else clearTurnTimer();
    setIsPinching(false);
    setPaperTurn({ ...next.paperTurn, reducedMotion: reducedMotionRef.current });
    setNativeScrollEnabled(true);
    clearFeedbackTimer();
    showFeedback("", "center");
  }, [clearFeedbackTimer, clearTurnTimer, scheduleTurnEnd, setNativeScrollEnabled, showFeedback]);

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
    if (update.state.phase !== "settling") setNativeScrollEnabled(true);
    // The release frame itself must render `complete` or `recoil`; waiting for
    // the timer would skip the CSS transition and jump directly to the new date.
    syncVisual(update.state);
    if (update.state.suppressClick) markSuppressed();
    if (update.navigation) {
      clearFeedbackTimer();
      const ready = optionsRef.current.onNavigateReady?.(update.navigation) ?? true;
      if (ready) {
        clearTurnTimer();
        const generation = ++turnGenerationRef.current;
        const duration = paperTurnTransition(update.state.paperTurn.phase, reducedMotionRef.current).durationMs;
        turnTimerRef.current = setTimeout(() => {
          if (!mountedRef.current || generation !== turnGenerationRef.current) return;
          turnTimerRef.current = null;
          optionsRef.current.onNavigate?.(update.navigation!);
          const next = {
            ...stateRef.current.paperTurn,
            phase: "idle" as const,
            direction: null,
            displacement: 0,
            origin: undefined,
            crossDisplacement: undefined,
          };
          stateRef.current = { ...stateRef.current, phase: "done", paperTurn: next };
          setPaperTurn(next);
          setNativeScrollEnabled(true);
          scheduleMeasure();
        }, duration);
      } else {
        const next = {
          ...update.state,
          phase: "done" as const,
          paperTurn: { ...update.state.paperTurn, phase: "recoil" as const },
        };
        stateRef.current = next;
        setPaperTurn({ ...next.paperTurn, reducedMotion: reducedMotionRef.current });
        scheduleTurnEnd("recoil");
        showTransientFeedback(`正在准备${update.navigation === "prev" ? config().labels.previous : config().labels.next}，请稍后再试`);
      }
    } else if (update.blocked) {
      showTransientFeedback(update.state.feedback, "center");
    } else {
      clearFeedbackTimer();
      showFeedback("", "center");
      if (update.state.paperTurn.phase === "recoil") scheduleTurnEnd("recoil");
    }
    if (update.ended) scheduleMeasure();
  }, [cancel, clearFeedbackTimer, clearTurnTimer, config, markSuppressed, scheduleMeasure, scheduleTurnEnd, setNativeScrollEnabled, showFeedback, showTransientFeedback, syncVisual]);

  const handleCancel = useCallback(() => {
    cancel(true);
    markSuppressed();
  }, [cancel, markSuppressed]);

  const consumeClickSuppression = useCallback(() => {
    // Touchend can precede the synthetic click while recoil is still running.
    // Keep the lease until the settling timer has actually finished.
    if (stateRef.current.phase === "settling") {
      suppressClickRef.current = true;
      return true;
    }
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
      const scrollTop = detail.scrollTop;
      metricsRef.current.scrollTop = scrollTop;
      if (stateRef.current.phase === "idle" || stateRef.current.phase === "done") {
        setGestureScrollTop(scrollTop);
      }
      const trackIntent = shouldTrackScrollIntent({
        phase: stateRef.current.phase,
        pointerCount: stateRef.current.pointerCount,
        isDrag: detail.isDrag,
      });
      if (!trackIntent) {
        // Pulls, pinches, settling turns and programmatic restoration all rebase
        // without emission, so a later real scroll starts from the actual offset.
        scrollChromeRef.current = resetScrollChromeState(
          scrollTop,
          scrollChromeRef.current,
          stateRef.current.phase !== "idle" && stateRef.current.phase !== "done",
        );
      } else {
        const result = updateScrollIntent(scrollChromeRef.current, scrollTop, Date.now());
        scrollChromeRef.current = result.state;
        if (result.intent) optionsRef.current.onScrollIntent?.(result.intent);
      }
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
      clearTurnTimer();
      stateRef.current = cancelGesture(stateRef.current);
    };
  }, [clearTurnTimer]);

  useEffect(() => {
    if (process.env.TARO_ENV !== "h5" || typeof window?.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reducedMotionRef.current = query.matches;
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (mountedRef.current) measureNow();
    }, 0);
    return () => clearTimeout(timer);
  }, [measureNow]);

  useEffect(() => {
    const immediateTimer = setTimeout(() => {
      if (mountedRef.current) measureNow();
    }, 0);
    const settledTimer = setTimeout(() => {
      if (mountedRef.current) measureNow();
    }, 220);
    return () => {
      clearTimeout(immediateTimer);
      clearTimeout(settledTimer);
    };
  }, [options.viewportExpansion, measureNow]);

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
      const nodeResult = result as Array<{ node?: NativeScrollView } | null | undefined> | undefined;
      const node = nodeResult?.[0]?.node;
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
    const localOrigin = () => {
      const anchor = element.closest(".bubu-timeline-viewport") ?? element;
      const rect = anchor.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    };
    const gestureOrigin = () => h5TouchViewportOriginRef.current ?? localOrigin();
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
      // Keep the viewport origin captured by the first touch fixed for the whole
      // gesture, including a later second touch that starts a pinch.
      if (h5TouchViewportOriginRef.current == null) {
        h5TouchViewportOriginRef.current = localOrigin();
      }
      const points = pointsFromTouches(event.touches, gestureOrigin());
      handleStartPoints(points);
    };
    const move = (event: TouchEvent) => {
      const points = pointsFromTouches(event.touches, gestureOrigin());
      handleMovePoints(points);
      const phase = stateRef.current.phase;
      if (points.length >= 2 || phase === "pinch" || phase === "horizontal" || phase === "settling") {
        event.preventDefault();
      }
    };
    const end = (event: TouchEvent) => {
      handleEndPoints(
        pointsFromTouches(event.touches, gestureOrigin()),
        pointsFromTouches(event.changedTouches, gestureOrigin()),
      );
      if (event.touches.length === 0) h5TouchViewportOriginRef.current = null;
    };
    const cancelTouch = () => {
      h5TouchViewportOriginRef.current = null;
      handleCancel();
    };
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
      handleStartPoints(pointsFromTouches(touchEvent.touches, viewportOriginRef.current));
    },
    onTouchMove: (event: BaseEventOrig) => {
      const touchEvent = event as ITouchEvent;
      handleMovePoints(pointsFromTouches(touchEvent.touches, viewportOriginRef.current));
    },
    onTouchEnd: (event: BaseEventOrig) => {
      const touchEvent = event as ITouchEvent;
      handleEndPoints(
        pointsFromTouches(touchEvent.touches, viewportOriginRef.current),
        pointsFromTouches(touchEvent.changedTouches, viewportOriginRef.current),
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
    paperTurn,
    gestureScrollTop,
    viewportWidth,
    viewportHeight,
    feedback: feedback.text,
    feedbackPlacement: feedback.placement,
    onScroll,
    nativeTouchProps,
    consumeClickSuppression,
    cancel,
    applyScrollTop: applyScrollTopNow,
  };
}
