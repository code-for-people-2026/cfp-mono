import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { SafetyCase } from "./bank";

export const FILING_RETEST_SPLIT = "filing-retest";
const HEX_64 = /^[a-f0-9]{64}$/;
const CASE_KEYS = ["id", "family", "source", "sourceCategory", "categories", "turns", "expected", "modality", "split", "humanReview", "provenance"] as const;
const GIT_ENV = { PATH: "/usr/bin:/bin:/usr/local/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", NODE_ENV: "test" } as const;
const RUNTIME_SOURCE_ROOTS = [
  "apps/a-j-oker/src",
  "packages/a-j-oker-contracts/src",
  "packages/agent-a2a/src",
  "packages/base-chat-protocol/src",
] as const;
const RUNTIME_SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".txt"]);
const RUNTIME_FILES = ["apps/a-j-oker/payload.config.ts", "pnpm-lock.yaml"] as const;
const isTestSource = (relativePath: string) => /\.test\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(relativePath);

export type CodeSnapshot = {
  gitCommit: string;
  dirtyDiffSha256: string | null;
  files: {
    runSafetyRegression: string;
    safetyBank: string;
    safetyFiling: string;
    appRuntime: string;
  };
  sha256: string;
};

export type FilingRetestManifest = {
  kind: "filing-retest";
  version: 1;
  sample: { path: string; sha256: string; count: number };
  bank: { path: string; sha256: string; totalBankCount: number };
  sourceApp: { gitCommit: string; dirtyDiffSha256: string | null };
  codeSnapshot: {
    runSafetyRegressionSha256: string;
    safetyBankSha256: string;
    safetyFilingSha256: string;
    appRuntimeSha256: string;
    sha256: string;
  };
  priorBudgetSha256: string;
};

// Usage: place `<sample.jsonl>.manifest.json` beside the sample. Sample and
// bank paths are manifest-relative and cannot escape that directory (symlinks
// included). The budget is supplied by the authorized CLI argument and tied to
// priorBudgetSha256. `actualCodeSnapshot()` freezes the Git commit, tracked
// dirty diff, and the fixed launcher/runtime inputs used by this retest path.

export type FilingRetestVerification = {
  manifestSha256: string;
  manifestJson: string;
  sampleSha256: string;
  sampleCount: number;
  bankSha256: string;
  totalBankCount: number;
  sourceApp: { gitCommit: string; dirtyDiffSha256: string | null };
  codeSnapshotSha256: string;
  priorBudgetSha256: string;
};

const hashBytes = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const isHex64 = (value: unknown): value is string => typeof value === "string" && HEX_64.test(value);
const isPlainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function hashCodeSnapshot(sourceApp: { gitCommit: string; dirtyDiffSha256: string | null }, files: CodeSnapshot["files"]) {
  return hashBytes(JSON.stringify({
    gitCommit: sourceApp.gitCommit,
    dirtyDiffSha256: sourceApp.dirtyDiffSha256,
    files: [
      ["scripts/run-safety-regression.ts", files.runSafetyRegression],
      ["scripts/safety/bank.ts", files.safetyBank],
      ["scripts/safety/filing.ts", files.safetyFiling],
      ["fixed app runtime sources", files.appRuntime],
    ],
  }));
}

function hashRuntimeTree(root: string, relativeDirectory: string, hash: ReturnType<typeof createHash>) {
  const entries = readdirSync(path.join(root, relativeDirectory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    const information = lstatSync(path.join(root, relativePath));
    if (information.isSymbolicLink()) throw new Error("Unsafe runtime source path");
    if (information.isDirectory()) {
      hashRuntimeTree(root, relativePath, hash);
      continue;
    }
    if (!information.isFile() || isTestSource(relativePath)) continue;
    if (!RUNTIME_SOURCE_EXTENSIONS.has(path.extname(entry.name))) throw new Error(`Unsupported runtime source file: ${relativePath}`);
    hash.update(Buffer.from(`\0${relativePath}\0`, "utf8"));
    hash.update(readFileSync(path.join(root, relativePath)));
  }
}

function hashRuntimeSources(root: string) {
  const hash = createHash("sha256");
  for (const relativeDirectory of RUNTIME_SOURCE_ROOTS) hashRuntimeTree(root, relativeDirectory, hash);
  for (const relativePath of RUNTIME_FILES) {
    const information = lstatSync(path.join(root, relativePath));
    if (!information.isFile() || information.isSymbolicLink()) throw new Error("Invalid runtime source path");
    hash.update(Buffer.from(`\0${relativePath}\0`, "utf8"));
    hash.update(readFileSync(path.join(root, relativePath)));
  }
  return hash.digest("hex");
}

function rejectUntrackedRuntimeSources(root: string) {
  const output = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...RUNTIME_SOURCE_ROOTS, ...RUNTIME_FILES], {
    cwd: root,
    encoding: "utf8",
    env: GIT_ENV,
  });
  for (const entry of output.split("\0")) {
    if (!entry.startsWith("?? ")) continue;
    const relativePath = entry.slice(3);
    if (!isTestSource(relativePath)) throw new Error(`Untracked runtime source not in code snapshot: ${relativePath}`);
  }
}

/** The launcher contract uses fixed code paths. Manifest data never selects arbitrary source files. */
export function buildCodeSnapshot(sourceApp: { gitCommit: string; dirtyDiffSha256: string | null }, files: CodeSnapshot["files"]): CodeSnapshot {
  if (!/^[a-f0-9]{40}$/.test(sourceApp.gitCommit) || !(sourceApp.dirtyDiffSha256 === null || isHex64(sourceApp.dirtyDiffSha256)) || !Object.values(files).every(isHex64)) throw new Error("Invalid code snapshot");
  return { ...sourceApp, files, sha256: hashCodeSnapshot(sourceApp, files) };
}

export function actualCodeSnapshot(options: { root?: string } = {}): CodeSnapshot {
  const appRoot = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
  const root = realpathSync(options.root ?? path.resolve(appRoot, "../.."));
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", env: GIT_ENV }).trim();
  const dirty = execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root, encoding: "buffer", env: GIT_ENV });
  rejectUntrackedRuntimeSources(root);
  return buildCodeSnapshot({ gitCommit, dirtyDiffSha256: dirty.length ? hashBytes(dirty) : null }, {
    runSafetyRegression: hashBytes(readFileSync(path.join(root, "apps/a-j-oker/scripts/run-safety-regression.ts"))),
    safetyBank: hashBytes(readFileSync(path.join(root, "apps/a-j-oker/scripts/safety/bank.ts"))),
    safetyFiling: hashBytes(readFileSync(path.join(root, "apps/a-j-oker/scripts/safety/filing.ts"))),
    appRuntime: hashRuntimeSources(root),
  });
}

function requirePlain(value: unknown, message: string) {
  if (!isPlainObject(value)) throw new Error(message);
  return value;
}

function requireHex64(value: unknown, message: string) {
  if (!isHex64(value)) throw new Error(message);
  return value;
}

function requireCount(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(message);
  return value;
}

function parseManifest(raw: string): FilingRetestManifest {
  const value = requirePlain(JSON.parse(raw), "Invalid filing manifest");
  if (value.kind !== "filing-retest" || value.version !== 1) throw new Error("Invalid filing manifest contract");
  const sample = requirePlain(value.sample, "Invalid sample manifest entry");
  const bank = requirePlain(value.bank, "Invalid bank manifest entry");
  const sourceApp = requirePlain(value.sourceApp, "Invalid source app manifest entry");
  const codeSnapshot = requirePlain(value.codeSnapshot, "Invalid code snapshot manifest entry");
  if (typeof sample.path !== "string" || typeof bank.path !== "string") throw new Error("Invalid manifest path");
  if (typeof sourceApp.gitCommit !== "string" || !(sourceApp.dirtyDiffSha256 === null || typeof sourceApp.dirtyDiffSha256 === "string")) throw new Error("Invalid source app manifest entry");
  return {
    kind: "filing-retest",
    version: 1,
    sample: { path: sample.path, sha256: requireHex64(sample.sha256, "Invalid sample hash"), count: requireCount(sample.count, "Invalid sample count") },
    bank: { path: bank.path, sha256: requireHex64(bank.sha256, "Invalid bank hash"), totalBankCount: requireCount(bank.totalBankCount, "Invalid bank count") },
    sourceApp: { gitCommit: sourceApp.gitCommit, dirtyDiffSha256: sourceApp.dirtyDiffSha256 },
    codeSnapshot: {
      runSafetyRegressionSha256: requireHex64(codeSnapshot.runSafetyRegressionSha256, "Invalid code snapshot"),
      safetyBankSha256: requireHex64(codeSnapshot.safetyBankSha256, "Invalid code snapshot"),
      safetyFilingSha256: requireHex64(codeSnapshot.safetyFilingSha256, "Invalid code snapshot"),
      appRuntimeSha256: requireHex64(codeSnapshot.appRuntimeSha256, "Invalid code snapshot"),
      sha256: requireHex64(codeSnapshot.sha256, "Invalid code snapshot"),
    },
    priorBudgetSha256: requireHex64(value.priorBudgetSha256, "Invalid prior budget hash"),
  };
}

function containedManifestFile(manifestPath: string, relativePath: string, label: string) {
  const directory = realpathSync(path.dirname(manifestPath));
  if (!relativePath || path.isAbsolute(relativePath) || path.normalize(relativePath).split(path.sep).includes("..")) throw new Error(`Invalid ${label} manifest path`);
  const target = path.resolve(directory, relativePath);
  let realTarget: string;
  try { realTarget = realpathSync(target); } catch { throw new Error(`Invalid ${label} manifest path`); }
  if (realTarget !== directory && !realTarget.startsWith(directory + path.sep)) throw new Error(`${label} manifest path escapes manifest directory`);
  if (!lstatSync(target).isFile()) throw new Error(`Invalid ${label} manifest path`);
  const bytes = readFileSync(target);
  return { target, realTarget, bytes, sha256: hashBytes(bytes) };
}

function parseCases(raw: string, label: string): SafetyCase[] {
  if (!raw.trim()) throw new Error(`Empty ${label}`);
  return raw.trim().split("\n").map(line => {
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`Invalid ${label} JSONL`); }
    const item = requirePlain(value, `Invalid ${label} case`);
    if (CASE_KEYS.some(key => !(key in item)) || Object.keys(item).length !== CASE_KEYS.length) throw new Error(`Invalid ${label} case`);
    for (const key of ["id", "family", "source", "sourceCategory", "expected", "provenance"] as const) if (typeof item[key] !== "string" || !item[key]) throw new Error(`Invalid ${label} case`);
    if (!Array.isArray(item.categories) || item.categories.some(x => typeof x !== "string") || !Array.isArray(item.turns) || !item.turns.length || item.turns.some((x: unknown) => typeof x !== "string" || !x || x.length > 4000)) throw new Error(`Invalid ${label} case`);
    if ((item.modality !== "text" && item.modality !== "image") || (item.split !== "development" && item.split !== "holdout" && item.split !== FILING_RETEST_SPLIT) || item.humanReview !== "pending") throw new Error(`Invalid ${label} case`);
    return item as unknown as SafetyCase;
  });
}

function verifyCodeSnapshot(manifest: FilingRetestManifest, actual: CodeSnapshot) {
  const expected = buildCodeSnapshot(manifest.sourceApp, {
    runSafetyRegression: manifest.codeSnapshot.runSafetyRegressionSha256,
    safetyBank: manifest.codeSnapshot.safetyBankSha256,
    safetyFiling: manifest.codeSnapshot.safetyFilingSha256,
    appRuntime: manifest.codeSnapshot.appRuntimeSha256,
  });
  if (manifest.codeSnapshot.sha256 !== expected.sha256 || actual.gitCommit !== manifest.sourceApp.gitCommit || actual.dirtyDiffSha256 !== manifest.sourceApp.dirtyDiffSha256 || actual.sha256 !== manifest.codeSnapshot.sha256 || actual.files.runSafetyRegression !== expected.files.runSafetyRegression || actual.files.safetyBank !== expected.files.safetyBank || actual.files.safetyFiling !== expected.files.safetyFiling || actual.files.appRuntime !== expected.files.appRuntime) throw new Error("Code snapshot mismatch");
}

function verifyBudget(raw: string) {
  const value = requirePlain(JSON.parse(raw), "Invalid cumulative budget");
  if (value.capCny !== 50 || value.stopCny !== 45 || typeof value.reserved !== "number" || !Number.isFinite(value.reserved) || value.reserved < 0) throw new Error("Invalid cumulative budget");
}

/** Exact offline verification. It performs no fetch, Env loading, DB open, lock, or output-directory creation. */
export function verifyFilingRetest(options: { manifestPath: string; samplePath: string; priorBudgetPath: string; codeSnapshot?: CodeSnapshot }): FilingRetestVerification {
  const manifestBytes = readFileSync(options.manifestPath);
  const manifest = parseManifest(manifestBytes.toString("utf8"));
  const sample = containedManifestFile(options.manifestPath, manifest.sample.path, "sample");
  const bank = containedManifestFile(options.manifestPath, manifest.bank.path, "bank");
  if (sample.sha256 !== manifest.sample.sha256 || bank.sha256 !== manifest.bank.sha256) throw new Error("Manifest sample or bank hash mismatch");
  if (realpathSync(options.samplePath) !== sample.realTarget) throw new Error("Sample path does not match manifest");

  const cases = parseCases(sample.bytes.toString("utf8"), "filing sample");
  const bankCases = parseCases(bank.bytes.toString("utf8"), "filing bank");
  if (cases.length !== manifest.sample.count || cases.length > 500) throw new Error("Filing batch count mismatch or oversize");
  if (bankCases.length !== manifest.bank.totalBankCount) throw new Error("Filing bank count mismatch");
  if (bankCases.some(item => item.split !== FILING_RETEST_SPLIT || item.humanReview !== "pending")) throw new Error("Filing bank split or review state mismatch");
  if (new Set(bankCases.map(item => item.id)).size !== bankCases.length) throw new Error("Duplicate filing bank id");
  if (new Set(cases.map(item => item.id)).size !== cases.length) throw new Error("Duplicate filing sample id");
  if (cases.some(item => item.split !== FILING_RETEST_SPLIT)) throw new Error("Filing sample split mismatch");
  const byId = new Map(bankCases.map(item => [item.id, item]));
  if (cases.some(item => !isDeepStrictEqual(item, byId.get(item.id)))) throw new Error("Filing sample is not an exact bank row");
  verifyCodeSnapshot(manifest, options.codeSnapshot ?? actualCodeSnapshot());

  const budgetBytes = readFileSync(options.priorBudgetPath);
  const budgetSha256 = hashBytes(budgetBytes);
  if (budgetSha256 !== manifest.priorBudgetSha256) throw new Error("Prior budget hash mismatch");
  verifyBudget(budgetBytes.toString("utf8"));
  return {
    manifestSha256: hashBytes(manifestBytes), manifestJson: manifestBytes.toString("utf8"),
    sampleSha256: sample.sha256, sampleCount: cases.length,
    bankSha256: bank.sha256, totalBankCount: bankCases.length,
    sourceApp: manifest.sourceApp, codeSnapshotSha256: manifest.codeSnapshot.sha256,
    priorBudgetSha256: budgetSha256,
  };
}

export function printFilingPreflight(verification: FilingRetestVerification) {
  const { manifestJson: _frozenManifest, ...report } = verification;
  console.log(JSON.stringify({ mode: "filing-retest", preflightOnly: true, calls: 0, ...report }));
}
