import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, importPublic, mergeCandidateLabels, normalize, sampleByGroup, splitFamily } from "../../scripts/safety/bank";
import { openBudget, reserveForRequest, measuredPeakCny } from "../../scripts/safety/budget";

describe("offline safety source preparation", () => {
  it("normalizes controls and deduplicates equivalent prompts without importing supplied answers", () => {
    const data = importPublic({ general: [{ prompt: "请介绍正常生活。" }, { prompt: "请介绍正常生活！" }, { prompt: "请联系13812345678获取资料" }] }, "source.json", "revision");
    expect(data.items).toHaveLength(1); expect(data.duplicate).toBe(1); expect(data.excluded).toBe(1);
    expect(data.items[0].humanReview).toBe("pending"); expect(data.items[0]).not.toHaveProperty("response");
    expect(normalize(" Ａ\u0001Ｂ \u200b")).toBe("ab");
  });
  it("keeps normalization-identical prompts in one split and samples at most once per family", () => {
    const data = importPublic({ a: [{ prompt: "请说明信息如何保护。" }], b: [{ prompt: "请说明健康如何保护。" }] }, "s.json", "r").items;
    const duplicate = { ...data[0], id: "variant", sourceCategory: "other" };
    const a = sampleByGroup([...data, duplicate], 2, "seed");
    expect(new Set(a.map(x => x.family)).size).toBe(a.length);
    expect(sampleByGroup([duplicate, ...data], 2, "seed")).toEqual(a);
    expect(splitFamily(data[0].family)).toBe(data[0].split);
  });
  it("marks risk-word candidates without claiming accuracy or usefulness can be keyword classified", () => {
    expect(classify("防范诈骗，保护隐私")).toEqual(expect.arrayContaining(["KW-08", "KW-27"]));
    expect(classify("请说明今天的地理知识")).not.toContain("KW-30");
  });
  it("does not silently discard prior candidates when a new draft matcher is narrower", () => {
    expect(mergeCandidateLabels("1元假币出售", ["KW-08"])).toContain("KW-08");
    expect(mergeCandidateLabels("防范诈骗，保护隐私", ["KW-08"])).toEqual(["KW-08", "KW-27"]);
    expect(() => mergeCandidateLabels("正常生活", ["invented-label"])).toThrow();
  });
});

describe("cumulative paid-evaluation budget", () => {
  it("allows an explicit stop line within the same 50 CNY cap without resetting historical reservations", () => {
    const dir = mkdtempSync(join(tmpdir(), "safety-budget-")), file = join(dir, "prior.json");
    writeFileSync(file, JSON.stringify({ reserved: 44.8, capCny: 50, stopCny: 45 }));
    try {
      expect(() => openBudget(file, 50.01)).toThrow();
      const a = openBudget(file, 49.5);
      expect(a.total).toBe(44.8); a.reserve(4.5, "finishing");
      expect(() => a.reserve(0.3, "over-stop")).toThrow(); a.close();
      const b = openBudget(file, 49.5); expect(b.total).toBe(49.3); b.close();
      expect(JSON.parse(readFileSync(file, "utf8")).reserved).toBe(44.8);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("settles evidenced usage once, survives restart, and retains unknown reservations and the original floor", () => {
    const dir = mkdtempSync(join(tmpdir(), "safety-budget-")), file = join(dir, "prior.json");
    writeFileSync(file, JSON.stringify({ reserved: 13, capCny: 50, stopCny: 45 }));
    try {
      const a = openBudget(file), id = a.reserve(2, "ok"); a.reserve(1, "unknown");
      const entry = { id, caseId: "ok", status: 200, model: "deepseek-flash", usage: { prompt: 100, completion: 50, hit: 0, miss: 100 }, evidenceSha256: "a".repeat(64) };
      expect(() => a.settle({ ...entry, status: 500 })).toThrow();
      expect(() => a.settle({ ...entry, caseId: "other" })).toThrow();
      expect(() => a.settle({ ...entry, evidenceSha256: "missing" })).toThrow();
      expect(() => a.settle({ ...entry, usage: { ...entry.usage, completion: 9999999 } })).toThrow();
      expect(a.total).toBe(16); a.settle(entry);
      expect(a.total).toBeCloseTo(14.0006, 8);
      expect(() => a.settle(entry)).toThrow(); a.close();
      const b = openBudget(file); expect(b.total).toBeCloseTo(14.0006, 8); b.close();
      expect(() => measuredPeakCny({ prompt: 10, completion: -1, hit: 0, miss: 10 })).toThrow();
      expect(() => measuredPeakCny({ prompt: 10, completion: 1, hit: 0, miss: 9 })).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("carries reservations through restart, rejects concurrent runs, and never releases failed calls", () => {
    const dir = mkdtempSync(join(tmpdir(), "safety-budget-")), file = join(dir, "prior.json");
    writeFileSync(file, JSON.stringify({ reserved: 13, capCny: 50, stopCny: 45 }));
    try {
      const a = openBudget(file); a.reserve(3, "case-1");
      expect(() => openBudget(file)).toThrow(); a.close();
      const b = openBudget(file); expect(b.total).toBe(16);
      expect(() => b.reserve(30, "case-2")).toThrow(/budget/);
      expect(() => b.reserve(-1, "case-2")).toThrow(); b.close();
      expect(JSON.parse(readFileSync(file, "utf8")).reserved).toBe(13);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("fails closed on malformed old budgets and unsupported paid services", () => {
    const dir = mkdtempSync(join(tmpdir(), "safety-budget-")), file = join(dir, "prior.json");
    try {
      writeFileSync(file, JSON.stringify({ reserved: "13", capCny: 50, stopCny: 45 })); expect(() => openBudget(file)).toThrow();
      const body = { model: "deepseek-flash", max_tokens: 8192, stream: false, thinking: { type: "disabled" }, messages: [{ role: "user", content: "测试" }] };
      expect(reserveForRequest(JSON.stringify(body))).toBeGreaterThan(0.065);
      expect(() => reserveForRequest(JSON.stringify({ ...body, model: "other" }))).toThrow();
      expect(() => reserveForRequest(JSON.stringify({ ...body, messages: [{ content: [{ type: "image_url" }] }] }))).toThrow();
      expect(() => reserveForRequest(JSON.stringify({ ...body, max_tokens: 0 }))).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
