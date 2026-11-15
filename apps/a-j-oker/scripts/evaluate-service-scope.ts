/** Budgeted real DeepSeek scope check; synthetic bank inputs only, no generation tools. */
import "./load-local-env";
import { readFileSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { openBudget, reserveForRequest } from "./safety/budget";
import { evaluateText } from "../src/domain/moderation";
import { SERVICE_SCOPE_VERSION, SERVICE_SCOPE_INSTRUCTION } from "../src/domain/service-scope";
const [source, prior, output, consent] = process.argv.slice(2);
if (!source || !prior || !output || consent !== "--live-within-50-cny") throw Error("Provide source, budget, NEW output, explicit live flag");
const rows = JSON.parse(readFileSync(source, "utf8")) as { id: string; input: string }[];
if (!rows.length || rows.length > 1500 || rows.some(r => !r.id || typeof r.input !== "string" || r.input.length > 4000)) throw Error("Invalid bank");
if (!process.env.DEEPSEEK_API_KEY) throw Error("Missing key");
process.env.HELLO_MODEL = "deepseek-flash";
mkdirSync(output);
const budget = openBudget(prior, 45), nativeFetch = globalThis.fetch;
let done = 0;
const scope = new AsyncLocalStorage<string>();
globalThis.fetch = async (url, init) => {
  const current = scope.getStore();
  if (String(url) !== "https://api.deepseek.com/chat/completions" || !current || typeof init?.body !== "string") throw Error("Unexpected provider request");
  const reservation = budget.reserve(reserveForRequest(init.body), current);
  const response = await nativeFetch(url, init);
  const data = await response.clone().json().catch(() => ({}));
  const u = data.usage;
  const usage = u ? { prompt: u.prompt_tokens, completion: u.completion_tokens, hit: u.prompt_cache_hit_tokens ?? 0, miss: u.prompt_cache_miss_tokens ?? u.prompt_tokens - (u.prompt_cache_hit_tokens ?? 0) } : null;
  const evidence = JSON.stringify({ at: new Date().toISOString(), caseId: current, reservation, model: data.model, status: response.status, usage });
  appendFileSync(`${output}/usage.jsonl`, evidence + "\n");
  if (response.ok && data.model === "deepseek-flash" && usage) budget.settle({ id: reservation, caseId: current, model: data.model, status: 200, usage, evidenceSha256: createHash("sha256").update(evidence).digest("hex") });
  return response;
};
try {
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < rows.length && budget.total < 44.5) {
      const row = rows[next++];
      await scope.run(row.id, async () => {
        const result = await evaluateText({ stage: "input", serviceScope: true, texts: [row.input], requestId: row.id, apiKey: process.env.DEEPSEEK_API_KEY });
        appendFileSync(`${output}/verdicts.jsonl`, JSON.stringify({ id: row.id, input: row.input, ...result, at: new Date().toISOString(), version: SERVICE_SCOPE_VERSION, SERVICE_SCOPE_INSTRUCTION }) + "\n");
        done++;
        if (done % 25 === 0) console.log(JSON.stringify({ done, total: rows.length, reservedCny: budget.total }));
      });
    }
  }));
} finally {
  globalThis.fetch = nativeFetch;
  writeFileSync(`${output}/summary.json`, JSON.stringify({ done, total: rows.length, reservedCny: budget.total, version: SERVICE_SCOPE_VERSION, SERVICE_SCOPE_INSTRUCTION }));
  budget.close();
}
