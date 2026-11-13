export type ScrollIntent = "hide" | "show";

/** Physical CSS pixels of ordinary scrolling needed to change summary chrome. */
export const SCROLL_INTENT_THRESHOLD = 18;
/** Sub-pixel ScrollView jitter never contributes to an intent. */
export const SCROLL_INTENT_JITTER = 1;
/** Ignores geometry-clamp scroll frames immediately after a chrome animation. */
export const SCROLL_INTENT_COOLDOWN_MS = 80;

export interface ScrollChromeState {
  baseline: number;
  direction: 1 | -1 | 0;
  accumulated: number;
  lastIntent: ScrollIntent | null;
  cooldownUntil: number;
}

export interface ScrollIntentUpdate {
  state: ScrollChromeState;
  intent: ScrollIntent | null;
}

export interface ScrollIntentSource {
  phase: string;
  pointerCount: number;
  isDrag?: boolean;
}

export function createScrollChromeState(baseline = 0): ScrollChromeState {
  return {
    baseline: Number.isFinite(baseline) ? baseline : 0,
    direction: 0,
    accumulated: 0,
    lastIntent: null,
    cooldownUntil: 0,
  };
}

/**
 * Resets the comparison point without emitting an intent. `preserveCooldown`
 * keeps a just-started chrome animation from interpreting its own geometry clamp.
 */
export function resetScrollChromeState(
  baseline: number,
  previous?: ScrollChromeState,
  preserveCooldown = false,
): ScrollChromeState {
  return {
    ...createScrollChromeState(baseline),
    lastIntent: previous?.lastIntent ?? null,
    cooldownUntil: preserveCooldown ? previous?.cooldownUntil ?? 0 : 0,
  };
}

export function shouldTrackScrollIntent(source: ScrollIntentSource): boolean {
  return source.phase === "scroll" && source.pointerCount === 1 && source.isDrag !== false;
}

export function updateScrollIntent(
  previous: ScrollChromeState,
  scrollTop: number,
  now = 0,
): ScrollIntentUpdate {
  const top = Number.isFinite(scrollTop) ? scrollTop : previous.baseline;
  if (now < previous.cooldownUntil) {
    return { state: resetScrollChromeState(top, previous, true), intent: null };
  }

  const delta = top - previous.baseline;
  const direction: 1 | -1 = delta > 0 ? 1 : -1;

  // Reaching the top is an unambiguous request for the summary, even when the
  // final clamped frame is smaller than the normal jitter threshold.
  if (top <= 2 && direction < 0 && previous.lastIntent !== "show") {
    return emitScrollIntent(previous, top, "show", now);
  }
  if (Math.abs(delta) <= SCROLL_INTENT_JITTER) {
    return { state: { ...previous, baseline: top }, intent: null };
  }

  const accumulated = (previous.direction === direction ? previous.accumulated : 0) + Math.abs(delta);
  if (accumulated < SCROLL_INTENT_THRESHOLD) {
    return {
      state: { ...previous, baseline: top, direction, accumulated },
      intent: null,
    };
  }
  return emitScrollIntent(
    { ...previous, baseline: top, direction, accumulated },
    top,
    direction > 0 ? "hide" : "show",
    now,
  );
}

function emitScrollIntent(
  previous: ScrollChromeState,
  baseline: number,
  intent: ScrollIntent,
  now: number,
): ScrollIntentUpdate {
  return {
    state: {
      ...resetScrollChromeState(baseline, previous),
      lastIntent: intent,
      cooldownUntil: now + SCROLL_INTENT_COOLDOWN_MS,
    },
    intent,
  };
}
