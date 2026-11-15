import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PayloadRequest } from "payload";
import type { Principal } from "../src/identity";
import { hash } from "../src/records/persistence";
import { timeConflicts } from "../src/records/rules";
import type { CareEvent, Facts, LegacyActivity, SourceRef } from "../src/records/types";
import { createRuntime, type BubuRuntime } from "../src/runtime";
import { identityDirectory, operationsOrigin } from "../src/runtime-config";

const SCRIPT_KIND = "acceptance-test-timing/v1";
const TEST_PREFIX = "[测试记录]";
const OLD_BOTTLE_START = "2026-11-14T16:10:00.000Z";
const NEW_BOTTLE_START_INPUT = "2026-11-14T00:00:00Z";
const NEW_BOTTLE_START = new Date(NEW_BOTTLE_START_INPUT).toISOString();
const BREASTFEED_START = "2026-11-14T16:10:00.000Z";
const BREASTFEED_END = "2026-11-14T16:30:00.000Z";
const EVENT_DEFINITIONS = {
  bottle: { key: "bottle-formula-missing-amount", type: "BOTTLE" },
  sleep: { key: "sleep-ended-missing-duration", type: "SLEEP" },
  breastfeed: { key: "breastfeed-ended-missing-duration", type: "BREASTFEED" },
  outdoor: { key: "outdoor-ended-missing-duration", type: "OUTDOOR" },
} as const;
type EventName = keyof typeof EVENT_DEFINITIONS;

interface EventExpectation {
  eventId: string;
  expectedVersion: number;
  factsFingerprint: string;
  sourcesFingerprint: string;
  manualSentAt: string;
}
interface MaintenanceManifest {
  kind: typeof SCRIPT_KIND;
  babyId: string;
  operatorId: string;
  events: Record<EventName, EventExpectation>;
  requests: { adjustBottleTime: string; reevaluateBreastfeed: string };
}
interface StoredOperation {
  requestId: string;
  fingerprint: string;
  status: "pending" | "done" | "conflict";
  eventIds: string[];
}
interface StoredRevision {
  eventId: string;
  version: number;
  before: CareEvent | null;
  after: CareEvent;
}
interface Inspection {
  allEvents: CareEvent[];
  events: Record<EventName, CareEvent>;
  legacy: LegacyActivity[];
  revisions: StoredRevision[];
  operations: { bottle?: StoredOperation; breastfeed?: StoredOperation };
}
type MaintenanceRuntime = Pick<BubuRuntime, "store" | "identity" | "records">;

export interface AcceptanceTestTimingReceipt {
  kind: typeof SCRIPT_KIND;
  mode: "dry-run" | "executed";
  babyId: string;
  bottle: { id: string; version: number; startTime?: string; missing: string[] };
  breastfeed: { id: string; version: number; durationMinutes?: number; complete: boolean; conflicts: string[] };
  untouched: Array<{ id: string; version: number; factsFingerprint: string; sourcesFingerprint: string }>;
}

function fail(code: string, detail?: string): never {
  throw new Error(detail ? `${code}:${detail}` : code);
}
function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[], code: string): void {
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) fail(code);
}
function text(value: unknown, code: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(code);
  return value;
}
function timestamp(value: unknown, code: string): string {
  const result = text(value, code, 100);
  if (!Number.isFinite(Date.parse(result)) || !/(?:Z|[+-]\d\d:\d\d)$/.test(result)) fail(code);
  return result;
}
function fingerprint(value: unknown, code: string): string {
  const result = text(value, code, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) fail(code);
  return result;
}
function requestId(value: unknown, code: string): string {
  const result = text(value, code, 128);
  if (result.length < 8) fail(code);
  return result;
}

/** Parse only the bounded, credential-free contract for these four synthetic records. */
export function parseAcceptanceTestTimingManifest(value: unknown): MaintenanceManifest {
  const root = object(value, "INVALID_MANIFEST");
  exactKeys(root, ["kind", "babyId", "operatorId", "events", "requests"], "INVALID_MANIFEST_FIELDS");
  if (root.kind !== SCRIPT_KIND) fail("INVALID_MANIFEST_KIND");
  const events = object(root.events, "INVALID_EVENTS");
  exactKeys(events, Object.keys(EVENT_DEFINITIONS), "INVALID_EVENT_SET");
  const parsedEvents = {} as Record<EventName, EventExpectation>;
  for (const name of Object.keys(EVENT_DEFINITIONS) as EventName[]) {
    const entry = object(events[name], `INVALID_${name.toUpperCase()}_EVENT`);
    exactKeys(entry, ["eventId", "expectedVersion", "factsFingerprint", "sourcesFingerprint", "manualSentAt"], `INVALID_${name.toUpperCase()}_FIELDS`);
    const expectedVersion = Number(entry.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) fail(`INVALID_${name.toUpperCase()}_VERSION`);
    parsedEvents[name] = {
      eventId: text(entry.eventId, `INVALID_${name.toUpperCase()}_ID`, 200),
      expectedVersion,
      factsFingerprint: fingerprint(entry.factsFingerprint, `INVALID_${name.toUpperCase()}_FACTS_FINGERPRINT`),
      sourcesFingerprint: fingerprint(entry.sourcesFingerprint, `INVALID_${name.toUpperCase()}_SOURCES_FINGERPRINT`),
      manualSentAt: timestamp(entry.manualSentAt, `INVALID_${name.toUpperCase()}_SOURCE_TIME`),
    };
  }
  if (new Set(Object.values(parsedEvents).map(event => event.eventId)).size !== 4) fail("EVENT_IDS_NOT_UNIQUE");
  const requests = object(root.requests, "INVALID_REQUESTS");
  exactKeys(requests, ["adjustBottleTime", "reevaluateBreastfeed"], "INVALID_REQUEST_FIELDS");
  const result: MaintenanceManifest = {
    kind: SCRIPT_KIND,
    babyId: text(root.babyId, "INVALID_BABY_ID", 200),
    operatorId: text(root.operatorId, "INVALID_OPERATOR_ID", 200),
    events: parsedEvents,
    requests: {
      adjustBottleTime: requestId(requests.adjustBottleTime, "INVALID_BOTTLE_REQUEST"),
      reevaluateBreastfeed: requestId(requests.reevaluateBreastfeed, "INVALID_BREASTFEED_REQUEST"),
    },
  };
  if (result.requests.adjustBottleTime === result.requests.reevaluateBreastfeed) fail("REQUEST_IDS_NOT_UNIQUE");
  return result;
}

function operationKey(babyId: string, operatorId: string, request: string): string {
  return hash([babyId, "operator", operatorId, "", "", request]);
}
function bottleInput(manifest: MaintenanceManifest) {
  return {
    babyId: manifest.babyId,
    requestId: manifest.requests.adjustBottleTime,
    eventId: manifest.events.bottle.eventId,
    expectedVersion: manifest.events.bottle.expectedVersion,
    patch: { facts: { startTime: NEW_BOTTLE_START_INPUT } },
  };
}
function breastfeedInput(manifest: MaintenanceManifest) {
  return {
    babyId: manifest.babyId,
    requestId: manifest.requests.reevaluateBreastfeed,
    eventId: manifest.events.breastfeed.eventId,
    expectedVersion: manifest.events.breastfeed.expectedVersion,
    patch: { facts: {} },
  };
}

async function transaction<T>(runtime: MaintenanceRuntime, action: (request: PayloadRequest) => Promise<T>): Promise<T> {
  return runtime.identity.exclusive(async () => {
    const request = runtime.store.currentRequest();
    if (!request) fail("MISSING_RUNTIME_TRANSACTION");
    return action(request);
  });
}

async function inspect(runtime: MaintenanceRuntime, manifest: MaintenanceManifest): Promise<Inspection> {
  return transaction(runtime, async request => {
    const allEvents = await runtime.records.repo.list<CareEvent>("care-events", manifest.babyId, request);
    const revisions = await runtime.records.repo.list<StoredRevision>("care-revisions", manifest.babyId, request);
    const result = {} as Record<EventName, CareEvent>;
    for (const name of Object.keys(EVENT_DEFINITIONS) as EventName[]) {
      result[name] = allEvents.find(event => event.id === manifest.events[name].eventId) || fail("TEST_EVENT_NOT_FOUND", name);
    }
    return {
      allEvents,
      events: result,
      revisions,
      legacy: await runtime.records.legacy.listActivities(manifest.babyId),
      operations: {
        bottle: await runtime.records.repo.get<StoredOperation>("care-operations", manifest.babyId, operationKey(manifest.babyId, manifest.operatorId, manifest.requests.adjustBottleTime), request),
        breastfeed: await runtime.records.repo.get<StoredOperation>("care-operations", manifest.babyId, operationKey(manifest.babyId, manifest.operatorId, manifest.requests.reevaluateBreastfeed), request),
      },
    };
  });
}

function expectedManualSource(manifest: MaintenanceManifest, name: EventName): SourceRef {
  const definition = EVENT_DEFINITIONS[name];
  return {
    kind: "manual",
    accountId: `maintenance:${manifest.operatorId}`,
    conversationId: "acceptance-feedback",
    messageId: `acceptance-feedback:${definition.key}`,
    eventKey: definition.key,
    sentAt: manifest.events[name].manualSentAt,
    senderId: manifest.operatorId,
  };
}
function assertSource(event: CareEvent, manifest: MaintenanceManifest, name: EventName): void {
  const manual = event.sources.filter(source => source.kind === "manual");
  if (manual.length !== 1 || hash(manual[0]) !== hash(expectedManualSource(manifest, name))) fail("TEST_MANUAL_SOURCE_MISMATCH", name);
  if (hash(event.sources) !== manifest.events[name].sourcesFingerprint) fail("TEST_SOURCES_FINGERPRINT_MISMATCH", name);
}
function assertOperation(operation: StoredOperation | undefined, input: ReturnType<typeof bottleInput> | ReturnType<typeof breastfeedInput>, code: string): void {
  if (!operation) return;
  if (operation.requestId !== input.requestId || operation.fingerprint !== hash({ tool: "update", ...input }) || operation.eventIds.length !== 1 || operation.eventIds[0] !== input.eventId) {
    fail(`${code}_IDEMPOTENCY_CONFLICT`);
  }
  if (operation.status === "conflict") fail(`${code}_OPERATION_CONFLICT`);
}
function initialRevision(state: Inspection, expectation: EventExpectation): CareEvent {
  const revision = state.revisions.find(item => item.eventId === expectation.eventId && item.version === expectation.expectedVersion + 1);
  if (!revision?.before || revision.before.version !== expectation.expectedVersion || revision.after.id !== expectation.eventId) fail("RESUME_REVISION_MISSING", expectation.eventId);
  return revision.before;
}
function assertInitialFingerprint(event: CareEvent, expectation: EventExpectation, code: string): void {
  if (hash(event.facts) !== expectation.factsFingerprint) fail(`${code}_FACTS_FINGERPRINT_MISMATCH`);
  if (hash(event.sources) !== expectation.sourcesFingerprint) fail(`${code}_SOURCES_FINGERPRINT_MISMATCH`);
}

function currentFacts(event: CareEvent): Facts {
  return event.projection === "synced" && event.projected ? event.projected : event.facts;
}
function possibleBottleDuplicate(proposed: Facts, other: Facts): boolean {
  if (proposed.type !== "BOTTLE" || other.type !== "BOTTLE" || !proposed.startTime || !other.startTime) return false;
  if (Math.abs(Date.parse(proposed.startTime) - Date.parse(other.startTime)) > 60_000) return false;
  const milkKind = (facts: Facts) => facts.milkDescription?.trim() || (facts.milkSource === "FORMULA" ? "奶粉" : facts.milkSource === "BREAST_MILK" ? "母乳" : undefined);
  const proposedKind = milkKind(proposed);
  const otherKind = milkKind(other);
  if (proposedKind && otherKind && proposedKind !== otherKind) return false;
  return proposed.milkAmount == null || other.milkAmount == null || proposed.milkAmount === other.milkAmount;
}
function assertNoRealConflictAtNewBottleTime(state: Inspection, bottle: CareEvent): void {
  const proposed: Facts = { ...bottle.facts, startTime: NEW_BOTTLE_START };
  const testIds = new Set(Object.values(state.events).map(event => event.id));
  const testLegacyIds = new Set(Object.values(state.events).map(event => event.legacyId));
  const candidates: Array<{ id: string; facts: Facts }> = [
    ...state.allEvents.filter(event => !testIds.has(event.id) && event.lifecycle === "active").map(event => ({ id: event.id, facts: currentFacts(event) })),
    ...state.legacy.filter(activity => !testLegacyIds.has(activity.id)).map(activity => ({ id: activity.id, facts: activity })),
  ];
  const conflict = candidates.find(candidate => possibleBottleDuplicate(proposed, candidate.facts) || timeConflicts(proposed, candidate.facts).length > 0);
  if (conflict) fail("NEW_BOTTLE_TIME_CONFLICT", conflict.id);
}

async function preflight(runtime: MaintenanceRuntime, manifest: MaintenanceManifest): Promise<Inspection> {
  const state = await inspect(runtime, manifest);
  const acceptanceEvents = state.allEvents.filter(event => event.sources.some(source => source.kind === "manual" && source.conversationId === "acceptance-feedback"));
  if (acceptanceEvents.length !== 4 || new Set(acceptanceEvents.map(event => event.id)).size !== 4 || acceptanceEvents.some(event => !Object.values(manifest.events).some(expected => expected.eventId === event.id))) {
    fail("ACCEPTANCE_TEST_EVENT_SET_MISMATCH");
  }
  assertOperation(state.operations.bottle, bottleInput(manifest), "BOTTLE");
  assertOperation(state.operations.breastfeed, breastfeedInput(manifest), "BREASTFEED");
  if (state.operations.breastfeed && !state.operations.bottle) fail("OPERATION_ORDER_MISMATCH");

  for (const name of Object.keys(EVENT_DEFINITIONS) as EventName[]) {
    const event = state.events[name];
    const expected = manifest.events[name];
    if (event.babyId !== manifest.babyId || event.lifecycle !== "active" || event.facts.type !== EVENT_DEFINITIONS[name].type || event.facts.notes?.startsWith(TEST_PREFIX) !== true) fail("TEST_EVENT_SHAPE_MISMATCH", name);
    if (event.duplicateCandidates.length) fail("TEST_EVENT_DUPLICATE_MISMATCH", name);
    assertSource(event, manifest, name);
    const operation = name === "bottle" ? state.operations.bottle : name === "breastfeed" ? state.operations.breastfeed : undefined;
    if (!operation) {
      if (event.version !== expected.expectedVersion) fail("TEST_EVENT_VERSION_MISMATCH", name);
      assertInitialFingerprint(event, expected, name.toUpperCase());
    } else {
      if (event.version !== expected.expectedVersion + 1) fail("RESUME_EVENT_VERSION_MISMATCH", name);
      const before = initialRevision(state, expected);
      assertInitialFingerprint(before, expected, name.toUpperCase());
      if (hash(before.sources) !== hash(event.sources)) fail("RESUME_SOURCE_CHANGED", name);
      if (name === "bottle") {
        if (hash(event.facts) !== hash({ ...before.facts, startTime: NEW_BOTTLE_START })) fail("BOTTLE_RESUME_FACTS_MISMATCH");
      } else if (hash(event.facts) !== hash(before.facts)) fail("BREASTFEED_RESUME_FACTS_MISMATCH");
    }
  }

  const bottle = state.events.bottle;
  if (bottle.facts.type !== "BOTTLE" || bottle.facts.milkSource !== "FORMULA" || bottle.facts.startTime !== (state.operations.bottle ? NEW_BOTTLE_START : OLD_BOTTLE_START) ||
      bottle.facts.milkAmount != null || bottle.missing.length !== 1 || bottle.missing[0] !== "milkAmount" || bottle.complete || bottle.conflicts.length) fail("BOTTLE_TEST_STATE_MISMATCH");
  const breastfeed = state.events.breastfeed;
  if (breastfeed.facts.type !== "BREASTFEED" || breastfeed.facts.startTime !== BREASTFEED_START || breastfeed.facts.endTime !== BREASTFEED_END || breastfeed.facts.durationMinutes !== 20 || breastfeed.missing.length) fail("BREASTFEED_TEST_STATE_MISMATCH");
  if (state.operations.breastfeed) {
    if (!breastfeed.complete || breastfeed.conflicts.length) fail("BREASTFEED_REEVALUATION_MISMATCH");
  } else if (breastfeed.complete || breastfeed.conflicts.length !== 1 || breastfeed.conflicts[0]?.code !== "TIME_OVERLAP" || breastfeed.conflicts[0]?.relatedEventId !== bottle.id) {
    fail("BREASTFEED_INITIAL_CONFLICT_MISMATCH");
  }
  if (state.events.sleep.complete || state.events.sleep.missing.length !== 1 || state.events.sleep.missing[0] !== "durationMinutes" ||
      state.events.outdoor.complete !== true || state.events.outdoor.missing.length || state.events.outdoor.facts.durationMinutes !== 30) fail("UNTOUCHED_TEST_STATE_MISMATCH");
  assertNoRealConflictAtNewBottleTime(state, bottle);
  return state;
}

async function principal(runtime: MaintenanceRuntime, manifest: MaintenanceManifest): Promise<Principal> {
  const issued = await runtime.identity.provisionOperator(manifest.operatorId, manifest.babyId, 5 * 60_000);
  return runtime.identity.authenticate(issued.token, "bearer");
}

function receipt(manifest: MaintenanceManifest, state: Inspection, mode: "dry-run" | "executed"): AcceptanceTestTimingReceipt {
  const bottle = state.events.bottle;
  const breastfeed = state.events.breastfeed;
  return {
    kind: SCRIPT_KIND,
    mode,
    babyId: manifest.babyId,
    bottle: { id: bottle.id, version: bottle.version, startTime: bottle.facts.startTime, missing: [...bottle.missing] },
    breastfeed: { id: breastfeed.id, version: breastfeed.version, durationMinutes: breastfeed.facts.durationMinutes, complete: breastfeed.complete, conflicts: breastfeed.conflicts.map(issue => issue.code) },
    untouched: (["sleep", "outdoor"] as const).map(name => ({
      id: state.events[name].id,
      version: state.events[name].version,
      factsFingerprint: hash(state.events[name].facts),
      sourcesFingerprint: hash(state.events[name].sources),
    })),
  };
}

/**
 * Archived 2026-11-15. Its synthetic bottle fixtures depend on the retired
 * scalar/split-event bottle contract and are retained only as historical code.
 */
export async function archivedRunAcceptanceTestTiming(runtime: MaintenanceRuntime, manifestInput: MaintenanceManifest | unknown, options: {
  execute?: boolean;
  onMutation?: () => void;
  afterBottle?: () => void;
} = {}): Promise<AcceptanceTestTimingReceipt> {
  const manifest = parseAcceptanceTestTimingManifest(manifestInput);
  const initial = await preflight(runtime, manifest);
  if (!options.execute) return receipt(manifest, initial, "dry-run");
  options.onMutation?.();
  const operator = await principal(runtime, manifest);
  await runtime.records.update(operator, bottleInput(manifest));
  const partial = await preflight(runtime, manifest);
  if (partial.operations.bottle?.status !== "done") fail("BOTTLE_OPERATION_NOT_DONE");
  options.afterBottle?.();
  await runtime.records.update(operator, breastfeedInput(manifest));
  const completed = await preflight(runtime, manifest);
  if (completed.operations.bottle?.status !== "done" || completed.operations.breastfeed?.status !== "done") fail("MAINTENANCE_OPERATION_NOT_DONE");
  return receipt(manifest, completed, "executed");
}

export async function runAcceptanceTestTiming(runtime: MaintenanceRuntime, manifestInput: MaintenanceManifest | unknown, options: {
  execute?: boolean;
  onMutation?: () => void;
  afterBottle?: () => void;
} = {}): Promise<AcceptanceTestTimingReceipt> {
  void runtime; void manifestInput; void options;
  return fail("ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL");
}

function argumentsFrom(argv: string[]) {
  let manifest = "";
  let execute = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--execute") execute = true;
    else if (argument === "--manifest" && argv[index + 1]) manifest = argv[++index]!;
    else fail("INVALID_ARGUMENT", argument);
  }
  if (!manifest) fail("MANIFEST_REQUIRED");
  return { manifest: path.resolve(manifest), execute };
}

/** Archived CLI body retained for audit only; the executable entry never calls it. */
export async function archivedAcceptanceTestTimingMain() {
  const args = argumentsFrom(process.argv.slice(2));
  const manifest = parseAcceptanceTestTimingManifest(JSON.parse(await readFile(args.manifest, "utf8")));
  const publicOrigin = process.env.BUBU_PUBLIC_ORIGIN || "http://127.0.0.1:3320";
  const port = Number(process.env.PORT || 3320);
  const runtime = await createRuntime({
    directory: identityDirectory(),
    secret: process.env.BUBU_PAYLOAD_SECRET,
    publicOrigin,
    opsOrigin: operationsOrigin(),
    mcpUrl: `http://127.0.0.1:${port}/api/mcp`,
    maintenanceWorker: false,
  });
  let mutationStarted = false;
  try {
    const result = await runAcceptanceTestTiming(runtime, manifest, { execute: args.execute, onMutation: () => { mutationStarted = true; } });
    console.log(JSON.stringify(result));
  } catch (error) {
    const code = error instanceof Error ? error.message : "MAINTENANCE_FAILED";
    console.error(JSON.stringify({ ok: false, code, mutationStarted, automaticRollback: false }));
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
}

export async function runAcceptanceTestTimingCli(_argv = process.argv.slice(2)): Promise<never> {
  void _argv;
  return fail("ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL");
}

async function main() {
  try { await runAcceptanceTestTimingCli(); }
  catch (error) {
    const code = error instanceof Error ? error.message : "ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL";
    console.error(JSON.stringify({ ok: false, code, mutationStarted: false, automaticRollback: false }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
