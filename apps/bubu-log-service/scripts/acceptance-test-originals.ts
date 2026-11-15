import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PayloadRequest } from "payload";
import type { StoredMessage } from "../src/collector/service";
import { sourceFingerprint, type SourceMessage } from "../src/collector/types";
import { hash } from "../src/records/persistence";
import type { CareEvent, SourceRef } from "../src/records/types";
import { createRuntime, type BubuRuntime } from "../src/runtime";
import { identityDirectory, operationsOrigin } from "../src/runtime-config";

const SCRIPT_KIND = "acceptance-test-originals/v1";
const TEST_PREFIX = "[测试记录]";
const AUDIT_ACTION = "maintenance.acceptance-test-originals";
const EVENT_DEFINITIONS = {
  bottle: { key: "bottle-formula-missing-amount", type: "BOTTLE", messageCount: 2 },
  sleep: { key: "sleep-ended-missing-duration", type: "SLEEP", messageCount: 1 },
  breastfeed: { key: "breastfeed-ended-missing-duration", type: "BREASTFEED", messageCount: 1 },
  outdoor: { key: "outdoor-ended-missing-duration", type: "OUTDOOR", messageCount: 1 },
} as const;
type EventName = keyof typeof EVENT_DEFINITIONS;

interface MessageBody { senderName: string; sentAt: string; text: string }
interface EventExpectation {
  eventId: string;
  expectedVersion: number;
  eventFingerprint: string;
  messages: MessageBody[];
}
export interface AcceptanceTestOriginalsManifest {
  kind: typeof SCRIPT_KIND;
  babyId: string;
  operatorId: string;
  events: Record<EventName, EventExpectation>;
}
interface MaintenanceAudit {
  action: typeof AUDIT_ACTION;
  actorKind: "operator";
  actorId: string;
  babyId: string;
  operationFingerprint: string;
  eventIds: string[];
  sourceIds: string[];
  at: string;
}
type MaintenanceRuntime = Pick<BubuRuntime, "store" | "identity" | "records">;

export interface AcceptanceTestOriginalsReceipt {
  kind: typeof SCRIPT_KIND;
  mode: "dry-run" | "executed" | "noop";
  babyId: string;
  operationFingerprint: string;
  eventIds: string[];
  sourceIds: string[];
}

function fail(code: string, detail?: string): never { throw new Error(detail ? `${code}:${detail}` : code); }
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

/** Strict, credential-free input. Raw simulated words occur only in message bodies. */
export function parseAcceptanceTestOriginalsManifest(value: unknown): AcceptanceTestOriginalsManifest {
  const root = object(value, "INVALID_MANIFEST");
  exactKeys(root, ["kind", "babyId", "operatorId", "events"], "INVALID_MANIFEST_FIELDS");
  if (root.kind !== SCRIPT_KIND) fail("INVALID_MANIFEST_KIND");
  const rawEvents = object(root.events, "INVALID_EVENTS");
  exactKeys(rawEvents, Object.keys(EVENT_DEFINITIONS), "INVALID_EVENT_SET");
  const events = {} as Record<EventName, EventExpectation>;
  for (const name of Object.keys(EVENT_DEFINITIONS) as EventName[]) {
    const raw = object(rawEvents[name], `INVALID_${name.toUpperCase()}_EVENT`);
    exactKeys(raw, ["eventId", "expectedVersion", "eventFingerprint", "messages"], `INVALID_${name.toUpperCase()}_FIELDS`);
    if (!Number.isInteger(raw.expectedVersion) || Number(raw.expectedVersion) < 1) fail(`INVALID_${name.toUpperCase()}_VERSION`);
    if (!Array.isArray(raw.messages) || raw.messages.length !== EVENT_DEFINITIONS[name].messageCount) fail(`INVALID_${name.toUpperCase()}_MESSAGES`);
    const messages = raw.messages.map((value, index) => {
      const message = object(value, `INVALID_${name.toUpperCase()}_MESSAGE`);
      exactKeys(message, ["senderName", "sentAt", "text"], `INVALID_${name.toUpperCase()}_MESSAGE_FIELDS`);
      const senderName = text(message.senderName, `INVALID_${name.toUpperCase()}_SENDER`, 40);
      if (!senderName.endsWith("（测试）")) fail(`INVALID_${name.toUpperCase()}_SENDER`);
      return { senderName, sentAt: timestamp(message.sentAt, `INVALID_${name.toUpperCase()}_MESSAGE_TIME_${index}`), text: text(message.text, `INVALID_${name.toUpperCase()}_MESSAGE_TEXT_${index}`, 300) };
    });
    events[name] = {
      eventId: text(raw.eventId, `INVALID_${name.toUpperCase()}_ID`, 200),
      expectedVersion: Number(raw.expectedVersion),
      eventFingerprint: fingerprint(raw.eventFingerprint, `INVALID_${name.toUpperCase()}_FINGERPRINT`),
      messages,
    };
  }
  if (new Set(Object.values(events).map(event => event.eventId)).size !== 4) fail("EVENT_IDS_NOT_UNIQUE");
  return {
    kind: SCRIPT_KIND,
    babyId: text(root.babyId, "INVALID_BABY_ID", 200),
    operatorId: text(root.operatorId, "INVALID_OPERATOR_ID", 200),
    events,
  };
}

function actualManualRef(event: CareEvent, manifest: AcceptanceTestOriginalsManifest, name: EventName): SourceRef {
  const definition = EVENT_DEFINITIONS[name];
  const matches = event.sources.filter(source => source.kind === "manual" && source.conversationId === "acceptance-feedback");
  if (matches.length !== 1) fail("TEST_MANUAL_SOURCE_MISMATCH", name);
  const source = matches[0]!;
  if (source.accountId !== `maintenance:${manifest.operatorId}` || source.messageId !== `acceptance-feedback:${definition.key}` || source.eventKey !== definition.key ||
      source.senderId !== manifest.operatorId || source.groupId !== undefined || source.mediaIds !== undefined || source.collectedAt !== undefined) {
    fail("TEST_MANUAL_SOURCE_MISMATCH", name);
  }
  return source;
}

function assertFixtureState(event: CareEvent, manifest: AcceptanceTestOriginalsManifest, name: EventName): SourceRef {
  const expected = manifest.events[name];
  if (event.id !== expected.eventId || event.babyId !== manifest.babyId || event.version !== expected.expectedVersion ||
      hash(event) !== expected.eventFingerprint || event.lifecycle !== "active" || event.facts.type !== EVENT_DEFINITIONS[name].type ||
      event.facts.notes?.startsWith(TEST_PREFIX) !== true) fail("TEST_EVENT_EXPECTATION_MISMATCH", name);
  const manualRef = actualManualRef(event, manifest, name);
  if (name === "bottle") {
    if (event.facts.startTime !== new Date(expected.messages[0]!.sentAt).toISOString() || event.facts.milkSource !== "FORMULA" ||
        event.facts.milkAmount != null || event.missing.length !== 1 || event.missing[0] !== "milkAmount" || event.complete ||
        Date.parse(expected.messages[1]!.sentAt) - Date.parse(expected.messages[0]!.sentAt) !== 60_000) fail("BOTTLE_TEST_STATE_MISMATCH");
  } else {
    if (event.facts.endTime !== new Date(expected.messages[0]!.sentAt).toISOString()) fail(`${name.toUpperCase()}_MESSAGE_TIME_MISMATCH`);
    if (name === "sleep" && (event.missing.length !== 1 || event.missing[0] !== "durationMinutes" || event.complete)) fail("SLEEP_TEST_STATE_MISMATCH");
    if (name === "breastfeed" && (event.facts.durationMinutes !== 20 || event.missing.length || !event.complete)) fail("BREASTFEED_TEST_STATE_MISMATCH");
    if (name === "outdoor" && (event.facts.durationMinutes !== 30 || event.missing.length || !event.complete)) fail("OUTDOOR_TEST_STATE_MISMATCH");
  }
  return manualRef;
}

function sourceFor(manifest: AcceptanceTestOriginalsManifest, name: EventName, manualRef: SourceRef, body: MessageBody, index: number, operationFingerprint: string): StoredMessage {
  const sourceId = `acceptance-test:${hash([manifest.babyId, manifest.events[name].eventId, manualRef, index]).slice(0, 48)}`;
  const source: SourceMessage = {
    sourceId,
    accountId: "acceptance-test",
    groupId: "acceptance-test:fixture",
    chatId: "acceptance-feedback@test",
    databaseId: "test/acceptance-originals",
    tableName: "SyntheticMessage",
    localId: 1 + (Object.keys(EVENT_DEFINITIONS).indexOf(name) * 10) + index,
    sentAt: body.sentAt,
    senderId: `acceptance-test:${name}:${index}`,
    senderName: body.senderName,
    kind: "text",
    text: body.text,
    media: [],
  };
  const contentHash = hash(sourceFingerprint(source));
  return {
    source,
    contentHash,
    state: "processed",
    batchId: `acceptance-test-originals:${operationFingerprint}`,
    acceptanceSource: { kind: "acceptance-test-original/v1", eventId: manifest.events[name].eventId, manualRef, operationFingerprint, sourceHash: contentHash },
  };
}

function auditKey(babyId: string): string { return `acceptance-test-originals:${hash([babyId, SCRIPT_KIND]).slice(0, 48)}`; }
function comparableAudit(value: MaintenanceAudit) {
  return { action: value.action, actorKind: value.actorKind, actorId: value.actorId, babyId: value.babyId,
    operationFingerprint: value.operationFingerprint, eventIds: value.eventIds, sourceIds: value.sourceIds };
}
function expectedExpired(stored: StoredMessage): StoredMessage { return { ...stored, privacyExpired: true, source: { ...stored.source, text: "" } }; }

async function transaction<T>(runtime: MaintenanceRuntime, action: (request: PayloadRequest) => Promise<T>): Promise<T> {
  return runtime.identity.exclusive(async () => {
    const request = runtime.store.currentRequest();
    if (!request) fail("MISSING_RUNTIME_TRANSACTION");
    return action(request);
  });
}

export async function runAcceptanceTestOriginals(runtime: MaintenanceRuntime, input: AcceptanceTestOriginalsManifest | unknown, options: { execute?: boolean; onMutation?: () => void } = {}): Promise<AcceptanceTestOriginalsReceipt> {
  const manifest = parseAcceptanceTestOriginalsManifest(input);
  const operationFingerprint = hash(manifest);
  return transaction(runtime, async request => {
    const allEvents = await runtime.records.repo.list<CareEvent>("care-events", manifest.babyId, request);
    const marked = allEvents.filter(event => event.sources.some(source => source.kind === "manual" && source.conversationId === "acceptance-feedback"));
    if (marked.length !== 4 || marked.some(event => !Object.values(manifest.events).some(expected => expected.eventId === event.id))) fail("ACCEPTANCE_TEST_EVENT_SET_MISMATCH");
    const manualRefs = {} as Record<EventName, SourceRef>;
    for (const name of Object.keys(EVENT_DEFINITIONS) as EventName[]) {
      const event = allEvents.find(candidate => candidate.id === manifest.events[name].eventId) || fail("TEST_EVENT_NOT_FOUND", name);
      manualRefs[name] = assertFixtureState(event, manifest, name);
    }
    const expectedMessages = (Object.keys(EVENT_DEFINITIONS) as EventName[]).flatMap(name =>
      manifest.events[name].messages.map((body, index) => sourceFor(manifest, name, manualRefs[name], body, index, operationFingerprint)));
    const eventIds = (Object.keys(EVENT_DEFINITIONS) as EventName[]).map(name => manifest.events[name].eventId);
    const sourceIds = expectedMessages.map(message => message.source.sourceId);
    const existingMessages = await runtime.records.repo.list<StoredMessage>("care-messages", manifest.babyId, request);
    const audit = (await runtime.store.get("audit", auditKey(manifest.babyId)))?.value as MaintenanceAudit | undefined;
    const expectedAudit = { action: AUDIT_ACTION, actorKind: "operator" as const, actorId: manifest.operatorId, babyId: manifest.babyId, operationFingerprint, eventIds, sourceIds };

    if (audit) {
      if (hash(comparableAudit(audit)) !== hash(expectedAudit)) fail("OPERATION_FINGERPRINT_MISMATCH");
      for (const expected of expectedMessages) {
        const existing = existingMessages.find(message => message.source.sourceId === expected.source.sourceId) || fail("ORIGINAL_EVIDENCE_MISSING", expected.source.sourceId);
        const valid = hash(existing) === hash(expected) || hash(existing) === hash(expectedExpired(expected));
        if (!valid) fail("ORIGINAL_EVIDENCE_CHANGED", expected.source.sourceId);
      }
      return { kind: SCRIPT_KIND, mode: options.execute ? "noop" : "dry-run", babyId: manifest.babyId, operationFingerprint, eventIds, sourceIds };
    }
    if (existingMessages.some(message => message.acceptanceSource?.kind === "acceptance-test-original/v1" || sourceIds.includes(message.source.sourceId))) fail("PARTIAL_ORIGINAL_EVIDENCE");
    if (!options.execute) return { kind: SCRIPT_KIND, mode: "dry-run", babyId: manifest.babyId, operationFingerprint, eventIds, sourceIds };

    options.onMutation?.();
    for (const message of expectedMessages) await runtime.records.repo.put("care-messages", manifest.babyId, message.source.sourceId, message, request);
    await runtime.store.put("audit", auditKey(manifest.babyId), { ...expectedAudit, at: new Date(runtime.identity.now()).toISOString() });
    return { kind: SCRIPT_KIND, mode: "executed", babyId: manifest.babyId, operationFingerprint, eventIds, sourceIds };
  });
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

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const manifest = parseAcceptanceTestOriginalsManifest(JSON.parse(await readFile(args.manifest, "utf8")));
  const publicOrigin = process.env.BUBU_PUBLIC_ORIGIN || "http://127.0.0.1:3320";
  const port = Number(process.env.PORT || 3320);
  const runtime = await createRuntime({
    directory: identityDirectory(), secret: process.env.BUBU_PAYLOAD_SECRET, publicOrigin,
    opsOrigin: operationsOrigin(), mcpUrl: `http://127.0.0.1:${port}/api/mcp`, maintenanceWorker: false,
  });
  let mutationStarted = false;
  try {
    console.log(JSON.stringify(await runAcceptanceTestOriginals(runtime, manifest, { execute: args.execute, onMutation: () => { mutationStarted = true; } })));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error instanceof Error ? error.message : "MAINTENANCE_FAILED", mutationStarted, automaticRollback: true }));
    process.exitCode = 1;
  } finally { await runtime.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
