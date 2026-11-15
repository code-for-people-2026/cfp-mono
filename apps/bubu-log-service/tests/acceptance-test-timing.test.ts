import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { hash, recordTables } from "../src/records/persistence";
import { evaluateEvent } from "../src/records/rules";
import type { CareEvent, EventInput, SourceRef } from "../src/records/types";
import { runAcceptanceTestTiming } from "../scripts/acceptance-test-timing";
import { recordsFixture, type RecordsFixture } from "./fixtures/records";

const babyId = "baby-a";
const operatorId = "phone-feedback-20261115";
const createdAt = "2026-11-14T17:03:26.000Z";
const definitions = {
  bottle: { id: "bubu-synthetic-timing-bottle", key: "bottle-formula-missing-amount", sentAt: "2026-11-15T00:10:00+08:00", version: 1 },
  sleep: { id: "bubu-synthetic-timing-sleep", key: "sleep-ended-missing-duration", sentAt: "2026-11-15T00:20:00+08:00", version: 1 },
  breastfeed: { id: "bubu-synthetic-timing-breastfeed", key: "breastfeed-ended-missing-duration", sentAt: "2026-11-15T00:30:00+08:00", version: 2 },
  outdoor: { id: "bubu-synthetic-timing-outdoor", key: "outdoor-ended-missing-duration", sentAt: "2026-11-15T00:40:00+08:00", version: 2 },
} as const;

function manualSource(name: keyof typeof definitions): SourceRef {
  const definition = definitions[name];
  return {
    kind: "manual",
    accountId: `maintenance:${operatorId}`,
    conversationId: "acceptance-feedback",
    messageId: `acceptance-feedback:${definition.key}`,
    eventKey: definition.key,
    sentAt: definition.sentAt,
    senderId: operatorId,
  };
}
function chatSource(name: "breastfeed" | "outdoor"): SourceRef {
  return {
    kind: "chat",
    accountId: "caregiver-synthetic",
    conversationId: "chat_synthetic_timing",
    messageId: `turn_${name}`,
    eventKey: `answer:question:${definitions[name].id}`,
    sentAt: name === "breastfeed" ? "2026-11-14T17:07:56.797Z" : "2026-11-14T17:07:49.390Z",
    senderId: "caregiver-synthetic",
  };
}
function event(name: keyof typeof definitions, input: EventInput, sources: SourceRef[]): CareEvent {
  const definition = definitions[name];
  const evaluated = evaluateEvent(input, { now: Date.parse("2026-11-15T04:00:00.000Z") });
  return {
    id: definition.id,
    legacyId: definition.id,
    babyId,
    version: definition.version,
    ...evaluated,
    lifecycle: "active",
    duplicateCandidates: [],
    sources,
    attachmentIds: [],
    actor: { kind: "operator", id: operatorId, sessionId: "synthetic-session" },
    projection: "candidate",
    projected: null,
    createdAt,
    updatedAt: createdAt,
  };
}
function syntheticEvents(): Record<keyof typeof definitions, CareEvent> {
  const bottle = event("bottle", {
    facts: { type: "BOTTLE", startTime: "2026-11-14T16:10:00.000Z", milkSource: "FORMULA", notes: "[测试记录] 奶粉已喝完，补奶量；不是真实微信记录。" },
    states: { milkAmount: "pending" },
    progress: "ended",
  }, [manualSource("bottle")]);
  const sleep = event("sleep", {
    facts: { type: "SLEEP", endTime: "2026-11-14T16:20:00.000Z", notes: "[测试记录] 睡眠结束，补睡眠时长；不是真实微信记录。" },
    states: { durationMinutes: "pending" },
    progress: "ended",
  }, [manualSource("sleep")]);
  const breastfeed = event("breastfeed", {
    facts: { type: "BREASTFEED", endTime: "2026-11-14T16:30:00.000Z", durationMinutes: 20, notes: "[测试记录] 亲喂结束，用户已补20分钟；不是真实微信记录。" },
    progress: "ended",
  }, [manualSource("breastfeed"), chatSource("breastfeed")]);
  breastfeed.conflicts = [{ code: "TIME_OVERLAP", fields: ["startTime", "endTime"], message: "synthetic overlap", relatedEventId: bottle.id }];
  breastfeed.complete = false;
  const outdoor = event("outdoor", {
    facts: { type: "OUTDOOR", endTime: "2026-11-14T16:40:00.000Z", durationMinutes: 30, notes: "[测试记录] 户外回来，用户已补30分钟；不是真实微信记录。" },
    progress: "ended",
  }, [manualSource("outdoor"), chatSource("outdoor")]);
  return { bottle, sleep, breastfeed, outdoor };
}
function manifest(events = syntheticEvents()) {
  const expectation = (name: keyof typeof definitions) => ({
    eventId: events[name].id,
    expectedVersion: events[name].version,
    factsFingerprint: hash(events[name].facts),
    sourcesFingerprint: hash(events[name].sources),
    manualSentAt: definitions[name].sentAt,
  });
  return {
    kind: "acceptance-test-timing/v1",
    babyId,
    operatorId,
    events: {
      bottle: expectation("bottle"),
      sleep: expectation("sleep"),
      breastfeed: expectation("breastfeed"),
      outdoor: expectation("outdoor"),
    },
    requests: {
      adjustBottleTime: "acceptance-test-timing-bottle-v1",
      reevaluateBreastfeed: "acceptance-test-timing-breastfeed-v1",
    },
  };
}
async function runtime(fixture: RecordsFixture) {
  return { store: fixture.store, identity: fixture.identity, records: fixture.records };
}
async function seed(fixture: RecordsFixture, events = syntheticEvents()) {
  await fixture.identity.executeAuthorized(fixture.operator, babyId, "records:write", async (_scope, request) => {
    for (const value of Object.values(events)) await fixture.records.repo.put("care-events", babyId, value.id, value, request);
  });
  return events;
}
async function careSnapshot(fixture: RecordsFixture) {
  return fixture.identity.executeAuthorized(fixture.operator, babyId, "records:read", async (_scope, request) => Object.fromEntries(await Promise.all(
    recordTables.map(async table => [table, await fixture.records.repo.list(table, babyId, request)]),
  )));
}
describe("offline acceptance-test timing maintenance", () => {
  let fixture: RecordsFixture;
  beforeAll(async () => {
    fixture = await recordsFixture();
    fixture.advance(Date.parse("2026-11-15T04:00:00.000Z") - Date.parse("2026-10-23T12:00:00.000Z"));
    fixture.operator = await fixture.identity.authenticate((await fixture.identity.provisionOperator("test-operator", babyId, 3_600_000)).token, "bearer");
  }, 30_000);
  beforeEach(async () => {
    await fixture.resetRecords();
    await seed(fixture);
  });
  afterAll(async () => { await fixture?.close(); });

  it("retires dry-run before identity minting, callbacks, or writes", async () => {
    const before = await careSnapshot(fixture);
    const sessionsBefore = await fixture.store.list("sessions");
    const mint = vi.spyOn(fixture.identity, "provisionOperator");
    const mutation = vi.fn();
    const afterBottle = vi.fn();
    await expect(runAcceptanceTestTiming(await runtime(fixture), manifest(), { onMutation: mutation, afterBottle })).rejects.toThrow("ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL");
    expect(mint).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    expect(afterBottle).not.toHaveBeenCalled();
    expect(await fixture.store.list("sessions")).toEqual(sessionsBefore);
    expect(await careSnapshot(fixture)).toEqual(before);
    expect(fixture.legacy.committedWrites).toBe(0);
    mint.mockRestore();
  });

  it("retires execute attempts for original, drift, conflict, and duplicate inputs without mutation", async () => {
    const before = await careSnapshot(fixture);
    const mutation = vi.fn();
    const inputs = [manifest(), (() => { const value = manifest(); value.events.bottle.expectedVersion++; return value; })(), (() => { const value = manifest(); value.events.breastfeed.sourcesFingerprint = "0".repeat(64); return value; })()];
    for (const input of inputs) {
      await expect(runAcceptanceTestTiming(await runtime(fixture), input, { execute: true, onMutation: mutation })).rejects.toThrow("ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL");
    }
    expect(mutation).not.toHaveBeenCalled();
    expect(await careSnapshot(fixture)).toEqual(before);
    expect(fixture.legacy.committedWrites).toBe(0);
  });

  it("retires the prior real-record conflict case with the added record unchanged", async () => {
    const real = event("sleep", {
      facts: { type: "BREASTFEED", startTime: "2026-11-13T23:50:00.000Z", endTime: "2026-11-14T00:10:00.000Z", notes: "real caregiver record" },
      progress: "ended",
    }, [{ kind: "manual", accountId: "caregiver", conversationId: "real", messageId: "real-1", eventKey: "real-1", sentAt: "2026-11-14T00:10:00Z", senderId: "caregiver" }]);
    real.id = "bubu-synthetic-real-record";
    real.legacyId = real.id;
    await fixture.identity.executeAuthorized(fixture.operator, babyId, "records:write", (_scope, request) => fixture.records.repo.put("care-events", babyId, real.id, real, request));
    const before = await careSnapshot(fixture);
    const mutation = vi.fn();
    await expect(runAcceptanceTestTiming(await runtime(fixture), manifest(), { execute: true, onMutation: mutation })).rejects.toThrow("ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL");
    expect(mutation).not.toHaveBeenCalled();
    expect(await careSnapshot(fixture)).toEqual(before);
    expect(fixture.legacy.committedWrites).toBe(0);
  });

  it("retires the prior real-bottle duplicate case with the added record unchanged", async () => {
    const real = event("sleep", {
      facts: { type: "BOTTLE", startTime: "2026-11-14T00:00:30.000Z", milkItems: [{ id: "real-formula", milkSource: "FORMULA", milkAmount: 80 }], notes: "real caregiver bottle" },
      progress: "ended",
    }, [{ kind: "manual", accountId: "caregiver", conversationId: "real", messageId: "real-bottle", eventKey: "real-bottle", sentAt: "2026-11-14T00:00:30Z", senderId: "caregiver" }]);
    real.id = "bubu-synthetic-real-bottle";
    real.legacyId = real.id;
    await fixture.identity.executeAuthorized(fixture.operator, babyId, "records:write", (_scope, request) => fixture.records.repo.put("care-events", babyId, real.id, real, request));
    const before = await careSnapshot(fixture);
    await expect(runAcceptanceTestTiming(await runtime(fixture), manifest(), { execute: true })).rejects.toThrow("ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL");
    expect(await careSnapshot(fixture)).toEqual(before);
    expect(fixture.legacy.committedWrites).toBe(0);
  });

  it("retires restart, resume, and repeated attempts without new versions or events", async () => {
    const stableManifest = manifest();
    const before = await careSnapshot(fixture);
    await expect(runAcceptanceTestTiming(await runtime(fixture), stableManifest, { execute: true })).rejects.toThrow("ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL");
    await fixture.restart();
    await expect(runAcceptanceTestTiming(await runtime(fixture), stableManifest, { execute: true })).rejects.toThrow("ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL");
    await expect(runAcceptanceTestTiming(await runtime(fixture), stableManifest, { execute: true })).rejects.toThrow("ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL");
    expect(await careSnapshot(fixture)).toEqual(before);
    expect(fixture.legacy.committedWrites).toBe(0);
  });

  it("retires the CLI before reading its manifest or creating a data directory", () => {
    const dataDirectory = path.join(fixture.directory, "retired-timing-cli-data");
    const missingManifest = path.join(fixture.directory, "manifest-must-not-be-read.json");
    const result = spawnSync(path.resolve("node_modules/.bin/tsx"), ["scripts/acceptance-test-timing.ts", "--execute", "--manifest", missingManifest], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, BUBU_IDENTITY_DIRECTORY: dataDirectory },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ACCEPTANCE_TEST_TIMING_RETIRED_ONE_MEAL_MODEL");
    expect(result.stderr).not.toContain("ENOENT");
    expect(existsSync(dataDirectory)).toBe(false);
  }, 15_000);
});
