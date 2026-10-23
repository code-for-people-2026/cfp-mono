import { describe, expect, it } from "vitest";
import { createBubuApi } from "../src/api/client";
import { dailyStat, recordEvent, recordSnapshot, ResponseFormatError } from "../src/api/contracts";
import { buildHeatmap, buildTrendRows, coverageMessage, recordDetailFields, recordStatCards, syncStatusLines } from "../src/model";
import { emptyRecordSummary, recordEventFixture } from "./fixtures/records";

describe("sidecar record projection", () => {
  it("uses authoritative actual diaper counts and retains known zero without form defaults", () => {
    const summary = emptyRecordSummary();
    Object.assign(summary.metrics, { diaperCount: 2, peeCount: 2, totalMilkAmount: 0 });
    Object.assign(summary.byType.DIAPER!, { events: 2 });
    Object.assign(summary.byType.BOTTLE!, { events: 1, knownMilkAmounts: 1 });
    Object.assign(summary.byType.ROLL_OVER!, { events: 1, knownCount: 0 });
    const cards = recordStatCards(summary);
    expect(cards.find(card => card.key === "diaper")).toMatchObject({ label: "尿布", value: "2 次" });
    expect(cards.find(card => card.key === "bottle")?.value).toBe("0 ml");
    expect(cards.find(card => card.key === "rollOver")?.value).toBe("0 次");
    expect(cards.find(card => card.key === "pump")?.value).toBe("暂无");
    summary.byType.BOTTLE!.knownMilkAmounts = 0; summary.byType.BOTTLE!.unknownMilkAmounts = 1;
    expect(recordStatCards(summary).find(card => card.key === "bottle")?.value).toBe("待补全");
  });
  it("shows ongoing sleep and duplicate/unknown coverage without claiming zero activity", () => {
    const summary = emptyRecordSummary();
    Object.assign(summary.byType.SLEEP!, { events: 1, ongoingEvents: 1 });
    Object.assign(summary.coverage, { recordedEvents: 1, incompleteEvents: 1, unknownFields: 1, ongoingEvents: 1, duplicateCandidates: 1, pendingCandidates: 1 });
    expect(recordStatCards(summary).find(card => card.key === "sleep")?.value).toBe("进行中");
    expect(coverageMessage(summary.coverage)).toContain("明确未知");
    expect(coverageMessage(summary.coverage)).toContain("暂不重复计入");
    expect(coverageMessage(summary.coverage)).toContain("未计入完成时长");
    Object.assign(summary.byType.PUMP!, { events: 1, ongoingEvents: 1 });
    expect(recordStatCards(summary).find(card => card.key === "pump")?.value).toBe("进行中");
  });
  it("decodes live daily-stat coverage and keeps unknown metric points apart from known zero", () => {
    const summary = emptyRecordSummary();
    Object.assign(summary.byType.BOTTLE!, { events: 1, knownMilkAmounts: 1 });
    Object.assign(summary.byType.SLEEP!, { events: 1, ongoingEvents: 1 });
    summary.coverage.ongoingEvents = 1;
    const stat = dailyStat({ id: "day", babyId: "baby-1", date: "2026-10-23", ...summary.metrics, coverage: summary.coverage, byType: summary.byType });
    const row = buildTrendRows([stat], 1, "2026-10-23")[0]!;
    expect(row.known).toEqual({ sleep: false, milk: true, pump: false, diapers: false });
    expect(row.milk).toBe(0);
    const cell = buildHeatmap([stat], "2026-10-23", 1, "2026-10-23").weeks[0]?.days.find(day => day.date === "2026-10-23");
    expect(cell?.known).toEqual({ sleep: false, milk: true });
    const legacy = dailyStat({ id: "legacy", date: "2026-10-23", ...summary.metrics });
    expect(buildTrendRows([legacy], 1, "2026-10-23")[0]).not.toHaveProperty("known");
  });
  it("requests a scoped snapshot only in sidecar mode and rejects nested cross-baby results", async () => {
    const summary = emptyRecordSummary(); let wrongBaby = false;
    const storage = { get: () => undefined, set: () => {}, remove: () => {} };
    const client = createBubuApi({ native: false, origin: "", authMode: "sidecar", storage, transport: async request => {
      const url = new URL(request.url, "https://synthetic.example.test");
      expect(url.pathname).toBe("/api/app/records/snapshot");
      expect(Object.fromEntries(url.searchParams)).toEqual({ babyId: "baby-1", date: "2026-10-23" });
      return { status: 200, data: { activities: [], summary, events: [recordEventFixture({ babyId: wrongBaby ? "baby-2" : "baby-1" })], questions: [] } };
    } });
    expect((await client.getSnapshot("baby-1", "2026-10-23")).summary).toEqual(summary);
    wrongBaby = true;
    await expect(client.getSnapshot("baby-1", "2026-10-23")).rejects.toBeInstanceOf(ResponseFormatError);
    const legacy = createBubuApi({ native: false, origin: "", storage, transport: async () => { throw new Error("must not call"); } });
    await expect(legacy.getSnapshot("baby-1", "2026-10-23")).rejects.toMatchObject({ status: 400 });
    expect(() => recordSnapshot({ activities: [], events: [], questions: [], summary: { ...summary, coverage: { ...summary.coverage, ongoingEvents: -1 } } })).toThrow(ResponseFormatError);
  });
  it("reads historical event metadata without a date, discards sensitive source ids and validates attachment ids", async () => {
    const attachmentId = `att_${"a".repeat(64)}`;
    const raw = { ...recordEventFixture({ attachmentIds: [attachmentId] }), sources: [{ kind: "wechat", sentAt: "2026-10-22T10:00:00+08:00", accountId: "private-account", senderId: "private-sender" }] };
    const client = createBubuApi({ native: false, origin: "", authMode: "sidecar", storage: { get: () => undefined, set: () => {}, remove: () => {} }, transport: async request => {
      const url = new URL(request.url, "https://synthetic.example.test");
      expect(Object.fromEntries(url.searchParams)).toEqual({ eventId: "activity", babyId: "baby-1" });
      return { status: 200, data: { activities: [], events: [raw], questions: [] } };
    } });
    const event = await client.getRecordEvent("baby-1", "activity");
    expect(event?.attachmentIds).toEqual([attachmentId]);
    expect(JSON.stringify(event)).not.toContain("private-");
    expect(() => recordEvent({ ...raw, attachmentIds: ["https://foreign.example/image"] })).toThrow(ResponseFormatError);
  });
  it("preserves zero and reports missing information without mistaking an externally ended sleep for ongoing", () => {
    const activity = { id: "activity", babyId: "baby-1", type: "BOTTLE" as const, startTime: "2026-10-22T10:00:00+08:00", endTime: "2026-10-22T10:15:00+08:00", milkAmount: 0 };
    const event = recordEvent({ ...recordEventFixture({ progress: "ongoing", states: { burpSuccess: "unknown", endTime: "not_yet" }, missing: ["milkSource"] }), facts: { ...activity, endTime: null }, currentActivity: activity });
    expect(event.currentProgress).toBe("ended");
    const details = recordDetailFields(activity, event);
    expect(details).toContainEqual({ label: "奶量", value: "0 ml" });
    expect(details).toContainEqual({ label: "待补充", value: "奶源" });
    expect(details).toContainEqual({ label: "明确未知", value: "拍嗝结果" });
    expect(details.some(field => field.label === "活动状态" || field.label === "尚未发生")).toBe(false);
  });
  it("keeps sync failures and pending media distinct from no recorded activity", () => {
    const lines = syncStatusLines([{ id: "job", enabled: true, lastSuccessAt: "2026-10-23T10:00:00+08:00", processedThrough: "2026-10-23T09:55:00+08:00", pending: true, pendingMedia: 2, failure: { code: "PRIVATE_INTERNAL_ERROR", at: "2026-10-23T10:01:00+08:00", attempts: 2 } }]);
    expect(lines.join(" ")).toContain("最近同步成功");
    expect(lines.join(" ")).toContain("2 项媒体待补取");
    expect(lines.join(" ")).toContain("当前显示已保存记录");
    expect(lines.join(" ")).not.toContain("PRIVATE_INTERNAL_ERROR");
  });
});
