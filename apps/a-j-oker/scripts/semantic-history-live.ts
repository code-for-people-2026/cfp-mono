/** Explicit, real-model semantic routing regression; no production database or image provider. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateText, interactionAssessmentSchema, type InteractionAssessment } from "../src/domain/moderation";
import { DEFAULT_MODEL } from "../src/models/deepseek";
import { semanticHistoryCases, semanticHistoryCorpus, type SemanticHistoryCase } from "./semantic-history-corpus";

assert.ok(process.argv.includes("--live"), "Pass --live to invoke the real product model");
assert.ok(process.env.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY required");

const filterAt = process.argv.indexOf("--filter");
const filter = filterAt < 0 ? undefined : process.argv[filterAt + 1];
const cases = semanticHistoryCases(filter);
assert.ok(cases.length, "No matching cases");
const fullCorpus = !filter;
if (fullCorpus) {
  assert.equal(cases.length, semanticHistoryCorpus.cases.length);
  assert.equal(cases.length, 284, "Final semantic history corpus must contain 284 cases");
}

const output = resolve(process.env.SEMANTIC_REPORT || ".data/semantic-history-live.json");
await mkdir(dirname(output), { recursive: true });

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = [
  "scripts/semantic-history-live.ts",
  "scripts/semantic-history-corpus.ts",
  "docs/semantic-keyword-history.json",
  "src/domain/moderation.ts",
  "src/domain/service-scope.ts",
  "src/models/deepseek.ts",
] as const;
const hashes: Record<string, string> = {};
for (const file of sourceFiles) {
  hashes[file] = createHash("sha256").update(await readFile(resolve(appRoot, file))).digest("hex");
}
const selectedCaseSetFingerprint = createHash("sha256").update(JSON.stringify(cases)).digest("hex");

type Verdict = Awaited<ReturnType<typeof evaluateText>>;
type AttemptDecision = Verdict["decision"] | "error";
type Attempt = {
  decision: AttemptDecision;
  failure?: Verdict["failure"] | "script";
  serviceScope?: Verdict["serviceScope"];
  interaction?: InteractionAssessment;
  latencyMs: number;
};
type Result = {
  id: string;
  expected: {
    decision: SemanticHistoryCase["expected"]["decision"];
    serviceScope: SemanticHistoryCase["expected"]["serviceScope"];
    interaction: InteractionAssessment;
  };
  actual: Attempt;
  attempts: Attempt[];
  passed: boolean;
  differences: string[];
};
const results: Result[] = [];
let cursor = 0;
const startedAt = new Date().toISOString();
const model = process.env.HELLO_MODEL || DEFAULT_MODEL;
let reportWrite: Promise<void> = Promise.resolve();

function verdictAttempt(verdict: Verdict, latencyMs: number): Attempt {
  return {
    decision: verdict.decision,
    ...(verdict.failure ? { failure: verdict.failure } : {}),
    ...(verdict.serviceScope ? { serviceScope: verdict.serviceScope } : {}),
    ...(verdict.interaction ? { interaction: verdict.interaction } : {}),
    latencyMs,
  };
}

function errorAttempt(latencyMs: number): Attempt {
  return {
    decision: "error",
    failure: "script",
    latencyMs,
  };
}

async function persistReport(finishedAt: string | null, complete: boolean) {
  const write = reportWrite.then(async () => {
    const failures = results.filter((result) => !result.passed);
    const report = {
      startedAt,
      finishedAt,
      model,
      hashes,
      corpusCounts: semanticHistoryCorpus.counts,
      caseSet: {
        count: cases.length,
        fingerprint: selectedCaseSetFingerprint,
        fullCorpus,
      },
      scope: "Real production evaluateText only; synthetic corpus; no images generated, notifications, accounts or database writes",
      complete,
      passed: complete && failures.length === 0,
      total: results.length,
      passedCount: results.length - failures.length,
      failureCount: failures.length,
      failures: failures.map((result) => result.id),
      firstAttemptUnavailable: results.filter((result) => result.attempts[0].decision === "unavailable").length,
      retried: results.filter((result) => result.attempts.length > 1).length,
      results,
    };
    await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
    await chmod(output, 0o600);
  });
  reportWrite = write;
  await write;
}

async function check(testCase: SemanticHistoryCase) {
  // The manifest is typed but imported as data; enforce the reviewer's exact
  // seven-flag contract before any expected metadata can influence acceptance.
  const expectedInteraction = interactionAssessmentSchema.parse(testCase.expected.interaction);
  const attempts: Attempt[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      const verdict = await evaluateText({
        apiKey: process.env.DEEPSEEK_API_KEY,
        stage: "input",
        serviceScope: true,
        interaction: true,
        purpose: testCase.purpose,
        texts: [testCase.input],
        context: testCase.context,
        requestId: randomUUID(),
      });
      attempts.push(verdictAttempt(verdict, Date.now() - started));
      if (verdict.decision !== "unavailable") break;
    } catch {
      attempts.push(errorAttempt(Date.now() - started));
      break;
    }
  }

  const actual = attempts.at(-1)!;
  const differences: string[] = [];
  if (actual.decision !== testCase.expected.decision)
    differences.push(`decision: expected ${testCase.expected.decision}, received ${actual.decision}`);

  // evaluateText requires service scope only for allow. A safety refusal may
  // legitimately omit this optional field, but a supplied value is still checked.
  if (actual.decision === "allow" || actual.serviceScope !== undefined) {
    if (actual.serviceScope !== testCase.expected.serviceScope)
      differences.push(`scope: expected ${testCase.expected.serviceScope}, received ${actual.serviceScope}`);
  }

  if (!actual.interaction) {
    differences.push("interaction: expected seven flags, received none");
  } else {
    for (const flag of Object.keys(expectedInteraction) as Array<keyof InteractionAssessment>)
      if (actual.interaction[flag] !== expectedInteraction[flag])
        differences.push(`${flag}: expected ${expectedInteraction[flag]}, received ${actual.interaction[flag]}`);
  }

  const result: Result = {
    id: testCase.id,
    expected: {
      decision: testCase.expected.decision,
      serviceScope: testCase.expected.serviceScope,
      interaction: expectedInteraction,
    },
    actual,
    attempts,
    passed: differences.length === 0,
    differences,
  };
  results.push(result);
  if (!result.passed)
    console.log(JSON.stringify({ id: result.id, passed: false, differences, actual }));
  else if (results.length % 20 === 0)
    console.log(JSON.stringify({ completed: results.length, total: cases.length }));

  // Persist privacy-safe progress so interruptions never hide completed calls.
  await persistReport(null, false);
}

await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < cases.length) {
    const testCase = cases[cursor++];
    await check(testCase);
  }
}));

await persistReport(new Date().toISOString(), true);
const failureCount = results.filter((result) => !result.passed).length;
console.log(JSON.stringify({
  report: output,
  total: results.length,
  passed: failureCount === 0,
  firstAttemptUnavailable: results.filter((result) => result.attempts[0].decision === "unavailable").length,
  failures: results.filter((result) => !result.passed).map((result) => result.id),
}));
assert.equal(failureCount, 0, "Semantic history regression failed; retained privacy-safe verdicts");
