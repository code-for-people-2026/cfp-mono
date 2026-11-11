/** Offline structural and provenance check for the semantic history corpus. */
import assert from "node:assert/strict";
import { lexicalKeywords, semanticHistoryCorpus } from "./semantic-history-corpus";

const interactionFields = ["minor", "crisis", "dependency", "overuse", "exit", "forget_context", "image_requested"] as const;
const regexIds = new Set(semanticHistoryCorpus.originalRegexes.map((row) => row.id));
const caseById = new Map(semanticHistoryCorpus.cases.map((row) => [row.id, row]));
const keywordValues = new Set(semanticHistoryCorpus.keywords.map((row) => row.value));
const manual = new Set(semanticHistoryCorpus.lexicalPolicy.manualExpansions);

assert.equal(semanticHistoryCorpus.counts.regex, semanticHistoryCorpus.originalRegexes.length, "regex count");
assert.equal(semanticHistoryCorpus.counts.keyword, semanticHistoryCorpus.keywords.length, "keyword count");
assert.equal(semanticHistoryCorpus.counts.case, semanticHistoryCorpus.cases.length, "case count");
assert.ok(semanticHistoryCorpus.cases.length >= 200 && semanticHistoryCorpus.cases.length <= 350, "case range");
assert.equal(new Set(semanticHistoryCorpus.originalRegexes.map((row) => row.id)).size, semanticHistoryCorpus.originalRegexes.length, "unique regex IDs");
assert.equal(new Set(semanticHistoryCorpus.cases.map((row) => row.id)).size, semanticHistoryCorpus.cases.length, "unique case IDs");
assert.equal(new Set(keywordValues).size, semanticHistoryCorpus.keywords.length, "unique keywords");
assert.ok(semanticHistoryCorpus.cases.filter((row) => row.kind === "curated").length >= 30, "curated variety");

for (const row of semanticHistoryCorpus.originalRegexes) {
  assert.match(row.id, /^regex-\d{3}$/);
  assert.ok(row.pattern.startsWith("/") && /\/[a-z]*$/i.test(row.pattern), `${row.id}: original pattern`);
  assert.match(row.source.commit, /^[0-9a-f]{40}$/);
  assert.ok(row.source.path.startsWith("apps/") && row.source.path.endsWith(".ts"));
  assert.ok(Number.isInteger(row.source.line) && row.source.line > 0);
  assert.ok(row.source.date && row.source.subject && row.source.chain);
  assert.ok(row.occurrences.length > 0, `${row.id}: occurrences retained`);
  assert.ok(row.caseIds.every((id) => caseById.has(id)), `${row.id}: case references`);
  const extracted = lexicalKeywords(row.pattern);
  assert.deepEqual(extracted.filter((word) => row.keywords.includes(word)), extracted, `${row.id}: lexical coverage`);
  for (const word of row.keywords) {
    assert.ok(extracted.includes(word) || manual.has(word) || (word.length === 1 && row.pattern.includes(word)), `${row.id}: unexpected keyword ${word}`);
  }
  if (row.excludedFromCaseGeneration) {
    assert.equal(row.id, "regex-025");
    assert.deepEqual(row.keywords, []);
    assert.deepEqual(row.caseIds, []);
    assert.ok(row.exclusionReason?.includes("digit"));
  } else {
    assert.ok(row.keywords.length > 0, `${row.id}: keywords`);
    assert.ok(row.caseIds.length > 0, `${row.id}: linked cases`);
  }
}

assert.equal(semanticHistoryCorpus.originalRegexes.filter((row) => row.excludedFromCaseGeneration).length, 1);
assert.equal(semanticHistoryCorpus.cases.filter((row) => row.purpose === "image_generation").length >= 8, true, "image-purpose cases");
assert.equal(semanticHistoryCorpus.cases.filter((row) => row.purpose === undefined).length >= 150, true, "ordinary-input cases");

for (const word of semanticHistoryCorpus.keywords) {
  assert.ok(word.value.length >= 1);
  assert.ok(word.sourceRegexIds.every((id) => regexIds.has(id)), `${word.value}: source references`);
  assert.ok(word.sourceRegexIds.length > 0, `${word.value}: source regex`);
  assert.ok(word.ordinaryDisclosureCaseIds.length > 0, `${word.value}: ordinary disclosure counterexample`);
  assert.ok(word.caseIds.length >= word.ordinaryDisclosureCaseIds.length);
  for (const id of word.caseIds) {
    const row = caseById.get(id);
    assert.ok(row, `${word.value}: case reference ${id}`);
    assert.ok(row.input.includes(word.value), `${word.value}: absent from ${id}`);
  }
  for (const id of word.ordinaryDisclosureCaseIds) {
    const row = caseById.get(id);
    assert.equal(row?.kind, "ordinary-disclosure", `${word.value}: disclosure kind`);
    assert.equal(row?.purpose, undefined);
    assert.equal(row?.expected.decision, "allow");
    assert.equal(row?.expected.serviceScope, "support");
    assert.deepEqual(row?.expected.interaction, Object.fromEntries(interactionFields.map((flag) => [flag, false])));
  }
}

for (const row of semanticHistoryCorpus.cases) {
  assert.ok(row.input.length > 0 && row.input.length <= 1000, `${row.id}: input size`);
  assert.ok(["allow", "block", "uncertain"].includes(row.expected.decision));
  assert.ok(["support", "outside", "unclear"].includes(row.expected.serviceScope));
  assert.deepEqual(Object.keys(row.expected.interaction).sort(), [...interactionFields].sort(), `${row.id}: seven bools`);
  for (const flag of interactionFields) assert.equal(typeof row.expected.interaction[flag], "boolean", `${row.id}.${flag}`);
  assert.ok(row.keywords.every((word) => keywordValues.has(word) && row.input.includes(word)), `${row.id}: keyword references`);
  assert.ok(row.sourceRegexIds.every((id) => regexIds.has(id)), `${row.id}: source references`);
  if (row.kind === "ordinary-disclosure") {
    assert.equal(row.context, undefined);
    assert.equal(row.purpose, undefined);
    assert.equal(row.expected.decision, "allow");
    assert.equal(row.expected.serviceScope, "support");
  }
}

for (const flag of interactionFields) {
  assert.ok(semanticHistoryCorpus.cases.some((row) => row.expected.interaction[flag]), `${flag}: positive case`);
}
for (let age = 0; age <= 17; age++) {
  assert.ok(caseById.has(`age-ascii-${String(age).padStart(2, "0")}`));
  assert.ok(caseById.has(`age-fullwidth-${String(age).padStart(2, "0")}`));
}
assert.equal(semanticHistoryCorpus.cases.filter((row) => row.kind === "chinese-age").length, 19);

console.log(JSON.stringify({
  passed: true,
  regexes: semanticHistoryCorpus.originalRegexes.length,
  keywords: semanticHistoryCorpus.keywords.length,
  cases: semanticHistoryCorpus.cases.length,
  imagePurposeCases: semanticHistoryCorpus.cases.filter((row) => row.purpose === "image_generation").length,
}));
