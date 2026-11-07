import { describe, expect, it } from "vitest";
import {
  createScrollChromeState,
  resetScrollChromeState,
  shouldTrackScrollIntent,
  updateScrollIntent,
} from "../src/gestures/scroll-chrome";

describe("scroll chrome intent", () => {
  it("emits hide only after eighteen physical pixels downward", () => {
    const below = updateScrollIntent(createScrollChromeState(100), 117, 0);
    expect(below.intent).toBeNull();
    expect(below.state.accumulated).toBe(17);

    const atThreshold = updateScrollIntent(below.state, 135, 1);
    expect(atThreshold.intent).toBe("hide");
    expect(atThreshold.state.lastIntent).toBe("hide");
  });

  it("emits show for upward scrolling and resets accumulation on reversal", () => {
    let state = createScrollChromeState(100);
    state = updateScrollIntent(state, 110, 0).state;
    expect(state.direction).toBe(1);
    expect(state.accumulated).toBe(10);

    state = updateScrollIntent(state, 100, 1).state;
    expect(state.direction).toBe(-1);
    expect(state.accumulated).toBe(10);

    const shown = updateScrollIntent(state, 90, 2);
    expect(shown.intent).toBe("show");
    expect(shown.state.accumulated).toBe(0);
  });

  it("ignores jitter and does not let repeated sub-pixel frames accumulate", () => {
    let state = createScrollChromeState(100);
    state = updateScrollIntent(state, 100.5, 0).state;
    state = updateScrollIntent(state, 101.5, 1).state;
    expect(state.direction).toBe(0);
    expect(state.accumulated).toBe(0);

    expect(updateScrollIntent(state, 119, 2).intent).toBeNull();
  });

  it("shows immediately when an upward frame reaches the top boundary", () => {
    expect(updateScrollIntent(createScrollChromeState(3), 2, 0).intent).toBe("show");
  });

  it("uses a short cooldown to swallow geometry clamp jitter", () => {
    const hidden = updateScrollIntent(createScrollChromeState(100), 118, 0);
    expect(hidden.intent).toBe("hide");

    const clamp = updateScrollIntent(hidden.state, 90, 10);
    expect(clamp.intent).toBeNull();
    expect(clamp.state.baseline).toBe(90);

    expect(updateScrollIntent(clamp.state, 72, 100).intent).toBe("show");
  });

  it("tracks only ordinary one-finger scroll frames", () => {
    expect(shouldTrackScrollIntent({ phase: "scroll", pointerCount: 1 })).toBe(true);
    expect(shouldTrackScrollIntent({ phase: "scroll", pointerCount: 1, isDrag: true })).toBe(true);
    expect(shouldTrackScrollIntent({ phase: "pending", pointerCount: 1 })).toBe(false);
    expect(shouldTrackScrollIntent({ phase: "scroll", pointerCount: 2 })).toBe(false);
    expect(shouldTrackScrollIntent({ phase: "pinch", pointerCount: 2 })).toBe(false);
    expect(shouldTrackScrollIntent({ phase: "idle", pointerCount: 1, isDrag: false })).toBe(false);
  });

  it("rebases ignored or programmatic offsets without emitting", () => {
    const hidden = updateScrollIntent(createScrollChromeState(100), 118, 0);
    const restored = resetScrollChromeState(180, hidden.state);
    expect(restored.baseline).toBe(180);
    expect(restored.lastIntent).toBe("hide");
    expect(updateScrollIntent(restored, 180, 100).intent).toBeNull();
  });
});
