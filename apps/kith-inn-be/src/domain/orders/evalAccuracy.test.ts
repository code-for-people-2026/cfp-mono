import { describe, expect, it } from "vitest";
import { evaluateAll, evaluateSample } from "./evalAccuracy";

const item = (customerName: string, quantity: number, occasion: string) => ({ customerName, quantity, occasion });

describe("evaluateSample", () => {
  it("perfect match → 100%, 0 misassign", () => {
    const exp = [item("桃子", 8, "dinner"), item("lily", 1, "dinner")];
    expect(evaluateSample(exp, exp)).toMatchObject({ correct: 2, total: 2, pct: 1, misassigned: 0 });
  });

  it("counts a wrong occasion as NOT correct AND as a 午/晚 misassign", () => {
    const exp = [item("桃子", 8, "dinner")];
    const pred = [item("桃子", 8, "lunch")]; // right name+qty, wrong meal
    expect(evaluateSample(pred, exp)).toMatchObject({ correct: 0, total: 1, pct: 0, misassigned: 1 });
  });

  it("wrong quantity is not correct, and is not a meal misassign", () => {
    const exp = [item("桃子", 8, "dinner")];
    const pred = [item("桃子", 6, "dinner")];
    expect(evaluateSample(pred, exp)).toMatchObject({ correct: 0, total: 1, pct: 0, misassigned: 0 });
  });

  it("missing item lowers accuracy; extra predicted item doesn't inflate it", () => {
    const exp = [item("桃子", 8, "dinner"), item("lily", 1, "dinner")];
    const pred = [item("桃子", 8, "dinner"), item("nobody", 1, "dinner")];
    expect(evaluateSample(pred, exp)).toMatchObject({ correct: 1, total: 2, pct: 0.5, misassigned: 0 });
  });

  it("matches case/spacing variants via normalization", () => {
    const exp = [item("Lily", 1, "dinner")];
    const pred = [item("lily", 1, "dinner")];
    expect(evaluateSample(pred, exp).correct).toBe(1);
  });

  it("handles duplicate items per customer (桃子 6 dinner + 1 lunch)", () => {
    const exp = [item("桃子", 6, "dinner"), item("桃子", 1, "lunch")];
    expect(evaluateSample(exp, exp).correct).toBe(2);
  });

  it("empty expected → 100% (vacuous)", () => {
    expect(evaluateSample([item("x", 1, "lunch")], [])).toMatchObject({ pct: 1, total: 0 });
  });
});

describe("evaluateAll", () => {
  it("aggregates field accuracy + total misassign across samples", () => {
    const samples = [
      { id: "a", expected: [item("桃子", 8, "dinner")] },
      { id: "b", expected: [item("lily", 1, "lunch"), item("秀", 1, "lunch")] },
    ];
    const predicted = {
      a: [item("桃子", 8, "dinner")], // perfect
      b: [item("lily", 1, "dinner"), item("秀", 1, "lunch")], // lily meal wrong
    };
    const r = evaluateAll(samples, predicted);
    expect(r.fieldAccuracy).toBe(2 / 3); // 桃子 + 秀 correct, lily wrong
    expect(r.totalMisassigned).toBe(1); // lily's lunch→dinner
  });
});
