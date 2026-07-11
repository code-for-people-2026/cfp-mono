/**
 * 接龙解析 eval runner（PR2 验收）。跑真实 DeepSeek 解析每段接龙，对比 ground truth，
 * 报字段级准确率 + 午/晚错配数。手动跑（需 DEEPSEEK_API_KEY）：
 *   pnpm --filter @cfp/kith-inn-be eval:parse
 * 不进 CI 硬门禁（LLM 抖动会 flake）；M1 验收口径 = 字段级 ≥95% 且 午/晚错配 0。
 */
import { readFileSync } from "node:fs";
import { parseOrderInput } from "../src/domain/orders/parse";
import { evaluateAll, type EvalItem } from "../src/domain/orders/evalAccuracy";
import { JIELONG_EVAL_REFERENCE_DATE, jielongSamples } from "./jielong/samples";

function loadEnvFile(path: string) {
  // ponytail: tiny .env loader (no dotenv dep). Runner-only, gitignored file.
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]!;
    }
  } catch {
    /* .env optional — env may already be set */
  }
}
loadEnvFile(".env");
loadEnvFile("apps/kith-inn-be/.env");

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("✗ DEEPSEEK_API_KEY not set (put in apps/kith-inn-be/.env or export it).");
    process.exit(2);
  }

  const predicted: Record<string, EvalItem[]> = {};
  const startedAt = performance.now();
  let issueMismatchCount = 0;
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  console.log(`model=${model} referenceDate=${JIELONG_EVAL_REFERENCE_DATE} samples=${jielongSamples.length}`);
  for (const s of jielongSamples) {
    process.stdout.write(`parsing ${s.id} … `);
    const sampleStartedAt = performance.now();
    try {
      const parsed = await parseOrderInput(s.raw, { referenceDate: JIELONG_EVAL_REFERENCE_DATE });
      predicted[s.id] = parsed.items;
      const actualIssues = [...new Set(parsed.issues.map((issue) => issue.code))].sort();
      const expectedIssues = [...(s.expectedIssueCodes ?? [])].sort();
      if (JSON.stringify(actualIssues) !== JSON.stringify(expectedIssues)) issueMismatchCount++;
      console.log(`${parsed.items.length} items, issues=[${actualIssues.join(",") || "none"}], ${Math.round(performance.now() - sampleStartedAt)}ms`);
    } catch (e) {
      console.log(`ERROR: ${(e as Error).message}`);
      predicted[s.id] = [];
      issueMismatchCount++;
    }
  }

  const { perSample, fieldAccuracy, totalMisassigned } = evaluateAll(jielongSamples, predicted);
  console.log("\n── per sample ──────────────────────────────");
  for (const s of jielongSamples) {
    const r = perSample[s.id]!;
    console.log(
      `  ${s.id.padEnd(28)} correct ${String(r.correct).padStart(2)}/${r.total}  ${(r.pct * 100).toFixed(0).padStart(3)}%  misassign ${r.misassigned}`,
    );
  }
  console.log("────────────────────────────────────────────");
  console.log(`  field accuracy : ${(fieldAccuracy * 100).toFixed(1)}%  (target ≥ 95%)`);
  console.log(`  午/晚 错配      : ${totalMisassigned}  (target = 0)`);
  console.log(`  issue mismatches: ${issueMismatchCount}  (target = 0)`);
  console.log(`  elapsed         : ${Math.round(performance.now() - startedAt)}ms`);

  const pass = fieldAccuracy >= 0.95 && totalMisassigned === 0 && issueMismatchCount === 0;
  console.log(pass ? "\n✓ M1 acceptance MET" : "\n✗ M1 acceptance NOT met");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
