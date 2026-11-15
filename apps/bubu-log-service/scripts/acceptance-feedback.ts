import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PayloadRequest } from "payload";
import { enrichStoredMessageDisplayMetadata, type StoredMessage } from "../src/collector/service";
import { isSafeWechatAvatarUrl, sourceFingerprint } from "../src/collector/types";
import type { Principal } from "../src/identity";
import { hash } from "../src/records/persistence";
import type { CareEvent, EventInput, Field, SourceRef } from "../src/records/types";
import { createRuntime, type BubuRuntime } from "../src/runtime";
import { identityDirectory, operationsOrigin } from "../src/runtime-config";

const SCRIPT_KIND = "acceptance-feedback/v1";
const TEST_PREFIX = "[测试记录]";
const EXPECTED_TESTS = [
  { key: "bottle-formula-missing-amount", type: "BOTTLE", missing: "milkAmount" },
  { key: "sleep-ended-missing-duration", type: "SLEEP", missing: "durationMinutes" },
  { key: "breastfeed-ended-missing-duration", type: "BREASTFEED", missing: "durationMinutes" },
  { key: "outdoor-ended-missing-duration", type: "OUTDOOR", missing: "durationMinutes" },
] as const;

type TestKey = typeof EXPECTED_TESTS[number]["key"];
interface TestRecordSpec { key: TestKey; name: string; sentAt: string }
interface MaintenanceManifest {
  kind: typeof SCRIPT_KIND;
  babyId: string;
  operatorId: string;
  target: {
    eventId: string;
    expectedVersion: number;
    sourceId: string;
    sourceFingerprint: string;
    text: string;
    sentAt: string;
    accountId: string;
    groupId: string;
    chatId: string;
    messageId: string;
    eventKey: string;
    senderId: string;
  };
  profiles: Array<{ senderId: string; senderName: string; senderAvatarUrl: string }>;
  collector: { agentId: string };
  formulaEventKey: string;
  testChinaDate: string;
  testRecords: TestRecordSpec[];
  requests: {
    repairOriginal: string;
    createFormula: string;
    resolveFormulaDistinct: string;
    confirmFormulaOverlap: string;
    seedTests: string;
  };
}

interface StoredOperation {
  requestId: string;
  fingerprint: string;
  status: "pending" | "done" | "conflict";
  eventIds: string[];
}
interface Inspection {
  event: CareEvent;
  message: StoredMessage;
  profileMessages: StoredMessage[];
  binding: { babyId?: unknown; groupId?: unknown; agentId?: unknown; active?: unknown };
  operations: {
    repair?: StoredOperation;
    formula?: StoredOperation;
    tests?: StoredOperation;
  };
}
type MaintenanceRuntime = Pick<BubuRuntime, "store" | "identity" | "records">;
export interface AcceptanceFeedbackReceipt {
  kind: typeof SCRIPT_KIND;
  mode: "dry-run" | "executed";
  babyId: string;
  targetEventId: string;
  profileMessages: number;
  pair: Array<{ id: string; version: number; milkAmount: number; complete: boolean }>;
  tests: Array<{ id: string; name: string; missing: Field[] }>;
}

function fail(code: string, detail?: string): never {
  throw new Error(detail ? `${code}:${detail}` : code);
}
function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
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
function requestId(value: unknown, code: string): string {
  const result = text(value, code, 128);
  if (result.length < 8) fail(code);
  return result;
}
function chinaDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The manifest contains no credential or runtime path; those remain in the existing service environment. */
export function parseAcceptanceFeedbackManifest(value: unknown): MaintenanceManifest {
  const root = object(value, "INVALID_MANIFEST");
  if (root.kind !== SCRIPT_KIND) fail("INVALID_MANIFEST_KIND");
  const target = object(root.target, "INVALID_TARGET");
  const profiles = Array.isArray(root.profiles) ? root.profiles.map((entry, index) => {
    const profile = object(entry, `INVALID_PROFILE_${index}`);
    const senderAvatarUrl = text(profile.senderAvatarUrl, `INVALID_PROFILE_AVATAR_${index}`, 2048);
    if (!isSafeWechatAvatarUrl(senderAvatarUrl)) fail(`INVALID_PROFILE_AVATAR_${index}`);
    return {
      senderId: text(profile.senderId, `INVALID_PROFILE_SENDER_${index}`, 256),
      senderName: text(profile.senderName, `INVALID_PROFILE_NAME_${index}`, 200), senderAvatarUrl,
    };
  }) : fail("INVALID_PROFILES");
  if (profiles.length !== 3 || new Set(profiles.map(profile => profile.senderId)).size !== profiles.length) fail("PROFILE_SET_MISMATCH");
  const collector = object(root.collector, "INVALID_COLLECTOR");
  const requests = object(root.requests, "INVALID_REQUESTS");
  const tests = Array.isArray(root.testRecords) ? root.testRecords.map((entry, index) => {
    const item = object(entry, `INVALID_TEST_${index}`);
    return { key: text(item.key, `INVALID_TEST_KEY_${index}`) as TestKey, name: text(item.name, `INVALID_TEST_NAME_${index}`, 100), sentAt: timestamp(item.sentAt, `INVALID_TEST_TIME_${index}`) };
  }) : fail("INVALID_TEST_RECORDS");
  if (tests.length !== EXPECTED_TESTS.length || tests.some((item, index) => item.key !== EXPECTED_TESTS[index]!.key)) fail("TEST_RECORD_SET_MISMATCH");
  if (new Set(tests.map(item => item.sentAt)).size !== tests.length) fail("TEST_TIMES_NOT_UNIQUE");
  const testChinaDate = text(root.testChinaDate, "INVALID_TEST_CHINA_DATE", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testChinaDate) || tests.some(item => chinaDate(item.sentAt) !== testChinaDate)) fail("TEST_DATE_MISMATCH");
  const result: MaintenanceManifest = {
    kind: SCRIPT_KIND,
    babyId: text(root.babyId, "INVALID_BABY_ID", 200),
    operatorId: text(root.operatorId, "INVALID_OPERATOR_ID", 200),
    target: {
      eventId: text(target.eventId, "INVALID_EVENT_ID", 200),
      expectedVersion: Number(target.expectedVersion),
      sourceId: text(target.sourceId, "INVALID_SOURCE_ID", 256),
      sourceFingerprint: text(target.sourceFingerprint, "INVALID_SOURCE_FINGERPRINT", 64),
      text: text(target.text, "INVALID_SOURCE_TEXT", 200_000),
      sentAt: timestamp(target.sentAt, "INVALID_SOURCE_TIME"),
      accountId: text(target.accountId, "INVALID_SOURCE_ACCOUNT", 256),
      groupId: text(target.groupId, "INVALID_SOURCE_GROUP", 256),
      chatId: text(target.chatId, "INVALID_SOURCE_CHAT", 256),
      messageId: text(target.messageId, "INVALID_SOURCE_MESSAGE", 500),
      eventKey: text(target.eventKey, "INVALID_SOURCE_EVENT_KEY", 200),
      senderId: text(target.senderId, "INVALID_SOURCE_SENDER", 256),
    },
    profiles,
    collector: { agentId: text(collector.agentId, "INVALID_AGENT_ID", 200) },
    formulaEventKey: text(root.formulaEventKey, "INVALID_FORMULA_EVENT_KEY", 200),
    testChinaDate,
    testRecords: tests,
    requests: {
      repairOriginal: requestId(requests.repairOriginal, "INVALID_REPAIR_REQUEST"),
      createFormula: requestId(requests.createFormula, "INVALID_FORMULA_REQUEST"),
      resolveFormulaDistinct: requestId(requests.resolveFormulaDistinct, "INVALID_DISTINCT_REQUEST"),
      confirmFormulaOverlap: requestId(requests.confirmFormulaOverlap, "INVALID_OVERLAP_REQUEST"),
      seedTests: requestId(requests.seedTests, "INVALID_TEST_REQUEST"),
    },
  };
  if (!Number.isInteger(result.target.expectedVersion) || result.target.expectedVersion < 1) fail("INVALID_EXPECTED_VERSION");
  if (!/^[a-f0-9]{64}$/.test(result.target.sourceFingerprint)) fail("INVALID_SOURCE_FINGERPRINT");
  if (!result.profiles.some(profile => profile.senderId === result.target.senderId)) fail("TARGET_PROFILE_MISSING");
  if (new Set(Object.values(result.requests)).size !== Object.keys(result.requests).length) fail("REQUEST_IDS_NOT_UNIQUE");
  return result;
}

const sourceRef = (manifest: MaintenanceManifest, eventKey: string): SourceRef => ({
  kind: "wechat", accountId: manifest.target.accountId, conversationId: manifest.target.chatId,
  messageId: manifest.target.messageId, eventKey, sentAt: manifest.target.sentAt,
  senderId: manifest.target.senderId, groupId: manifest.target.groupId,
});
const repairInput = (manifest: MaintenanceManifest) => ({
  babyId: manifest.babyId, requestId: manifest.requests.repairOriginal, eventId: manifest.target.eventId,
  expectedVersion: manifest.target.expectedVersion,
  patch: {
    facts: { type: "BOTTLE" as const, startTime: manifest.target.sentAt, milkAmount: 200, milkDescription: "羊奶", notes: null },
    states: { type: "known" as const, startTime: "known" as const, milkAmount: "known" as const, milkDescription: "known" as const, notes: "unknown" as const },
    progress: "ended" as const,
    evidence: [{ field: "startTime" as const, kind: "default" as const, detail: "source sentAt used as completion timestamp", confirmed: true }],
  },
});
const formulaInput = (manifest: MaintenanceManifest) => ({
  babyId: manifest.babyId, requestId: manifest.requests.createFormula,
  events: [{
    facts: { type: "BOTTLE" as const, startTime: manifest.target.sentAt, milkSource: "FORMULA" as const, milkAmount: 70 },
    progress: "ended" as const,
    evidence: [{ field: "startTime" as const, kind: "default" as const, detail: "source sentAt used as completion timestamp", confirmed: true }],
    sources: [sourceRef(manifest, manifest.formulaEventKey)],
  }],
});
function testInputs(manifest: MaintenanceManifest): EventInput[] {
  return manifest.testRecords.map((spec, index) => {
    const expected = EXPECTED_TESTS[index]!;
    const notes = `${TEST_PREFIX} ${spec.name}；用于手机待补表单验收，不是真实微信记录。`;
    const source: SourceRef = {
      kind: "manual", accountId: `maintenance:${manifest.operatorId}`, conversationId: "acceptance-feedback",
      messageId: `acceptance-feedback:${spec.key}`, eventKey: spec.key, sentAt: spec.sentAt, senderId: manifest.operatorId,
    };
    if (expected.type === "BOTTLE") return {
      facts: { type: "BOTTLE", startTime: spec.sentAt, milkSource: "FORMULA", notes },
      states: { milkAmount: "pending" }, progress: "ended", sources: [source],
    };
    return {
      facts: { type: expected.type, endTime: spec.sentAt, notes },
      states: { durationMinutes: "pending" }, progress: "ended", sources: [source],
    };
  });
}
function operationKey(babyId: string, kind: "operator" | "collector", actorId: string, groupId: string, request: string) {
  return hash([babyId, kind, actorId, "", groupId, request]);
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
    const event = await runtime.records.repo.get<CareEvent>("care-events", manifest.babyId, manifest.target.eventId, request);
    if (!event) fail("TARGET_EVENT_NOT_FOUND");
    const message = await runtime.records.repo.get<StoredMessage>("care-messages", manifest.babyId, manifest.target.sourceId, request);
    if (!message?.source) fail("TARGET_SOURCE_NOT_FOUND");
    const messages = await runtime.records.repo.list<StoredMessage>("care-messages", manifest.babyId, request);
    const binding = await runtime.store.get("group-bindings", hashString(manifest.target.groupId));
    const repairKey = operationKey(manifest.babyId, "operator", manifest.operatorId, "", manifest.requests.repairOriginal);
    const formulaKey = operationKey(manifest.babyId, "collector", manifest.collector.agentId, manifest.target.groupId, manifest.requests.createFormula);
    const testsKey = operationKey(manifest.babyId, "operator", manifest.operatorId, "", manifest.requests.seedTests);
    return {
      event, message,
      profileMessages: messages.filter(item => item.source.accountId === manifest.target.accountId && item.source.groupId === manifest.target.groupId && manifest.profiles.some(profile => profile.senderId === item.source.senderId)),
      binding: (binding?.value || {}) as Inspection["binding"],
      operations: {
        repair: await runtime.records.repo.get<StoredOperation>("care-operations", manifest.babyId, repairKey, request),
        formula: await runtime.records.repo.get<StoredOperation>("care-operations", manifest.babyId, formulaKey, request),
        tests: await runtime.records.repo.get<StoredOperation>("care-operations", manifest.babyId, testsKey, request),
      },
    };
  });
}

function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
// IdentityService.digest is deliberately duplicated as a tiny pure helper so the
// maintenance entry cannot accidentally mint or authenticate during dry-run.
function assertOperation(operation: StoredOperation | undefined, expectedFingerprint: string, code: string) {
  if (operation && operation.fingerprint !== expectedFingerprint) fail(`${code}_IDEMPOTENCY_CONFLICT`);
}
function sameWechatRef(ref: SourceRef, manifest: MaintenanceManifest): boolean {
  return ref.kind === "wechat" && ref.accountId === manifest.target.accountId && ref.groupId === manifest.target.groupId && ref.conversationId === manifest.target.chatId &&
    ref.messageId === manifest.target.messageId && ref.eventKey === manifest.target.eventKey && ref.sentAt === manifest.target.sentAt && ref.senderId === manifest.target.senderId;
}
function repaired(event: CareEvent, manifest: MaintenanceManifest): boolean {
  return event.facts.type === "BOTTLE" && event.facts.startTime === new Date(manifest.target.sentAt).toISOString() && event.facts.milkAmount === 200 &&
    event.facts.milkDescription === "羊奶" && event.facts.notes == null;
}

async function preflight(runtime: MaintenanceRuntime, manifest: MaintenanceManifest): Promise<Inspection> {
  const state = await inspect(runtime, manifest);
  if (manifest.testRecords.some(spec => Date.parse(spec.sentAt) > runtime.identity.now() + 120_000)) fail("TEST_TIME_FUTURE");
  const source = state.message.source;
  if (state.event.babyId !== manifest.babyId || state.event.sources.length !== 1 || !sameWechatRef(state.event.sources[0]!, manifest)) fail("TARGET_EVENT_SOURCE_MISMATCH");
  if (source.sourceId !== manifest.target.sourceId || source.accountId !== manifest.target.accountId || source.groupId !== manifest.target.groupId || source.chatId !== manifest.target.chatId ||
      `${source.databaseId}/${source.tableName}/${source.localId}` !== manifest.target.messageId || source.senderId !== manifest.target.senderId || source.sentAt !== manifest.target.sentAt || source.text !== manifest.target.text) fail("TARGET_SOURCE_MISMATCH");
  if (hash(sourceFingerprint(source)) !== manifest.target.sourceFingerprint || state.message.contentHash !== manifest.target.sourceFingerprint) fail("TARGET_SOURCE_FINGERPRINT_MISMATCH");
  if (state.binding.active !== true || state.binding.babyId !== manifest.babyId || state.binding.groupId !== manifest.target.groupId || state.binding.agentId !== manifest.collector.agentId) fail("ACTIVE_BINDING_MISMATCH");
  if (!state.profileMessages.some(stored => stored.source.sourceId === manifest.target.sourceId)) fail("PROFILE_MESSAGES_NOT_FOUND");
  for (const profile of manifest.profiles) {
    const messages = state.profileMessages.filter(stored => stored.source.senderId === profile.senderId);
    if (!messages.length) fail("PROFILE_MESSAGES_NOT_FOUND", profile.senderId);
    for (const stored of messages) {
      if (hash(sourceFingerprint(stored.source)) !== stored.contentHash) fail("PROFILE_FINGERPRINT_MISMATCH");
      if (stored.source.senderName && stored.source.senderName !== profile.senderName) fail("PROFILE_NAME_CONFLICT");
      if (stored.source.senderAvatarUrl && stored.source.senderAvatarUrl !== profile.senderAvatarUrl) fail("PROFILE_AVATAR_CONFLICT");
    }
  }
  const repair = repairInput(manifest);
  assertOperation(state.operations.repair, hash({ tool: "update", ...repair }), "REPAIR");
  assertOperation(state.operations.formula, hash({ tool: "record", ...formulaInput(manifest) }), "FORMULA");
  assertOperation(state.operations.tests, hash({ tool: "record", babyId: manifest.babyId, requestId: manifest.requests.seedTests, events: testInputs(manifest) }), "TESTS");
  if (!state.operations.repair) {
    if (state.event.version !== manifest.target.expectedVersion || state.event.facts.milkAmount !== 270 || state.event.states.type !== "pending" || state.event.states.startTime !== "pending") fail("TARGET_EVENT_EXPECTATION_MISMATCH");
  } else if (state.event.version !== manifest.target.expectedVersion + 1 || !repaired(state.event, manifest)) fail("REPAIR_RESUME_STATE_MISMATCH");
  return state;
}

async function principal(runtime: MaintenanceRuntime, manifest: MaintenanceManifest): Promise<Principal> {
  const issued = await runtime.identity.provisionOperator(manifest.operatorId, manifest.babyId, 5 * 60_000);
  return runtime.identity.authenticate(issued.token, "bearer");
}

async function enrichProfile(runtime: MaintenanceRuntime, manifest: MaintenanceManifest): Promise<number> {
  return transaction(runtime, async request => {
    const messages = await runtime.records.repo.list<StoredMessage>("care-messages", manifest.babyId, request);
    const matches = messages.filter(item => item.source.accountId === manifest.target.accountId && item.source.groupId === manifest.target.groupId && manifest.profiles.some(profile => profile.senderId === item.source.senderId));
    if (!matches.length) fail("PROFILE_MESSAGES_NOT_FOUND");
    let changed = false;
    for (const stored of matches) {
      const profile = manifest.profiles.find(item => item.senderId === stored.source.senderId)!;
      const enriched = enrichStoredMessageDisplayMetadata(stored, { ...stored.source, senderName: profile.senderName, senderAvatarUrl: profile.senderAvatarUrl }, {
        at: new Date().toISOString(), actor: { kind: "operator", id: manifest.operatorId },
      });
      if (hash(sourceFingerprint(enriched.stored.source)) !== stored.contentHash || enriched.stored.contentHash !== stored.contentHash) fail("PROFILE_FINGERPRINT_CHANGED");
      if (enriched.changed) {
        await runtime.records.repo.put("care-messages", manifest.babyId, stored.source.sourceId, enriched.stored, request);
        changed = true;
      }
    }
    const auditId = `acceptance-feedback:profiles:${hash([manifest.babyId, manifest.target.accountId, manifest.target.groupId, manifest.profiles]).slice(0, 40)}`;
    const previousAudit = await runtime.store.get("audit", auditId);
    if (changed && previousAudit) fail("PROFILE_AUDIT_ALREADY_EXISTS");
    if (!previousAudit) await runtime.store.put("audit", auditId, {
        action: "source.metadata.update", actorId: manifest.operatorId, babyId: manifest.babyId,
        accountId: manifest.target.accountId, groupId: manifest.target.groupId, senderIds: manifest.profiles.map(profile => profile.senderId).sort(),
        messageIds: matches.map(item => item.source.sourceId).sort(), fields: ["senderName", "senderAvatarUrl"],
        requestId: manifest.requests.repairOriginal, at: new Date().toISOString(),
      });
    return matches.length;
  });
}

async function resolveExplicitPair(runtime: MaintenanceRuntime, manifest: MaintenanceManifest, operator: Principal, formula: CareEvent): Promise<CareEvent> {
  let current = formula;
  if (current.duplicateCandidates.length) {
    if (current.duplicateCandidates.length !== 1 || current.duplicateCandidates[0] !== manifest.target.eventId) fail("UNEXPECTED_FORMULA_DUPLICATE");
    const receipt = await runtime.records.resolveDuplicate(operator, {
      babyId: manifest.babyId, requestId: manifest.requests.resolveFormulaDistinct, eventId: current.id,
      expectedVersion: current.version, resolution: "distinct",
    });
    current = receipt.events.find(event => event.id === current.id) || fail("FORMULA_EVENT_MISSING_AFTER_DISTINCT");
  }
  if (current.conflicts.length) {
    const related = [...new Set(current.conflicts.map(issue => issue.relatedEventId).filter(Boolean))];
    if (related.length !== 1 || related[0] !== manifest.target.eventId || current.conflicts.some(issue => issue.code !== "TIME_OVERLAP")) fail("UNEXPECTED_FORMULA_CONFLICT");
    const receipt = await runtime.records.confirmOverlap(operator, {
      babyId: manifest.babyId, requestId: manifest.requests.confirmFormulaOverlap, eventId: current.id,
      expectedVersion: current.version, conflictingEventIds: [manifest.target.eventId], reason: "同一条原消息明确列出羊奶200ml和奶粉70ml两项",
    });
    current = receipt.events.find(event => event.id === current.id) || fail("FORMULA_EVENT_MISSING_AFTER_OVERLAP");
  }
  return current;
}

async function verify(runtime: MaintenanceRuntime, manifest: MaintenanceManifest, operator: Principal, profileMessages: number): Promise<AcceptanceFeedbackReceipt> {
  const query = await runtime.records.query(operator, { babyId: manifest.babyId, includeRetracted: true });
  const target = query.events.find(event => event.id === manifest.target.eventId) || fail("TARGET_EVENT_MISSING_AFTER_EXECUTE");
  const sameMessage = query.events.filter(event => event.sources.some(ref => ref.kind === "wechat" && ref.accountId === manifest.target.accountId && ref.groupId === manifest.target.groupId && ref.conversationId === manifest.target.chatId && ref.messageId === manifest.target.messageId));
  if (sameMessage.length !== 2 || sameMessage.some(event => event.facts.milkAmount === 270)) fail("PAIR_CARDINALITY_MISMATCH");
  const pair = sameMessage.sort((left, right) => Number(right.facts.milkAmount) - Number(left.facts.milkAmount));
  if (pair[0]?.id !== target.id || pair[0]?.facts.milkAmount !== 200 || pair[0]?.facts.milkDescription !== "羊奶" || pair[1]?.facts.milkAmount !== 70 || pair[1]?.facts.milkSource !== "FORMULA") fail("PAIR_FACTS_MISMATCH");
  if (pair.some(event => !event.complete || event.missing.length || event.conflicts.length || event.duplicateCandidates.length || event.facts.startTime !== new Date(manifest.target.sentAt).toISOString())) fail("PAIR_NOT_COMPLETE");
  const testEvents = query.events.filter(event => event.sources.some(ref => ref.kind === "manual" && ref.conversationId === "acceptance-feedback"));
  if (testEvents.length !== 4) fail("TEST_EVENT_CARDINALITY_MISMATCH");
  const tests = manifest.testRecords.map((spec, index) => {
    const event = testEvents.find(item => item.sources.some(ref => ref.messageId === `acceptance-feedback:${spec.key}`)) || fail("TEST_EVENT_MISSING", spec.key);
    const missing = EXPECTED_TESTS[index]!.missing;
    if (event.complete || event.missing.length !== 1 || event.missing[0] !== missing || event.facts.notes?.startsWith(TEST_PREFIX) !== true) fail("TEST_EVENT_SHAPE_MISMATCH", spec.key);
    return { id: event.id, name: spec.name, missing: event.missing };
  });
  return {
    kind: SCRIPT_KIND, mode: "executed", babyId: manifest.babyId, targetEventId: target.id, profileMessages,
    pair: pair.map(event => ({ id: event.id, version: event.version, milkAmount: event.facts.milkAmount!, complete: event.complete })), tests,
  };
}

/**
 * Archived 2026-11-15. This implementation split one bottle meal into separate
 * milk-kind events and must never be invoked by the public maintenance entry.
 */
export async function archivedRunAcceptanceFeedback(runtime: MaintenanceRuntime, manifestInput: MaintenanceManifest | unknown, options: { execute?: boolean; onMutation?: () => void } = {}): Promise<AcceptanceFeedbackReceipt> {
  const manifest = parseAcceptanceFeedbackManifest(manifestInput);
  const state = await preflight(runtime, manifest);
  if (!options.execute) return {
    kind: SCRIPT_KIND, mode: "dry-run", babyId: manifest.babyId, targetEventId: manifest.target.eventId,
    profileMessages: state.profileMessages.length, pair: [],
    tests: manifest.testRecords.map((spec, index) => ({ id: "pending", name: spec.name, missing: [EXPECTED_TESTS[index]!.missing] })),
  };
  const operator = await principal(runtime, manifest);
  options.onMutation?.();
  const repairedReceipt = await runtime.records.update(operator, repairInput(manifest));
  const repairedEvent = repairedReceipt.events.find(event => event.id === manifest.target.eventId) || fail("REPAIR_EVENT_MISSING");
  if (!repaired(repairedEvent, manifest)) fail("REPAIR_RESULT_MISMATCH");
  const collectorIssued = await runtime.identity.issueAgent(operator, manifest.babyId, "collector", { groupId: manifest.target.groupId, agentId: manifest.collector.agentId });
  const collector = await runtime.identity.authenticate(collectorIssued.token, "bearer");
  const formulaReceipt = await runtime.records.record(collector, formulaInput(manifest));
  const formulaInitial = formulaReceipt.events.find(event => event.id !== manifest.target.eventId) || formulaReceipt.events[0] || fail("FORMULA_EVENT_MISSING");
  await resolveExplicitPair(runtime, manifest, operator, formulaInitial);
  await runtime.records.record(operator, { babyId: manifest.babyId, requestId: manifest.requests.seedTests, events: testInputs(manifest) });
  const profileMessages = await enrichProfile(runtime, manifest);
  return verify(runtime, manifest, operator, profileMessages);
}

export async function runAcceptanceFeedback(runtime: MaintenanceRuntime, manifestInput: MaintenanceManifest | unknown, options: { execute?: boolean; onMutation?: () => void } = {}): Promise<AcceptanceFeedbackReceipt> {
  void runtime; void manifestInput; void options;
  return fail("ACCEPTANCE_FEEDBACK_RETIRED_ONE_MEAL_MODEL");
}

function argumentsFrom(argv: string[]) {
  let manifest = ""; let execute = false;
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
export async function archivedAcceptanceFeedbackMain() {
  const args = argumentsFrom(process.argv.slice(2));
  const manifest = parseAcceptanceFeedbackManifest(JSON.parse(await readFile(args.manifest, "utf8")));
  const publicOrigin = process.env.BUBU_PUBLIC_ORIGIN || "http://127.0.0.1:3320";
  const port = Number(process.env.PORT || 3320);
  const runtime = await createRuntime({
    directory: identityDirectory(), secret: process.env.BUBU_PAYLOAD_SECRET,
    publicOrigin, opsOrigin: operationsOrigin(), mcpUrl: `http://127.0.0.1:${port}/api/mcp`,
    maintenanceWorker: false,
  });
  let mutationStarted = false;
  try {
    const receipt = await runAcceptanceFeedback(runtime, manifest, { execute: args.execute, onMutation: () => { mutationStarted = true; } });
    console.log(JSON.stringify(receipt));
  } catch (error) {
    const code = error instanceof Error ? error.message : "MAINTENANCE_FAILED";
    console.error(JSON.stringify({ ok: false, code, mutationStarted, automaticRollback: false }));
    process.exitCode = 1;
  } finally { await runtime.close(); }
}

export async function runAcceptanceFeedbackCli(_argv = process.argv.slice(2)): Promise<never> {
  void _argv;
  return fail("ACCEPTANCE_FEEDBACK_RETIRED_ONE_MEAL_MODEL");
}

async function main() {
  try { await runAcceptanceFeedbackCli(); }
  catch (error) {
    const code = error instanceof Error ? error.message : "ACCEPTANCE_FEEDBACK_RETIRED_ONE_MEAL_MODEL";
    console.error(JSON.stringify({ ok: false, code, mutationStarted: false, automaticRollback: false }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
