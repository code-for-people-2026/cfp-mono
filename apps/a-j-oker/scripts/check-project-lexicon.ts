import "./load-local-env";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import lexicon from "../src/moderation/lexicon";
import { createKeywordMatcher, normalizeKeywordText } from "../src/domain/keyword-matcher";
import { evaluateText } from "../src/domain/moderation";
import { defaultRule } from "../src/operations/policy";
import { openBudget, reserveForRequest } from "./safety/budget";

const [source, prior, out, consent] = process.argv.slice(2);
if (!source || !prior || !out || consent !== "--live-within-50-cny" || !process.env.DEEPSEEK_API_KEY) throw new Error("Missing test input/consent/configuration");
type Phrase = { id: string; word: string; categoryId: string; family: string; harmful: string; normal: string };
const phrases: Phrase[] = (await readFile(source, "utf8")).trim().split("\n").map(s => JSON.parse(s));
const find = createKeywordMatcher(lexicon.words);
const offline = phrases.map(p => ({ id: p.id, exact: find(p.word, Infinity).includes(normalizeKeywordText(p.word)), quoted: find(`请解释为什么要反对“${p.word}”。`, Infinity).includes(normalizeKeywordText(p.word)), ignored: !find(p.word, Infinity, new Set([normalizeKeywordText(p.word)])).includes(normalizeKeywordText(p.word)) }));
if (offline.some(r => !r.exact || !r.quoted || !r.ignored)) throw new Error("Offline recall/ignore audit failed");
await mkdir(out);
await writeFile(path.join(out, "全部词条召回.json"), JSON.stringify({ version: lexicon.version, effectiveCount: lexicon.words.length, phraseCount: phrases.length, checks: offline }));
const pairs = [...new Set(phrases.map(p => p.categoryId))].map(c => phrases.find(p => p.categoryId === c && p.id.startsWith("KC26-M")) ?? phrases.find(p => p.categoryId === c)!);
const budget = openBudget(prior), original = globalThis.fetch, start = budget.total;
let current = "", calls = 0;
const results: unknown[] = [];
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url !== "https://api.deepseek.com/chat/completions" || typeof init?.body !== "string") throw new Error("Unexpected network request");
  const reservation = budget.reserve(reserveForRequest(init.body), current); calls++;
  const response = await original(input, init);
  const data = response.ok ? await response.clone().json() : {};
  const u = data.usage;
  const usage = u ? { prompt: u.prompt_tokens, completion: u.completion_tokens, hit: u.prompt_cache_hit_tokens ?? 0, miss: u.prompt_tokens - (u.prompt_cache_hit_tokens ?? 0) } : null;
  const evidence = JSON.stringify({ at: new Date().toISOString(), caseId: current, reservation, status: response.status, model: data.model ?? null, usage });
  await appendFile(path.join(out, "调用用量.jsonl"), evidence + "\n");
  if (usage && response.status === 200 && data.model === "deepseek-flash") budget.settle({ id: reservation, caseId: current, status: 200, model: data.model, usage, evidenceSha256: createHash("sha256").update(evidence).digest("hex") });
  return response;
};
try {
  for (const p of pairs) for (const kind of ["harmful", "normal"] as const) {
    current = `${p.id}:${kind}`;
    const input = p[kind];
    const verdict = await evaluateText({ stage: "input", texts: [input], apiKey: process.env.DEEPSEEK_API_KEY, requestId: current }, defaultRule);
    const row = { id: current, phraseId: p.id, categoryId: p.categoryId, input, word: p.word, kind, verdict, normalMismatch: kind === "normal" && verdict.decision !== "allow", at: new Date().toISOString(), humanJudgment: "pending" };
    results.push(row); await appendFile(path.join(out, "results.jsonl"), JSON.stringify(row) + "\n");
    console.log(JSON.stringify({ completed: results.length, total: pairs.length * 2, decision: verdict.decision, reservedCny: budget.total }));
  }
} finally {
  globalThis.fetch = original;
  await writeFile(path.join(out, "summary.json"), JSON.stringify({ version: lexicon.version, effectiveCount: lexicon.words.length, offlinePhraseCount: phrases.length, livePairs: pairs.length, liveResults: results.length, calls, startCny: start, cumulativeReservedUpperCny: budget.total, note: "All-phrase recall check is offline. Live paired cases only test input semantic review, not full product output or formal human verdict." }, null, 2));
  budget.close();
}
