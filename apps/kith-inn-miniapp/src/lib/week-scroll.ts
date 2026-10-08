export function snapWeekScroll(left: number, contentWidth: number, viewportWidth: number): number {
  const end = Math.max(0, contentWidth - viewportWidth);
  if (!end) return 0;
  // Seven day columns have six 8px gaps; the viewport ends partway through a column.
  const step = (contentWidth + 8) / 7;
  const position = Math.max(0, Math.min(end, left));
  const column = Math.min(end, Math.round(position / step) * step);
  return end - position <= Math.abs(column - position) ? end : column;
}

// Scroll events report positions; only a completed gesture may issue a snap command.
export function createWeekScrollSnap(readView: (receive: (view: { width: number; scrollTo: (left: number) => void }) => void) => void) {
  let touching = false, pending = false, revision = 0;
  let left = 0, contentWidth = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(timer); revision++; };
  const settle = () => {
    clearTimeout(timer);
    if (touching || !pending || !contentWidth) return;
    const request = ++revision;
    readView((view) => {
      if (request !== revision || touching || !pending || !view.width) return;
      pending = false;
      const target = snapWeekScroll(left, contentWidth, view.width);
      if (Math.abs(target - left) > 0.5) view.scrollTo(target);
    });
  };
  const schedule = () => { if (!touching && pending) timer = setTimeout(settle, 180); };
  return {
    start() { cancel(); touching = true; pending = true; },
    end() { cancel(); touching = false; schedule(); },
    scroll(position: { scrollLeft: number; scrollWidth: number }) {
      cancel(); left = position.scrollLeft; contentWidth = position.scrollWidth; schedule();
    },
    settle,
    dispose() { cancel(); touching = false; pending = false; }
  };
}
