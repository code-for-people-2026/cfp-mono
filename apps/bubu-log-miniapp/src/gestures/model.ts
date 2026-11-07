/**
 * Pure day/week time-axis gesture state and geometry.
 *
 * No Taro or DOM access here: the React/ScrollView adapter translates native or
 * browser touch events into these plain points and applies the returned scale and
 * scroll offset. Keeping the rules pure lets the threshold, cancellation, boundary,
 * pointer-count and pinch-anchor cases stay covered by fast unit tests.
 */

export type PeriodDirection = "prev" | "next";
export type GesturePhase =
  | "idle"
  | "pending"
  | "horizontal"
  | "pull"
  | "scroll"
  | "pinch"
  | "blocked"
  | "settling"
  | "done";
export type PullEdge = "top" | "bottom";
export type FeedbackPlacement = "top" | "bottom" | "center";

/** Physical CSS pixels. */
export const SWIPE_THRESHOLD = 72;
/** Horizontal/vertical direction lock distance in physical CSS pixels. */
export const DIRECTION_LOCK = 12;
/** Movement above this suppresses the synthetic click that follows touchend. */
export const TOUCH_SLOP = 8;
export const BOUNDARY_TOLERANCE = 2;
/** A pinch must begin with at least this vertical separation. */
export const MIN_PINCH_SEPARATION = 24;
/** Below this separation a pinch frame is ignored instead of jumping. */
export const MIN_PINCH_STEP = 8;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3;

export interface GesturePoint {
  /** Viewport-local x in physical CSS pixels. */
  x: number;
  /** Viewport-local y in physical CSS pixels. */
  y: number;
}

export interface GestureMetrics {
  /** Current ScrollView vertical offset. */
  scrollTop: number;
  /** Visible height of the time-axis viewport. */
  viewportHeight: number;
  /** Total scrollable content height, used only for bottom-boundary detection. */
  contentHeight: number;
  /** Content-space top of the time canvas (its fixed margin inside the scroller). */
  canvasTop: number;
  /** Rendered time-canvas height at the current scale. */
  canvasHeight: number;
}

export interface GestureConfig {
  /** False when the current period is the newest period; never request the future. */
  canNext: boolean;
  labels: {
    /** e.g. 前一天 / 前一周 */
    previous: string;
    /** e.g. 后一天 / 后一周 */
    next: string;
    /** e.g. 今天 / 本周 */
    current: string;
  };
}

export interface PinchState {
  startDistance: number;
  startScale: number;
  baseCanvasHeight: number;
  canvasTop: number;
  viewportHeight: number;
  bottomPad: number;
}

export interface GestureState {
  phase: GesturePhase;
  config: GestureConfig;
  pointerCount: number;
  startPoints: GesturePoint[];
  startScrollTop: number;
  atTop: boolean;
  atBottom: boolean;
  edge: PullEdge | null;
  /** Direction chosen by the current horizontal swipe or boundary pull. */
  direction: PeriodDirection | null;
  armed: boolean;
  feedback: string;
  placement: FeedbackPlacement;
  suppressClick: boolean;
  scale: number;
  pinch: PinchState | null;
  paperTurn: PaperTurnState;
}

export interface PaperTurnState {
  phase: PaperTurnPhase;
  axis: PaperTurnAxis;
  direction: PaperDirection | null;
  displacement: number;
  /** First touch in stable viewport-local coordinates. */
  origin?: GesturePoint;
  /** Cross-axis displacement: dy for horizontal turns, dx for vertical turns. */
  crossDisplacement?: number;
  reducedMotion: boolean;
}

export interface GestureUpdate {
  state: GestureState;
  scaleChanged: boolean;
  /** Offset the adapter should apply after the canvas has the new height. */
  scrollTop: number | null;
  navigation: PeriodDirection | null;
  blocked: boolean;
  ended: boolean;
}
import type { PaperTurnAxis, PaperTurnDirection, PaperTurnPhase } from "./paper-turn";

type PaperDirection = PaperTurnDirection;

export interface PointerInput {
  points: GesturePoint[];
  metrics: GestureMetrics;
  scale: number;
  config: GestureConfig;
}

export interface MoveInput {
  points: GesturePoint[];
  metrics: GestureMetrics;
  config: GestureConfig;
}

export interface UpInput {
  remaining: GesturePoint[];
  changed: GesturePoint[];
  metrics: GestureMetrics;
  config: GestureConfig;
}

const cloneConfig = (config: GestureConfig): GestureConfig => ({
  canNext: config.canNext,
  labels: { ...config.labels },
});

export function createGestureState(scale = 1): GestureState {
  return {
    phase: "idle",
    config: { canNext: false, labels: { previous: "前一段", next: "后一段", current: "当前" } },
    pointerCount: 0,
    startPoints: [],
    startScrollTop: 0,
    atTop: false,
    atBottom: false,
    edge: null,
    direction: null,
    armed: false,
    feedback: "",
    placement: "center",
    suppressClick: false,
    scale,
    pinch: null,
    paperTurn: { phase: "idle", axis: "horizontal", direction: null, displacement: 0, reducedMotion: false },
  };
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const clampScale = (value: number): number => clamp(Number.isFinite(value) ? value : 1, MIN_SCALE, MAX_SCALE);

export function verticalDistance(a: GesturePoint, b: GesturePoint): number {
  return Math.abs(a.y - b.y);
}

const pointOf = (points: readonly GesturePoint[]): GesturePoint => points[0] || { x: 0, y: 0 };

const blockedFeedback = (config: GestureConfig): string => `已经是${config.labels.current}，无法查看未来`;

const horizontalFeedback = (direction: PeriodDirection, armed: boolean, config: GestureConfig): string => {
  if (direction === "next" && !config.canNext) return blockedFeedback(config);
  const label = direction === "prev" ? config.labels.previous : config.labels.next;
  const swipe = direction === "prev" ? "右" : "左";
  return armed ? `松开切换${label}` : `继续${swipe}滑查看${label}`;
};

const pullFeedback = (edge: PullEdge, armed: boolean, config: GestureConfig): string => {
  if (edge === "bottom" && !config.canNext) return blockedFeedback(config);
  const label = edge === "top" ? config.labels.previous : config.labels.next;
  const pull = edge === "top" ? "下拉" : "上拉";
  return armed ? `松开切换${label}` : `继续${pull}查看${label}`;
};

const clearPaperTurn = (state: GestureState): PaperTurnState => ({
  ...state.paperTurn,
  phase: "idle",
  direction: null,
  displacement: 0,
  origin: undefined,
  crossDisplacement: undefined,
});

const baseStart = (points: readonly GesturePoint[], metrics: GestureMetrics, scale: number, config: GestureConfig): GestureState => ({
  ...createGestureState(scale),
  phase: "pending",
  config: cloneConfig(config),
  pointerCount: points.length,
  startPoints: points.map((point) => ({ ...point })),
  startScrollTop: metrics.scrollTop,
  atTop: metrics.scrollTop <= BOUNDARY_TOLERANCE,
  atBottom: metrics.contentHeight > 0
    && metrics.scrollTop + metrics.viewportHeight >= metrics.contentHeight - BOUNDARY_TOLERANCE,
});

const block = (state: GestureState, pointerCount: number, config?: GestureConfig): GestureState => ({
  ...state,
  config: config ? cloneConfig(config) : state.config,
  phase: "blocked",
  pointerCount,
  edge: null,
  direction: null,
  armed: false,
  feedback: "",
  placement: "center",
  suppressClick: true,
  pinch: null,
  paperTurn: clearPaperTurn(state),
});

function startPinch(state: GestureState, points: readonly GesturePoint[], metrics: GestureMetrics): GestureState {
  if (points.length !== 2) return block(state, points.length);
  const separation = verticalDistance(points[0]!, points[1]!);
  if (separation < MIN_PINCH_SEPARATION || metrics.canvasHeight <= 0 || state.scale <= 0) {
    // A two-finger tap with almost no separation is consumed: it must not navigate.
    return block(state, points.length);
  }
  const baseCanvasHeight = metrics.canvasHeight / state.scale;
  return {
    ...state,
    phase: "pinch",
    pointerCount: 2,
    edge: null,
    direction: null,
    armed: false,
    feedback: `双指上下缩放 ${state.scale.toFixed(1)}×`,
    placement: "center",
    suppressClick: true,
    pinch: {
      startDistance: separation,
      startScale: state.scale,
      baseCanvasHeight,
      canvasTop: metrics.canvasTop,
      viewportHeight: metrics.viewportHeight,
      bottomPad: Math.max(0, metrics.contentHeight - metrics.canvasTop - metrics.canvasHeight),
    },
  };
}

export interface PinchFrameInput {
  pinchStartScale: number;
  startDistance: number;
  currentScale: number;
  distance: number;
  midY: number;
  scrollTop: number;
  canvasTop: number;
  baseCanvasHeight: number;
  viewportHeight: number;
  bottomPad: number;
}

export interface PinchFrame {
  scale: number;
  scrollTop: number;
}

/**
 * Scale around the current two-finger midpoint while keeping the time under that
 * midpoint fixed in the viewport. The result is clamped so the viewport never
 * jumps above 00:00 or below 24:00.
 */
export function resolvePinchFrame(input: PinchFrameInput): PinchFrame {
  const { pinchStartScale, startDistance, currentScale, distance, midY, scrollTop,
    canvasTop, baseCanvasHeight, viewportHeight, bottomPad } = input;
  const currentCanvasHeight = baseCanvasHeight * currentScale;
  if (startDistance < MIN_PINCH_SEPARATION || distance < MIN_PINCH_STEP
    || currentCanvasHeight <= 0 || baseCanvasHeight <= 0 || viewportHeight <= 0) {
    return { scale: clampScale(currentScale), scrollTop };
  }
  const targetScale = clampScale(pinchStartScale * distance / startDistance);
  // Anchor against the currently rendered height so repeated frames do not drift.
  const anchorRatio = clamp((scrollTop + midY - canvasTop) / currentCanvasHeight, 0, 1);
  const nextCanvasHeight = baseCanvasHeight * targetScale;
  const maxScroll = Math.max(0, canvasTop + nextCanvasHeight + bottomPad - viewportHeight);
  const nextScroll = clamp(canvasTop + anchorRatio * nextCanvasHeight - midY, 0, maxScroll);
  return { scale: targetScale, scrollTop: nextScroll };
}

export function pointerDown(state: GestureState, input: PointerInput): GestureState {
  const { points, metrics, scale, config } = input;
  if (state.phase === "settling") return { ...state, config: cloneConfig(config) };
  const fresh = state.phase === "idle" || state.phase === "done";
  const next = fresh ? { ...createGestureState(scale), config: cloneConfig(config) } : { ...state, config: cloneConfig(config) };
  if (points.length >= 3) return block(next, points.length, config);
  if (points.length === 2) {
    // A second finger joining a locked paper-turn drag cancels that drag. A
    // pending touch has not chosen an axis yet, so it can still become a pinch.
    if (!fresh && state.phase !== "pinch" && state.phase !== "pending") {
      return block(next, points.length, config);
    }
    if (fresh) return startPinch(baseStart(points, metrics, scale, config), points, metrics);
    return startPinch(next, points, metrics);
  }
  if (points.length === 1 && fresh) return baseStart(points, metrics, scale, config);
  return block(next, points.length, config);
}

function movePinch(state: GestureState, input: MoveInput): GestureUpdate {
  const { points, metrics, config } = input;
  if (points.length !== 2) return { state: block(state, points.length, config), scaleChanged: false, scrollTop: null, navigation: null, blocked: false, ended: false };
  const pinch = state.pinch;
  if (!pinch) return { state: block(state, points.length, config), scaleChanged: false, scrollTop: null, navigation: null, blocked: false, ended: false };
  const distance = verticalDistance(points[0]!, points[1]!);
  const midY = (points[0]!.y + points[1]!.y) / 2;
  const frame = resolvePinchFrame({
    pinchStartScale: pinch.startScale,
    startDistance: pinch.startDistance,
    currentScale: state.scale,
    distance,
    midY,
    scrollTop: metrics.scrollTop,
    canvasTop: pinch.canvasTop,
    baseCanvasHeight: pinch.baseCanvasHeight,
    viewportHeight: pinch.viewportHeight,
    bottomPad: pinch.bottomPad,
  });
  const scaleChanged = Math.abs(frame.scale - state.scale) > 0.001;
  const next: GestureState = {
    ...state,
    config: cloneConfig(config),
    pointerCount: points.length,
    scale: frame.scale,
    feedback: `双指上下缩放 ${frame.scale.toFixed(1)}×`,
    placement: "center",
    suppressClick: true,
  };
  return {
    state: next,
    scaleChanged,
    scrollTop: scaleChanged || Math.abs(frame.scrollTop - metrics.scrollTop) > 0.5 ? frame.scrollTop : null,
    navigation: null,
    blocked: false,
    ended: false,
  };
}

export function pointerMove(state: GestureState, input: MoveInput): GestureUpdate {
  const { points, config } = input;
  if (state.phase === "idle" || state.phase === "done" || state.phase === "settling") {
    return { state, scaleChanged: false, scrollTop: null, navigation: null, blocked: false, ended: false };
  }
  if (points.length >= 3) {
    return { state: block(state, points.length, config), scaleChanged: false, scrollTop: null, navigation: null, blocked: false, ended: false };
  }
  if (state.phase === "pinch") {
    return movePinch(state, input);
  }
  if (points.length === 2) {
    return { state: block(state, points.length, config), scaleChanged: false, scrollTop: null, navigation: null, blocked: false, ended: false };
  }
  if (points.length !== 1) {
    return { state: block(state, points.length, config), scaleChanged: false, scrollTop: null, navigation: null, blocked: false, ended: false };
  }
  if (state.phase === "blocked") {
    return { state: { ...state, config: cloneConfig(config), pointerCount: 1 }, scaleChanged: false, scrollTop: null, navigation: null, blocked: false, ended: false };
  }

  const start = pointOf(state.startPoints);
  const current = points[0]!;
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const moved = Math.abs(dx) > TOUCH_SLOP || Math.abs(dy) > TOUCH_SLOP;
  let phase = state.phase;
  let edge = state.edge;
  let direction = state.direction;
  let feedback = state.feedback;
  let placement = state.placement;
  let armed = state.armed;

  if (phase === "pending") {
    armed = false;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > DIRECTION_LOCK) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        phase = "horizontal";
      } else if (state.atTop && dy > 0) {
        phase = "pull";
        edge = "top";
      } else if (state.atBottom && dy < 0) {
        phase = "pull";
        edge = "bottom";
      } else {
        phase = "scroll";
        edge = null;
        direction = null;
      }
    }
  }

  if (phase === "horizontal") {
    const swipeDirection: PeriodDirection | null = dx < 0 ? "next" : dx > 0 ? "prev" : null;
    direction = swipeDirection;
    if (!swipeDirection) {
      armed = false;
      feedback = "";
      placement = "center";
    } else {
      const blocked = swipeDirection === "next" && !config.canNext;
      armed = !blocked && Math.abs(dx) >= SWIPE_THRESHOLD;
      feedback = horizontalFeedback(swipeDirection, armed, config);
      placement = "center";
    }
  } else if (phase === "pull" && edge) {
    const outward = edge === "top" ? dy : -dy;
    if (outward <= 0) {
      // Started on a boundary but dragged inward: hand the gesture back to native scrolling.
      phase = "scroll";
      edge = null;
      direction = null;
      armed = false;
      feedback = "";
      placement = "center";
    } else {
      direction = edge === "top" ? "prev" : "next";
      const blocked = edge === "bottom" && !config.canNext;
      armed = !blocked && outward >= SWIPE_THRESHOLD;
      feedback = pullFeedback(edge, armed, config);
      placement = edge;
    }
  } else if (phase === "scroll") {
    armed = false;
    direction = null;
    feedback = "";
    placement = "center";
  }
  const blockedFuture = direction === "next" && !config.canNext;
  const activeTurn = (phase === "horizontal" || phase === "pull") && !blockedFuture;
  const paperTurn: PaperTurnState = activeTurn && direction
    ? {
      ...state.paperTurn,
      phase: "drag",
      axis: phase === "horizontal" ? "horizontal" : "vertical",
      direction,
      displacement: phase === "horizontal" ? dx : dy,
      origin: { ...start },
      crossDisplacement: phase === "horizontal" ? dy : dx,
    }
    : clearPaperTurn(state);

  return {
    state: {
      ...state,
      config: cloneConfig(config),
      phase,
      pointerCount: 1,
      edge,
      direction,
      armed,
      feedback,
      placement,
      suppressClick: state.suppressClick || moved,
      paperTurn,
    },
    scaleChanged: false,
    scrollTop: null,
    navigation: null,
    blocked: false,
    ended: false,
  };
}

function finish(state: GestureState, config: GestureConfig): GestureUpdate {
  const wanted = state.phase === "horizontal" || state.phase === "pull" ? state.direction : null;
  const blocked = !!wanted && wanted === "next" && !config.canNext;
  const navigation = state.armed && wanted && !blocked ? wanted : null;
  const canTurn = !!wanted && state.paperTurn.phase === "drag" && state.paperTurn.direction === wanted && !blocked;
  const turnPhase: PaperTurnPhase = navigation ? "complete" : canTurn ? "recoil" : "idle";
  const paperTurn: PaperTurnState = canTurn || navigation
    ? {
      ...state.paperTurn,
      phase: turnPhase,
      direction: wanted,
      displacement: 0,
    }
    : { ...clearPaperTurn(state), phase: turnPhase };
  const next: GestureState = {
    ...state,
    config: cloneConfig(config),
    phase: navigation || canTurn ? "settling" : "done",
    pointerCount: 0,
    edge: null,
    direction: null,
    armed: false,
    feedback: blocked ? blockedFeedback(config) : "",
    placement: "center",
    suppressClick: state.suppressClick || navigation !== null || blocked || state.phase === "pinch",
    pinch: null,
    paperTurn,
  };
  return {
    state: next,
    scaleChanged: false,
    scrollTop: null,
    navigation,
    blocked,
    ended: true,
  };
}

export function pointerUp(state: GestureState, input: UpInput): GestureUpdate {
  const { remaining, changed, metrics, config } = input;
  if (state.phase === "idle" || state.phase === "done" || state.phase === "settling") {
    return { state, scaleChanged: false, scrollTop: null, navigation: null, blocked: false, ended: false };
  }
  if (remaining.length > 0) {
    // A second finger (or a third) was involved: consume the rest of the touch
    // sequence instead of treating the remaining finger as a fresh one-finger gesture.
    return { state: block(state, remaining.length, config), scaleChanged: false, scrollTop: null, navigation: null, blocked: false, ended: false };
  }
  let current = state;
  if (state.phase !== "pinch" && changed.length === 1) {
    current = pointerMove(state, { points: [changed[0]!], metrics, config }).state;
  }
  return finish(current, config);
}

export function cancelGesture(state: GestureState, animate = false): GestureState {
  if (state.phase === "idle" || state.phase === "done") return state;
  const animateBack = animate && state.paperTurn.phase === "drag";
  return {
    ...state,
    phase: animateBack ? "settling" : "done",
    pointerCount: 0,
    edge: null,
    direction: null,
    armed: false,
    feedback: "",
    placement: "center",
    suppressClick: true,
    pinch: null,
    paperTurn: animateBack
      ? { ...state.paperTurn, phase: "recoil", displacement: 0 }
      : clearPaperTurn(state),
  };
}
