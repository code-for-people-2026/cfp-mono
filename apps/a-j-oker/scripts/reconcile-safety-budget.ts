import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { openBudget } from "./safety/budget";

const [prior, ...evidenceFiles] = process.argv.slice(2);
if (!prior || !evidenceFiles.length) throw new Error("Supply prior budget and usage evidence files");
const journal = `${prior}.continuation.jsonl`;
const entries = existsSync(journal) ? readFileSync(journal, "utf8").trim().split("\n").filter(Boolean).map(s => JSON.parse(s)) : [];
const settled = new Set(entries.filter(e => e.event === "settle").map(e => e.id));
const budget = openBudget(prior), before = budget.total;
let count = 0, retained = 0;
try {
  for (const file of evidenceFiles) for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const row = JSON.parse(line);
    if (settled.has(row.reservation)) continue;
    if (row.status !== 200 || row.model !== "deepseek-flash" || !row.usage) { retained++; continue; }
    budget.settle({ id: row.reservation, caseId: row.caseId, status: row.status, model: row.model, usage: row.usage, evidenceSha256: createHash("sha256").update(line).digest("hex") });
    settled.add(row.reservation); count++;
  }
  console.log(JSON.stringify({ before, after: budget.total, settledCalls: count, retainedEvidenceRows: retained, note: "Original floor and all unevidenced reservations retained. Not a billing statement." }));
} finally { budget.close(); }
