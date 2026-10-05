export function snapWeekScroll(left: number, contentWidth: number, viewportWidth: number): number {
  const end = Math.max(0, contentWidth - viewportWidth);
  if (!end) return 0;
  // Seven day columns have six 8px gaps; the viewport ends partway through a column.
  const step = (contentWidth + 8) / 7;
  const position = Math.max(0, Math.min(end, left));
  const column = Math.min(end, Math.round(position / step) * step);
  return end - position <= Math.abs(column - position) ? end : column;
}
