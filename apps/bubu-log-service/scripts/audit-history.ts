import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { auditHistory } from "../src/records/history-audit";

// Usage: pnpm exec tsx scripts/audit-history.ts --before original.json [--after mapped.json] [--out report.json]
// Input: { "activities": [raw Activity documents], "dailyStats": [optional raw DailyStat documents] }
try {
  const { values } = parseArgs({ options: { before: { type: "string" }, after: { type: "string" }, out: { type: "string" }, help: { type: "boolean" } }, strict: true });
  if (values.help) console.log("Offline JSON history audit: --before original.json [--after mapped.json] [--out report.json]. No database or network access.");
  else {
    if (!values.before) throw new Error("--before is required");
    const original = JSON.parse(await readFile(values.before, "utf8"));
    const mapped = values.after ? JSON.parse(await readFile(values.after, "utf8")) : undefined;
    const report = auditHistory(original, mapped), output = `${JSON.stringify(report, null, 2)}\n`;
    if (values.out) await writeFile(values.out, output, { flag: "wx", mode: 0o600 }); else process.stdout.write(output);
    if (report.preserved === false || report.statisticsMatch === false) process.exitCode = 1;
  }
} catch {
  // Validation errors may contain private input. Do not echo raw documents or photo URLs.
  console.error("History audit failed: check --before/--after JSON shape and values, and use a new --out path. Input documents are not echoed.");
  process.exitCode = 2;
}
