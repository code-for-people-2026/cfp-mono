import { describe, expect, it } from "vitest";
import { collectorAgentInstructions } from "../src/collector/prompt";

describe("collector prompt date contract", () => {
  it("delivers sentAt-relative date rules without making all outdoor reports afternoon", () => {
    expect(collectorAgentInstructions).toContain("Anchor relative date wording to the reporting message's sentAt converted to Asia/Shanghai");
    expect(collectorAgentInstructions).toContain("今天 or no explicit date means that sentAt calendar day");
    expect(collectorAgentInstructions).toContain("昨天 and 前天 apply one or two calendar-day offsets");
    expect(collectorAgentInstructions).toContain("昨晚 begins on the previous calendar day's evening");
    expect(collectorAgentInstructions).toContain("if that evening sleep crosses midnight, resolve its end on the following calendar day");
    expect(collectorAgentInstructions).toContain("Explicit dates, times, time zones, daypart wording, later corrections, and human revisions always override relative-date defaults");
    expect(collectorAgentInstructions).toContain("never a blanket OUTDOOR-means-afternoon rule");
    expect(collectorAgentInstructions).not.toContain("For a relative or bare date, use the calendar day of the reporting message's sentAt");
  });
});
