import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { SafetyCase } from "../scripts/safety/bank";
import { buildCodeSnapshot, verifyFilingRetest, actualCodeSnapshot, type CodeSnapshot, type FilingRetestManifest } from "../scripts/safety/filing";

const execute = promisify(execFile);
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join("\n") + "\n";
const codeSnapshot = buildCodeSnapshot({ gitCommit: "a".repeat(40), dirtyDiffSha256: null }, {
  runSafetyRegression: "1".repeat(64), safetyBank: "2".repeat(64), safetyFiling: "3".repeat(64), appRuntime: "4".repeat(64),
});

function caseRow(id: string, split: SafetyCase["split"] = "filing-retest"): SafetyCase {
  return { id, family: `family:${id}`, source: "filing", sourceCategory: "actual-service", categories: [], turns: [`请正常回答${id}`], expected: "待人工评阅", modality: "text", split, humanReview: "pending", provenance: `filing/${id}` };
}

function fixture(options: { sample?: SafetyCase[]; bank?: SafetyCase[]; manifest?: Partial<FilingRetestManifest> } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "filing-retest-"));
  const sample = options.sample ?? [caseRow("S1")], bank = options.bank ?? sample;
  writeFileSync(path.join(dir, "sample.jsonl"), jsonl(sample));
  writeFileSync(path.join(dir, "bank.jsonl"), jsonl(bank));
  writeFileSync(path.join(dir, "budget.json"), JSON.stringify({ reserved: 1, capCny: 50, stopCny: 45 }));
  const manifest: FilingRetestManifest = {
    kind: "filing-retest", version: 1,
    sample: { path: "sample.jsonl", sha256: sha256(jsonl(sample)), count: sample.length },
    bank: { path: "bank.jsonl", sha256: sha256(jsonl(bank)), totalBankCount: bank.length },
    sourceApp: { gitCommit: codeSnapshot.gitCommit, dirtyDiffSha256: null },
    codeSnapshot: { runSafetyRegressionSha256: codeSnapshot.files.runSafetyRegression, safetyBankSha256: codeSnapshot.files.safetyBank, safetyFilingSha256: codeSnapshot.files.safetyFiling, appRuntimeSha256: codeSnapshot.files.appRuntime, sha256: codeSnapshot.sha256 },
    priorBudgetSha256: sha256(JSON.stringify({ reserved: 1, capCny: 50, stopCny: 45 })),
    ...options.manifest,
  };
  writeFileSync(path.join(dir, "sample.jsonl.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { dir, samplePath: path.join(dir, "sample.jsonl"), budgetPath: path.join(dir, "budget.json"), manifestPath: path.join(dir, "sample.jsonl.manifest.json"), manifest };
}

function verify(fixtureResult: ReturnType<typeof fixture>, snapshot: CodeSnapshot = codeSnapshot) {
  return verifyFilingRetest({ manifestPath: fixtureResult.manifestPath, samplePath: fixtureResult.samplePath, priorBudgetPath: fixtureResult.budgetPath, codeSnapshot: snapshot });
}

describe("offline filing retest provenance", () => {
  it("verifies exact sample, full bank, code and budget fingerprints without network or environment loading", () => {
    const item = fixture();
    const fetch = vi.fn(), environment = { ...process.env };
    vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
    try {
      expect(verify(item)).toMatchObject({ sampleCount: 1, totalBankCount: 1, codeSnapshotSha256: codeSnapshot.sha256 });
      expect(fetch).not.toHaveBeenCalled();
      expect(process.env).toEqual(environment);
    } finally { vi.restoreAllMocks(); }
  });

  it("rejects manifest, sample, bank, code and budget mismatches", () => {
    const count = fixture({ manifest: { sample: { path: "sample.jsonl", sha256: "a".repeat(64), count: 1 } } });
    expect(() => verify(count)).toThrow("sample or bank hash mismatch");
    rmSync(count.dir, { recursive: true, force: true });

    const sample = fixture(); writeFileSync(sample.samplePath, jsonl([caseRow("changed")]));
    expect(() => verify(sample)).toThrow("sample or bank hash mismatch");
    rmSync(sample.dir, { recursive: true, force: true });

    const bank = fixture({ bank: [caseRow("S1"), caseRow("S2")] }); writeFileSync(path.join(bank.dir, "bank.jsonl"), jsonl([caseRow("changed")]));
    expect(() => verify(bank)).toThrow("sample or bank hash mismatch");
    rmSync(bank.dir, { recursive: true, force: true });

    const code = fixture(); const changed = buildCodeSnapshot({ gitCommit: "b".repeat(40), dirtyDiffSha256: null }, codeSnapshot.files);
    expect(() => verify(code, changed)).toThrow("Code snapshot mismatch");
    rmSync(code.dir, { recursive: true, force: true });

    const budget = fixture(); writeFileSync(budget.budgetPath, JSON.stringify({ reserved: 2, capCny: 50, stopCny: 45 }));
    expect(() => verify(budget)).toThrow("Prior budget hash mismatch");
    rmSync(budget.dir, { recursive: true, force: true });
  });

  it("rejects non-filing splits, borrowed historical answers or ratings, and non-identical bank rows", () => {
    const split = fixture({ sample: [caseRow("S1", "holdout")], bank: [caseRow("S1")] });
    expect(() => verify(split)).toThrow("Filing sample split mismatch");
    rmSync(split.dir, { recursive: true, force: true });

    const borrowed = fixture();
    const borrowedRows = [{ ...caseRow("S1"), answer: "historical", humanRating: 1 }];
    writeFileSync(borrowed.samplePath, jsonl(borrowedRows));
    writeFileSync(borrowed.manifestPath, JSON.stringify({ ...borrowed.manifest, sample: { ...borrowed.manifest.sample, sha256: sha256(jsonl(borrowedRows)) } }));
    expect(() => verify(borrowed)).toThrow("Invalid filing sample case");
    rmSync(borrowed.dir, { recursive: true, force: true });

    const changedBankRow = { ...caseRow("S1"), expected: "changed" };
    const row = fixture({ bank: [changedBankRow] });
    expect(() => verify(row)).toThrow("Filing sample is not an exact bank row");
    rmSync(row.dir, { recursive: true, force: true });
  });

  it("rejects duplicate ids and non-filing rows in the whole bank", () => {
    const duplicate = fixture({ bank: [caseRow("S1"), caseRow("S1")] });
    expect(() => verify(duplicate)).toThrow("Duplicate filing bank id");
    rmSync(duplicate.dir, { recursive: true, force: true });

    const nonFiling = fixture({ bank: [caseRow("S1", "holdout")] });
    expect(() => verify(nonFiling)).toThrow("Filing bank split or review state mismatch");
    rmSync(nonFiling.dir, { recursive: true, force: true });
  });

  it("rejects batches over 500 and manifest paths outside the manifest directory", () => {
    const rows = Array.from({ length: 501 }, (_, index) => caseRow(`S${index}`));
    const oversized = fixture({ sample: rows, bank: rows });
    expect(() => verify(oversized)).toThrow("oversize");
    rmSync(oversized.dir, { recursive: true, force: true });

    const escaping = fixture();
    writeFileSync(`${escaping.dir}-outside.json`, jsonl([caseRow("S1")]));
    writeFileSync(escaping.manifestPath, JSON.stringify({ ...escaping.manifest, bank: { ...escaping.manifest.bank, path: `../${path.basename(escaping.dir)}-outside.json` } }));
    expect(() => verify(escaping)).toThrow("Invalid bank manifest path");
    rmSync(escaping.dir, { recursive: true, force: true });
    rmSync(`${escaping.dir}-outside.json`, { force: true });
  });

  it("includes staged source changes and rejects untracked runtime modules", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "filing-source-git-"));
    const write = (relativePath: string, contents: string) => {
      const target = path.join(root, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
    };
    try {
      for (const relativePath of [
        "apps/a-j-oker/scripts/run-safety-regression.ts",
        "apps/a-j-oker/scripts/safety/bank.ts",
        "apps/a-j-oker/scripts/safety/filing.ts",
        "apps/a-j-oker/src/runtime.ts",
        "packages/a-j-oker-contracts/src/contract.ts",
        "packages/agent-a2a/src/runtime.ts",
        "packages/base-chat-protocol/src/runtime.ts",
        "apps/a-j-oker/payload.config.ts",
        "pnpm-lock.yaml",
      ]) write(relativePath, `initial:${relativePath}\n`);
      await execute("git", ["init"], { cwd: root });
      await execute("git", ["add", "."], { cwd: root });
      await execute("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--no-gpg-sign", "-m", "initial"], { cwd: root });

      const clean = actualCodeSnapshot({ root });
      write("apps/a-j-oker/src/runtime.ts", "export const changed = true;\n");
      await execute("git", ["add", "apps/a-j-oker/src/runtime.ts"], { cwd: root });
      const staged = actualCodeSnapshot({ root });
      expect(clean.dirtyDiffSha256).toBeNull();
      expect(staged.dirtyDiffSha256).not.toBeNull();
      expect(staged.files.appRuntime).not.toBe(clean.files.appRuntime);

      write("apps/a-j-oker/src/app/new-module.ts", "export const value = true;\n");
      expect(() => actualCodeSnapshot({ root })).toThrow("Untracked runtime source not in code snapshot");
      rmSync(path.join(root, "apps/a-j-oker/src/app/new-module.ts"), { force: true });

      write("apps/a-j-oker/src/app/new-module.test.ts", "it(\"is test-only\", () => {});\n");
      expect(() => actualCodeSnapshot({ root })).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  it("runs the command preflight offline, creates no output, and defers local-env loading", async () => {
    const actual = actualCodeSnapshot(), item = fixture();
    const manifest = JSON.parse(readFileSync(item.manifestPath, "utf8")) as FilingRetestManifest;
    writeFileSync(item.manifestPath, JSON.stringify({
      ...manifest,
      sourceApp: { gitCommit: actual.gitCommit, dirtyDiffSha256: actual.dirtyDiffSha256 },
      codeSnapshot: { runSafetyRegressionSha256: actual.files.runSafetyRegression, safetyBankSha256: actual.files.safetyBank, safetyFilingSha256: actual.files.safetyFiling, appRuntimeSha256: actual.files.appRuntime, sha256: actual.sha256 },
    }, null, 2) + "\n");
    const output = path.join(item.dir, "not-created");
    const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const runner = path.join(app, "scripts/run-safety-regression.ts");
    try {
      const result = await execute(process.execPath, ["--import", "tsx", runner, item.samplePath, item.budgetPath, output, "--live-within-50-cny", "-", "--filing-retest", "--preflight-only"], { cwd: app, env: { PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin", NODE_ENV: "test" } });
      const report = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
      expect(report).toMatchObject({ mode: "filing-retest", preflightOnly: true, calls: 0, sampleCount: 1, totalBankCount: 1 });
      expect(existsSync(output)).toBe(false);
      expect(readFileSync(runner, "utf8")).not.toMatch(/^import\s+["']\.\/load-local-env["'];$/mu);
    } finally {
      rmSync(item.dir, { recursive: true, force: true });
      rmSync(output, { recursive: true, force: true });
    }
  }, 20_000);

  it("rejects preflight without filing mode and with extra mode arguments", async () => {
    const item = fixture(), output = path.join(item.dir, "not-created");
    const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const runner = path.join(app, "scripts/run-safety-regression.ts");
    const common = [item.samplePath, item.budgetPath, output, "--live-within-50-cny", "-"];
    try {
      await expect(execute(process.execPath, ["--import", "tsx", runner, ...common, "--preflight-only"], { cwd: app, env: { PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin", NODE_ENV: "test" } })).rejects.toThrow("Preflight requires exactly the filing-retest mode");
      await expect(execute(process.execPath, ["--import", "tsx", runner, ...common, "--filing-retest", "--unexpected", "--preflight-only"], { cwd: app, env: { PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin", NODE_ENV: "test" } })).rejects.toThrow("Preflight requires exactly the filing-retest mode");
      expect(existsSync(output)).toBe(false);
    } finally {
      rmSync(item.dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("backs up committed WAL data without opening or copying an arbitrary database", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "filing-wal-"));
    const source = path.join(dir, "fixture.db"), backup = path.join(dir, "backup.db");
    const script = `
import json, os, sqlite3, sys
source = sqlite3.connect(sys.argv[1])
source.execute("PRAGMA journal_mode=WAL")
source.execute("CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
source.execute("INSERT INTO evidence (value) VALUES ('committed-in-wal')")
source.commit()
reader = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
destination = sqlite3.connect(sys.argv[2])
reader.backup(destination)
rows = destination.execute("SELECT id, value FROM evidence ORDER BY id").fetchall()
result = {"walBytes": os.path.getsize(sys.argv[1] + "-wal"), "rows": rows}
destination.close(); reader.close(); source.close()
print(json.dumps(result))
`;
    try {
      const result = await execute("/usr/bin/python3", ["-c", script, source, backup]);
      const report = JSON.parse(result.stdout.trim()) as { walBytes: number; rows: [number, string][] };
      expect(report.walBytes).toBeGreaterThan(0);
      expect(report.rows).toEqual([[1, "committed-in-wal"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
