import { expect, it } from "vitest";
import { workingDeadline } from "./deadlines";
it("uses business hours across weekends, never elapsed calendar hours", () => {
  expect(workingDeadline(Date.parse("2026-10-23T16:00:00+08:00"), 1)).toBe("2026-10-26T08:00:00.000Z");
  expect(workingDeadline(Date.parse("2026-10-24T12:00:00+08:00"), 1)).toBe("2026-10-26T09:00:00.000Z");
  expect(workingDeadline(Date.parse("2026-10-26T09:00:00+08:00"), 7)).toBe("2026-11-03T09:00:00.000Z");
});
