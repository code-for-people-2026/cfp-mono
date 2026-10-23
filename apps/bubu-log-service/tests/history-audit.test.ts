import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditHistory } from "../src/records/history-audit";
import { activityTypes, type LegacyActivity } from "../src/records/types";

const at = (hour: number) => `2026-10-22T${String(hour).padStart(2, "0")}:00:00+08:00`;
function fifteenTypes(): LegacyActivity[] {
  return activityTypes.map((type, index) => ({ id: `history-${type}`, babyId: "synthetic-baby-a", type, startTime: at(index + 1), endTime: at(index + 1).replace(":00:00", ":10:00"),
    ...(type === "BOTTLE" ? { milkAmount: 100, milkSource: "BREAST_MILK" as const, burpSuccess: false } : {}),
    ...(type === "PUMP" ? { milkAmount: 60 } : {}), ...(type === "ROLL_OVER" || type === "PULL_TO_SIT" ? { count: 3 } : {}),
    ...(type === "DIAPER" ? { hasPoop: true, hasPee: true, peeAmount: "SMALL" as const, poopColor: "YELLOW" as const, poopPhotoUrl: "https://private.example/photo?secret=synthetic" } : {}),
    ...(type === "SUPPLEMENT" ? { supplementType: "D3" as const } : {}), ...(type === "SPIT_UP" ? { spitUpType: "PROJECTILE" as const } : {}) }));
}

describe("offline history mapping audit", () => {
  it("checks all 15 legacy types without mutating facts or exposing original photo URLs", () => {
    const snapshot = { activities: fifteenTypes() }, original = structuredClone(snapshot);
    const report = auditHistory(snapshot, structuredClone(snapshot));
    expect(report.preserved).toBe(true); expect(report.statisticsMatch).toBeNull();
    const baby = report.babies[0]!;
    expect(baby.before).toMatchObject({ activities: 15, photos: 1, dates: ["2026-10-22"] });
    expect(baby.before.byType.every(row => row.activities === 1)).toBe(true);
    expect(baby.before.daily[0]?.metrics).toMatchObject({ totalMilkAmount: 100, totalPumpMilkAmount: 60, totalSleepMinutes: 10, totalBreastfeedMinutes: 10,
      totalHeadLiftMinutes: 10, diaperCount: 1, peeCount: 1, poopCount: 1, supplementD3Count: 1, projectileSpitUpCount: 1 });
    expect(baby.before.daily[0]?.counts).toEqual({ rollOver: 3, pullToSit: 3 });
    expect(snapshot).toEqual(original); expect(JSON.stringify(report)).not.toContain("private.example");
    expect(JSON.stringify(report)).not.toContain("secret=synthetic");
    expect(auditHistory(snapshot).preserved).toBeNull();
  });

  it("detects missing and moved babies, changed photos, amounts, types and date coverage", () => {
    const before = { activities: fifteenTypes() }, after = structuredClone(before);
    after.activities = after.activities.filter(row => row.type !== "SLEEP");
    after.activities.find(row => row.type === "DIAPER")!.poopPhotoUrl = null;
    after.activities.find(row => row.type === "BOTTLE")!.milkAmount = 80;
    after.activities.find(row => row.type === "ROLL_OVER")!.babyId = "synthetic-baby-b";
    after.activities.find(row => row.type === "SUPPLEMENT")!.type = "SPIT_UP";
    const pump = after.activities.find(row => row.type === "PUMP")!;
    pump.startTime = "2026-10-23T12:00:00+08:00"; pump.endTime = "2026-10-23T12:10:00+08:00";
    const report = auditHistory(before, after); expect(report.preserved).toBe(false);
    const baby = report.babies.find(row => row.babyId === "synthetic-baby-a")!;
    expect(baby.differences.removedIds).toEqual(["history-ROLL_OVER", "history-SLEEP"]);
    expect(baby.differences.changedPhotoIds).toEqual(["history-DIAPER"]);
    expect(baby.differences.addedDates).toEqual(["2026-10-23"]);
    expect(baby.differences.metrics).toContainEqual({ date: "2026-10-22", metric: "totalMilkAmount", before: 100, after: 80 });
    expect(report.babies.find(row => row.babyId === "synthetic-baby-b")?.differences.addedIds).toEqual(["history-ROLL_OVER"]);
  });

  it("reports unknown versus zero, actual diapers versus old urine folding, and stale saved statistics", () => {
    const activities: LegacyActivity[] = [
      ...["SMALL", "MEDIUM", "LARGE"].map((peeAmount, index) => ({ id: `pee-${index}`, babyId: "baby", type: "DIAPER" as const, startTime: at(1 + index), hasPee: true, peeAmount: peeAmount as "SMALL" | "MEDIUM" | "LARGE" })),
      { id: "poop", babyId: "baby", type: "DIAPER", startTime: at(4), hasPoop: true },
      { id: "milk-unknown", babyId: "baby", type: "BOTTLE", startTime: at(5), milkAmount: null },
      { id: "milk-zero", babyId: "baby", type: "BOTTLE", startTime: at(6), milkAmount: 0 },
      { id: "roll-unknown", babyId: "baby", type: "ROLL_OVER", startTime: at(7), count: null },
      { id: "roll-zero", babyId: "baby", type: "ROLL_OVER", startTime: at(8), count: 0 },
      { id: "night", babyId: "baby", type: "SLEEP", startTime: "2026-10-22T23:30:00+08:00", endTime: "2026-10-23T01:00:00+08:00" },
    ];
    const report = auditHistory({ activities, dailyStats: [{ babyId: "baby", date: "2026-10-22T00:00:00+08:00", totalMilkAmount: 10, diaperCount: 4 }] });
    expect(report.preserved).toBeNull(); expect(report.statisticsMatch).toBe(false);
    const daily = report.babies[0]!.before.daily;
    expect(daily[0]?.legacyUiDifferences).toMatchObject({ foldedUrineCard: 2, actualDiapers: 4, actualPee: 3, unknownMilkDisplayedAsZero: 1, unknownDurationDisplayedAsZero: 2, unknownCountDefaultedToOne: 1, zeroCountDefaultedToOneOnHome: 1 });
    expect(daily[0]?.coverage).toMatchObject({ unknownMilkAmounts: 1, knownZeroMilkAmounts: 1, unknownCounts: 1, ongoingEvents: 0 });
    expect(daily[0]?.savedMetricDifferences).toEqual([{ metric: "totalMilkAmount", saved: 10, recomputed: 0 }]);
    expect(daily[0]?.metrics.totalSleepMinutes).toBe(30); expect(daily[1]?.metrics.totalSleepMinutes).toBe(60);
  });

  it("rejects unsupported, duplicate and invalid historical rows instead of silently excluding them", () => {
    const row = fifteenTypes()[0]!;
    expect(() => auditHistory({ activities: [row, row] })).toThrow("Duplicate activity ID");
    expect(() => auditHistory({ activities: [{ ...row, type: "UNKNOWN_TYPE" }] })).toThrow();
    expect(() => auditHistory({ activities: [{ ...row, endTime: "2026-10-21T00:00:00+08:00" }] })).toThrow("ends before");
    expect(() => auditHistory({ activities: [], dailyStats: [{ babyId: "baby", date: "2026-02-30" }] })).toThrow();
  });

  it("runs the real CLI from local JSON and leaves existing report files intact", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bubu-history-audit-"));
    try {
      const before = path.join(directory, "before.json"), after = path.join(directory, "after.json"), output = path.join(directory, "audit.json");
      const snapshot = { activities: fifteenTypes() };
      await writeFile(before, JSON.stringify(snapshot)); await writeFile(after, JSON.stringify(snapshot));
      execFileSync(process.execPath, ["--import", "tsx", "scripts/audit-history.ts", "--before", before, "--after", after, "--out", output], { cwd: process.cwd() });
      const content = await readFile(output, "utf8"); expect(JSON.parse(content).preserved).toBe(true);
      const retry = spawnSync(process.execPath, ["--import", "tsx", "scripts/audit-history.ts", "--before", before, "--out", output], { cwd: process.cwd(), encoding: "utf8" });
      expect(retry.status).toBe(2); expect(await readFile(output, "utf8")).toBe(content);
      const changed = structuredClone(snapshot); changed.activities.pop(); await writeFile(after, JSON.stringify(changed));
      const mismatch = spawnSync(process.execPath, ["--import", "tsx", "scripts/audit-history.ts", "--before", before, "--after", after], { cwd: process.cwd(), encoding: "utf8" });
      expect(mismatch.status).toBe(1); expect(JSON.parse(mismatch.stdout).preserved).toBe(false);
    } finally { await rm(directory, { force: true, recursive: true }); }
  });
});
