export interface KeyboardViewportGeometry {
  keyboardHeight: number;
  focusViewportHeight: number;
  currentViewportHeight: number;
}

export function keyboardOverlayHeight({
  keyboardHeight,
  focusViewportHeight,
  currentViewportHeight,
}: KeyboardViewportGeometry) {
  const keyboard = Number.isFinite(keyboardHeight)
    ? Math.max(0, keyboardHeight)
    : 0;
  const focusHeight = Number.isFinite(focusViewportHeight)
    ? Math.max(0, focusViewportHeight)
    : 0;
  const currentHeight = Number.isFinite(currentViewportHeight)
    ? Math.max(0, currentViewportHeight)
    : 0;
  // Some native hosts resize the page viewport by all or part of the keyboard.
  // That resize has already moved a sticky dock; only the remaining overlay
  // portion may be manually offset. Subtracting it avoids a double lift.
  const resizedHeight = Math.max(0, focusHeight - currentHeight);
  return Math.max(0, keyboard - resizedHeight);
}
