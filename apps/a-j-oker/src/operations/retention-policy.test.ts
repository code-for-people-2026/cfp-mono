import { describe, expect, it } from "vitest";
import { finiteRetentionBasis, normalizeEvidenceDays, normalizeRetentionBasis, settingSchema } from "./policy";

const base = {
  acceptanceHours: 8, resolutionHours: 48, feedbackHours: 24,
  staffing: "隔离测试值班安排", retentionBasis: "仅为处理具体安全案件保留最小证据", reason: "发布有限留存配置",
};

describe("finite safety evidence settings", () => {
  it("defaults new settings to 30 days and accepts 1 through 30", () => {
    expect(settingSchema.parse(base).evidenceDays).toBe(30);
    expect(settingSchema.parse({ ...base, evidenceDays: 1 }).evidenceDays).toBe(1);
    expect(settingSchema.parse({ ...base, evidenceDays: 30 }).evidenceDays).toBe(30);
  });

  it("rejects new unlimited or over-limit settings", () => {
    expect(() => settingSchema.parse({ ...base, evidenceDays: 0 })).toThrow();
    expect(() => settingSchema.parse({ ...base, evidenceDays: 31 })).toThrow();
  });

  it("normalizes only legacy values used for new cases", () => {
    expect(normalizeEvidenceDays(0)).toBe(30);
    expect(normalizeEvidenceDays(null)).toBe(30);
    expect(normalizeEvidenceDays(7)).toBe(7);
    expect(normalizeEvidenceDays(365)).toBe(30);
  });

  it("does not carry obsolete permanent wording into a new case", () => {
    expect(normalizeRetentionBasis("负责人要求永久保留，不自动到期")).toBe(finiteRetentionBasis);
    expect(normalizeRetentionBasis("仅为具体案件保留最小证据七天")).toBe("仅为具体案件保留最小证据七天");
  });
});
