import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

export const AJ_A2A_FAULT_OWNER =
  "synthetic-inline-form-qa:586572e1-f398-4208-b620-17555b4f82dd";
export const AJ_A2A_FAULT_CONTROL_ENV = "AJ_A2A_FAULT_CONTROL_FILE";
const FAULT_CONTROL_ROOT = "/tmp/aj-recovery-qa";
const DEFAULT_FAULT_CONTROL_FILE = `${FAULT_CONTROL_ROOT}/a2a-fault-control.json`;

export interface A2AFaultModes {
  rejectFirstTwoExpertSubmissions: boolean;
  failFirstSendBeforeExecution: boolean;
  failFirstModelAttempt: boolean;
  loseFirstResponseAfterCommit: boolean;
}

export interface A2AFaultPolicy extends A2AFaultModes {
  enabled: boolean;
  owner: string;
}

export const DISABLED_A2A_FAULTS: A2AFaultPolicy = {
  enabled: false,
  owner: AJ_A2A_FAULT_OWNER,
  rejectFirstTwoExpertSubmissions: false,
  failFirstSendBeforeExecution: false,
  failFirstModelAttempt: false,
  loseFirstResponseAfterCommit: false,
};

type FaultFile = {
  schemaVersion: 1;
  owner: string;
  modes: A2AFaultModes;
};

function bool(value: unknown): boolean {
  return value === true;
}

function parseFaultFile(value: string): FaultFile {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid A2A fault control file");
  const record = parsed as Record<string, unknown>;
  const modes = record.modes;
  if (
    record.schemaVersion !== 1
    || record.owner !== AJ_A2A_FAULT_OWNER
    || !modes
    || typeof modes !== "object"
  ) {
    throw new Error("Invalid A2A fault control file");
  }
  const modeRecord = modes as Record<string, unknown>;
  return {
    schemaVersion: 1,
    owner: record.owner,
    modes: {
      rejectFirstTwoExpertSubmissions: bool(modeRecord.rejectFirstTwoExpertSubmissions),
      failFirstSendBeforeExecution: bool(modeRecord.failFirstSendBeforeExecution),
      failFirstModelAttempt: bool(modeRecord.failFirstModelAttempt),
      loseFirstResponseAfterCommit: bool(modeRecord.loseFirstResponseAfterCommit),
    },
  };
}

function isCompletedA2AWireTask(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const task = value as {
    id?: unknown;
    contextId?: unknown;
    status?: { state?: unknown };
  };
  return typeof task.id === "string"
    && task.id.length > 0
    && typeof task.contextId === "string"
    && task.contextId.length > 0
    && task.status?.state === "TASK_STATE_COMPLETED";
}

/** Confirms a JSON-RPC send response actually carries a durable completed task. */
export async function isConfirmedCompletedA2AResponse(
  response: Response,
): Promise<boolean> {
  if (!response.ok || !response.body) return false;
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return false;
  }
  try {
    const parsed: unknown = await response.clone().json();
    if (!parsed || typeof parsed !== "object" || !("result" in parsed)) return false;
    const result = (parsed as { result?: unknown }).result;
    return !!result
      && typeof result === "object"
      && "task" in result
      && isCompletedA2AWireTask((result as { task?: unknown }).task);
  } catch {
    return false;
  }
}

/**
 * Loads a narrowly scoped local QA fixture. There is no model-facing trigger:
 * production is always disabled and only the exact synthetic Repository owner
 * can consume an owner-readable file below /tmp/aj-recovery-qa.
 */
export async function loadA2AFaultPolicy(input: {
  owner: string;
  env?: Record<string, string | undefined>;
  controlFile?: string;
}): Promise<A2AFaultPolicy> {
  const env = input.env ?? process.env;
  if (env.HELLO_DEPLOYED === "true" || env.NODE_ENV === "production") {
    return DISABLED_A2A_FAULTS;
  }
  const controlFile = input.controlFile ?? env[AJ_A2A_FAULT_CONTROL_ENV] ?? DEFAULT_FAULT_CONTROL_FILE;
  if (!controlFile || input.owner !== AJ_A2A_FAULT_OWNER) return DISABLED_A2A_FAULTS;
  const resolved = path.resolve(controlFile);
  const relative = path.relative(FAULT_CONTROL_ROOT, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("A2A fault control file is outside the local QA scope");
  }
  let fileStat;
  let parentStat;
  try {
    [fileStat, parentStat] = await Promise.all([
      lstat(resolved),
      lstat(path.dirname(resolved)),
    ]);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return DISABLED_A2A_FAULTS;
    }
    throw error;
  }
  if (!fileStat.isFile() || (fileStat.mode & 0o077) !== 0) {
    throw new Error("A2A fault control file must be owner-only");
  }
  if (!parentStat.isDirectory() || (parentStat.mode & 0o077) !== 0) {
    throw new Error("A2A fault control directory must be owner-only");
  }
  const parsed = parseFaultFile(await readFile(resolved, "utf8"));
  const modes = parsed.modes;
  return {
    enabled: modes.rejectFirstTwoExpertSubmissions
      || modes.failFirstSendBeforeExecution
      || modes.failFirstModelAttempt
      || modes.loseFirstResponseAfterCommit,
    owner: parsed.owner,
    ...modes,
  };
}
