import { describe, expect, it } from "vitest";
import type { ImportCommitResponse, ImportPreviewResponse, Offering } from "@cfp/kith-inn-v1-shared";
import {
  commitSummaryText,
  partitionOfferings,
  previewSummaryText,
  setConflictAction
} from "./offeringsImport";

const offerings: Offering[] = [
  { id: 1, sellerId: 7, name: "紫菜汤", mainIngredient: "紫菜", category: "soup", active: false },
  { id: 2, sellerId: 7, name: "番茄牛腩", mainIngredient: "牛肉", category: "meat", active: true },
  { id: 3, sellerId: 7, name: "清炒时蔬", mainIngredient: "青菜", category: "veg", active: true }
];

describe("offering view logic", () => {
  it("partitions active/inactive offerings and sorts each group by name", () => {
    expect(partitionOfferings(offerings)).toEqual({
      active: [offerings[1], offerings[2]],
      inactive: [offerings[0]]
    });
  });

  it("renders preview and commit summaries", () => {
    const preview = { summary: { ready: 2, conflict: 1, invalid: 3 } } as ImportPreviewResponse;
    expect(previewSummaryText(preview)).toBe("可新增 2 行，重名 1 行，错误 3 行");
    const commit = { summary: { created: 2, overwritten: 1, skipped: 3, failed: 1 } } as ImportCommitResponse;
    expect(commitSummaryText(commit)).toBe("新增 2 行，覆盖 1 行，跳过 3 行，失败 1 行");
  });

  it("records only explicit overwrite actions and can return a conflict to default skip", () => {
    expect(setConflictAction([], 2, "overwrite")).toEqual([{ line: 2, action: "overwrite" }]);
    expect(setConflictAction([{ line: 2, action: "overwrite" }], 3, "overwrite")).toEqual([
      { line: 2, action: "overwrite" },
      { line: 3, action: "overwrite" }
    ]);
    expect(setConflictAction([
      { line: 2, action: "overwrite" },
      { line: 3, action: "overwrite" }
    ], 2, "skip")).toEqual([{ line: 3, action: "overwrite" }]);
  });
});
