import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fingerprint, importPublic, sampleByGroup, splitFamily, classify, mergeCandidateLabels, categoryRules, type SafetyCase } from "./safety/bank";
import { projectCases } from "./safety/project-cases";

const [sourceDir, previousDir, outputDir] = process.argv.slice(2);
if (!sourceDir || !previousDir || !outputDir) throw new Error("Usage: prepare-safety-bank source-directory prior-evidence output-directory");
const commit = "bbfd3ce47a32b998e4b94225a375b41e44070ae5";
const pins: Record<string, string> = {
  "LICENSE": "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
  "README.md": "459d4b46b3aecf75d11afff6d3fdcab3534cd38cb5bd5fedaada5d3adbbcf88f",
  "typical_safety_scenarios.json": "541a40f4666a750b702747fd866a9fd2653d838078e2c8362d6a72c8a88a2576",
  "instruction_attack_scenarios.json": "bea01b9d2b277f2a3ca212d9c34e1c0f3ca497da536eb64b32b60b737594bb91",
};
await mkdir(outputDir); // Evidence is immutable; prepare a new directory for each revision.
const manifests = [], all: SafetyCase[] = [], seen = new Set<string>();
let duplicateAcrossFiles = 0;
for (const [file, sha] of Object.entries(pins)) {
  const raw = await readFile(path.join(sourceDir, file), "utf8");
  if (fingerprint(raw) !== sha) throw new Error(`Source checksum mismatch: ${file}`);
  if (file.endsWith(".json")) {
    const imported = importPublic(JSON.parse(raw), file, commit);
    for (const item of imported.items) { if (seen.has(item.family)) { duplicateAcrossFiles++; continue; } seen.add(item.family); all.push(item); }
    manifests.push({ file, sha256: sha, excluded: imported.excluded, duplicateWithinFile: imported.duplicate, retainedBeforeCrossFileDedup: imported.items.length });
  } else manifests.push({ file, sha256: sha });
}
const json = (name: string, value: unknown) => writeFile(path.join(outputDir, name), JSON.stringify(value, null, 2) + "\n");
const jsonl = (name: string, rows: unknown[]) => writeFile(path.join(outputDir, name), rows.map(x => JSON.stringify(x)).join("\n") + "\n");
await jsonl("公开题库池.jsonl", all);
const curated = sampleByGroup(all, 120, "hello-public-candidates-20261025-v1");
await jsonl("公开候选题.jsonl", curated);
await jsonl("多轮与旧缺陷.jsonl", projectCases);
const legacy: SafetyCase[] = [];
for (const file of ["生成题库.jsonl", "非拒答题库.jsonl"]) {
  const rows = (await readFile(path.join(previousDir, file), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  for (const row of rows) {
    const family = `legacy:${row.family}`;
    legacy.push({ id: row.id, family, source: file, sourceCategory: row.category || row.topic, categories: classify(row.input), turns: [row.input], expected: row.criterion, modality: /图片/.test(row.modality) ? "image" : "text", split: splitFamily(family), humanReview: "pending", provenance: `20261024/${file}#${row.id}` });
  }
}
// This is engineering regression. Holdout is reserved, never used to tune prompts.
const eligible = (item: SafetyCase) => item.modality === "text" && item.split === "development" && !/画|绘|海报|生成.{0,8}(图|照)|图片|照片|画像/.test(item.turns.join(" "));
const sample = [
  // Spend the bounded budget on required product regressions before breadth.
  ...projectCases,
  ...sampleByGroup(legacy.filter(eligible), 2, "hello-regression-20261025-v1"),
  ...sampleByGroup(curated.filter(eligible), 4, "hello-regression-20261025-v1"),
];
await jsonl("应用回归样本.jsonl", sample);
const lexicon = JSON.parse(await readFile(new URL("../src/moderation/lexicon.json", import.meta.url), "utf8"));
// A narrower draft matcher is not evidence for deleting an existing candidate.
// Keep prior same-word labels until an actual reviewer resolves the change.
const previousLabels = new Map((await readFile(path.join(previousDir, "词库分类候选.jsonl"), "utf8")).trim().split("\n").map(line => {
  const row = JSON.parse(line) as { word: string; ruleIds: string[] };
  if (!Array.isArray(row.ruleIds) || row.ruleIds.some(id => !categoryRules.some(([known]) => id === known))) throw new Error("Invalid previous candidate labels");
  return [row.word, row.ruleIds] as const;
}));
const mapping = lexicon.words.map((word: string, index: number) => ({ index: index + 1, word, categories: mergeCandidateLabels(word, previousLabels.get(word)), status: "保留旧候选并合并新规则，待人工审定；仅召回复核" }));
await jsonl("词库分类候选.jsonl", mapping);
const counts = categoryRules.map(([id, label, pattern]) => ({ id, label, pattern, candidateCount: mapping.filter((r: { categories: string[] }) => r.categories.includes(id)).length, humanApproved: 0, applicability: id === "KW-30" || id === "KW-31" ? "场景评测，不以词数计量" : "旧候选与新规则合并；不代表违规或达标" }));
await json("词库分类覆盖.json", { version: lexicon.version, words: mapping.length, classified: mapping.filter((r: { categories: string[] }) => r.categories.length).length, humanApproved: 0, categories: counts });
await json("来源与抽样.json", { createdAt: new Date().toISOString(), source: "https://github.com/thu-coai/Safety-Prompts", commit, license: "Apache-2.0", files: manifests, duplicateAcrossFiles, poolCount: all.length, publicCandidates: curated.length, projectCases: projectCases.length, regressionCases: sample.length, regressionTurns: sample.reduce((n, x) => n + x.turns.length, 0), seed: "hello-regression-20261025-v1", sampleHash: fingerprint(JSON.stringify(sample)), split: "Known project families and normalized-identical public prompts share splits. Semantic near-duplicates still require review. Mandatory project defect checks are development only.", limitations: ["上游ChatGPT回复不导入为标准答案或本应用输出", "来源分类和本地规则映射均非人工审定，不能直接计算正式合格率", "词库只召回复核；未分类不代表安全，命中不代表违规", "本次抽样为工程回归，不是正式报送随机抽样", "图片、真机、部署配置和人工响应另行验收"] });
console.log(JSON.stringify({ pool: all.length, candidates: curated.length, project: projectCases.length, liveCases: sample.length, liveTurns: sample.reduce((n, x) => n + x.turns.length, 0), classifiedWords: mapping.filter((r: { categories: string[] }) => r.categories.length).length }));
