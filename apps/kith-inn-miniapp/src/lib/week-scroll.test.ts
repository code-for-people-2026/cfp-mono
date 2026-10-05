import { expect, it } from "vitest";
import { snapWeekScroll } from "./week-scroll";

it("keeps Sunday fully visible at the end instead of snapping back to Friday", () => {
  // Observed 390px H5 layout: 118px day columns, 8px gaps, 311px viewport.
  expect(snapWeekScroll(563, 874, 311)).toBe(563);
  expect(snapWeekScroll(550, 874, 311)).toBe(563);
  expect(snapWeekScroll(520, 874, 311)).toBe(504);
  expect(snapWeekScroll(190, 874, 311)).toBe(252);
  expect(snapWeekScroll(-20, 874, 311)).toBe(0);
  expect(snapWeekScroll(900, 874, 311)).toBe(563);
  expect(snapWeekScroll(0, 280, 311)).toBe(0);
  expect(snapWeekScroll(563.5, 874.5, 311)).toBe(563.5);
});
