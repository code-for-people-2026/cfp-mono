import { normalizeCustomerName } from "../customers/nameNormalize";

/** An item as the parser emits it / the eval fixture expects it. */
export type EvalItem = { customerName: string; quantity: number; occasion: string };

export type SampleResult = { correct: number; total: number; pct: number; misassigned: number };

type Norm = { name: string; qty: number; occ: string };
const normItem = (it: EvalItem): Norm => ({
  name: normalizeCustomerName(it.customerName),
  qty: it.quantity,
  occ: it.occasion,
});

/**
 * Evaluate one 接龙 parse (PRD §6.1 acceptance).
 * - **fieldAccuracy**: an expected item is "correct" iff a predicted item matches on
 *   all three of normalized-name + quantity + occasion (multiset, so duplicates count).
 * - **misassigned (午/晚 错配, must be 0)**: an expected (name, quantity) exists in
 *   predicted but with a *different* occasion — i.e. the meal was assigned wrong.
 *
 * Pure + unit-tested; the eval runner (eval/) feeds it real parse output.
 */
export function evaluateSample(predicted: EvalItem[], expected: EvalItem[]): SampleResult {
  const pred = predicted.map(normItem);
  const exp = expected.map(normItem);

  const predCounts = new Map<string, number>();
  for (const p of pred) {
    const k = `${p.name}|${p.qty}|${p.occ}`;
    predCounts.set(k, (predCounts.get(k) ?? 0) + 1);
  }
  let correct = 0;
  for (const e of exp) {
    const k = `${e.name}|${e.qty}|${e.occ}`;
    const c = predCounts.get(k) ?? 0;
    if (c > 0) {
      correct++;
      predCounts.set(k, c - 1);
    }
  }

  let misassigned = 0;
  for (const e of exp) {
    if (pred.some((p) => p.name === e.name && p.qty === e.qty && p.occ !== e.occ)) misassigned++;
  }

  const total = exp.length;
  return { correct, total, pct: total === 0 ? 1 : correct / total, misassigned };
}

/** Aggregate across all samples: overall field-level accuracy + total 午/晚 misassign. */
export function evaluateAll(
  samples: Array<{ id: string; expected: EvalItem[] }>,
  predicted: Record<string, EvalItem[]>,
): { perSample: Record<string, SampleResult>; fieldAccuracy: number; totalMisassigned: number } {
  let correctSum = 0;
  let totalSum = 0;
  let misSum = 0;
  const perSample: Record<string, SampleResult> = {};
  for (const s of samples) {
    const r = evaluateSample(predicted[s.id] ?? [], s.expected);
    perSample[s.id] = r;
    correctSum += r.correct;
    totalSum += r.total;
    misSum += r.misassigned;
  }
  return {
    perSample,
    fieldAccuracy: totalSum === 0 ? 1 : correctSum / totalSum,
    totalMisassigned: misSum,
  };
}
