import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CollectorService } from "../src/collector/service";
import { createHandler } from "../src/http";
import { handleRecordsMcp } from "../src/records/mcp";
import { CarePreferencesService, type PreferenceKey } from "../src/records/preferences";
import { recordsFixture, type RecordsFixture } from "./fixtures/records";

let fixture: RecordsFixture;
beforeAll(async () => { fixture = await recordsFixture(); }, 30_000);
afterAll(async () => { await fixture?.close(); });

const option = (view: Awaited<ReturnType<RecordsFixture["records"]["preferences"]["get"]>>, key: PreferenceKey) =>
  view.options.find(value => value.key === key)!;
const supportedPreferenceKeys = [
  "BREASTFEED.durationMinutes",
  "BOTTLE.durationMinutes", "BOTTLE.milkAmount",
  "PUMP.durationMinutes", "PUMP.milkAmount",
  "SLEEP.durationMinutes",
  "HEAD_LIFT.durationMinutes",
  "PASSIVE_EXERCISE.durationMinutes",
  "GAS_EXERCISE.durationMinutes",
  "BATH.durationMinutes",
  "OUTDOOR.durationMinutes",
  "EARLY_EDUCATION.durationMinutes",
  "ROLL_OVER.count",
  "PULL_TO_SIT.count",
] as const satisfies readonly PreferenceKey[];

describe("baby-wide care preferences", () => {
  it("exposes all 14 supported keys in business order and rejects unsupported activity-field pairs", async () => {
    await fixture.resetRecords();
    const initial = await fixture.records.preferences.get(fixture.alice, "baby-a");
    expect(initial.options.map(value => value.key)).toEqual(supportedPreferenceKeys);
    expect(initial.options).toHaveLength(14);

    for (const key of ["DIAPER.durationMinutes", "BOTTLE.count", "SUPPLEMENT.durationMinutes"] as const) {
      await expect(fixture.records.preferences.update(fixture.alice, {
        babyId: "baby-a", requestId: `unsupported-${key}`, expectedVersion: 0,
        updates: [{ key, values: [1] }],
      })).rejects.toMatchObject({ code: "INVALID_PREFERENCE_KEY" });
    }

    const updates = supportedPreferenceKeys.map(key => ({
      key,
      values: [key.endsWith(".count") ? 2 : key.endsWith(".milkAmount") ? 90 : 10],
    }));
    const receipt = await fixture.records.preferences.update(fixture.alice, {
      babyId: "baby-a", requestId: "all-supported-preferences", expectedVersion: 0, updates,
    });
    expect(receipt.changedKeys).toEqual(supportedPreferenceKeys);
    expect(receipt.preferences.options.map(value => [value.key, value.configuredValues])).toEqual(
      updates.map(update => [update.key, update.values]),
    );
  });

  it("shares ordered versioned options across caregivers while isolating babies and idempotent receipts", async () => {
    await fixture.resetRecords();
    await fixture.identity.setGrant(fixture.operator, "baby-a", fixture.bob.subjectId, "active", ["records:read", "records:write", "media:read", "media:write"]);

    const initial = await fixture.records.preferences.get(fixture.alice, "baby-a");
    expect(initial.version).toBe(0);
    expect(option(initial, "BOTTLE.milkAmount")).toMatchObject({ configuredValues: [], effectiveValues: [60, 90, 120, 150, 180], source: "default", usingExampleFallback: true, examplesAreFacts: false, examplesAreRecommendations: false });
    const input = { babyId: "baby-a", requestId: "preferences-shared-1", expectedVersion: 0, updates: [
      { key: "BOTTLE.milkAmount" as const, values: [210, 180, 120] },
      { key: "ROLL_OVER.count" as const, values: [] },
    ] };
    const receipt = await fixture.records.preferences.update(fixture.alice, input);
    expect(receipt).toMatchObject({ kind: "care_preferences_changed", version: 1, changedKeys: ["BOTTLE.milkAmount", "ROLL_OVER.count"] });
    expect(receipt.text).toBe("已保存：瓶喂奶量、翻身次数。全家共用。");
    expect(receipt.text).not.toContain("BOTTLE.milkAmount");
    expect(await fixture.records.preferences.update(fixture.alice, input)).toEqual(receipt);
    await expect(fixture.records.preferences.update(fixture.alice, { ...input, updates: [{ key: "BOTTLE.milkAmount", values: [220] }] })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(fixture.records.preferences.update(fixture.bob, { ...input, requestId: "preferences-stale-2", updates: [{ key: "PUMP.milkAmount", values: [90] }] })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

    const shared = await fixture.records.preferences.get(fixture.bob, "baby-a");
    expect(option(shared, "BOTTLE.milkAmount").configuredValues).toEqual([210, 180, 120]);
    expect(option(shared, "ROLL_OVER.count")).toMatchObject({ configuredValues: [], source: "manual", usingExampleFallback: true, effectiveValues: [1, 3, 5, 10] });
    const otherBaby = await fixture.records.preferences.get(fixture.bob, "baby-b");
    expect(otherBaby.version).toBe(0);
    expect(option(otherBaby, "BOTTLE.milkAmount").configuredValues).toEqual([]);
    await expect(fixture.records.preferences.get(fixture.alice, "baby-b")).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
    await expect(fixture.records.preferences.update(fixture.collectorA, { babyId: "baby-a", requestId: "collector-pref-write", expectedVersion: 1, updates: [{ key: "PUMP.milkAmount", values: [90] }] })).rejects.toMatchObject({ code: "CAREGIVER_REQUIRED" });

    await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "ordinary-event-does-not-configure", events: [{ facts: { type: "BOTTLE", endTime: "2026-10-22T04:00:00Z", milkItems: [{ id: "formula-ordinary", milkSource: "FORMULA", milkAmount: 333 }] } }] });
    const unchanged = await fixture.records.preferences.get(fixture.alice, "baby-a");
    expect(unchanged.version).toBe(1);
    expect(option(unchanged, "BOTTLE.milkAmount").configuredValues).toEqual([210, 180, 120]);
  });

  it("serves authenticated GET and versioned PATCH/PUT without replacing unspecified keys", async () => {
    await fixture.resetRecords();
    const token = (await fixture.identity.loginLegacy("old-alice", "correct-password", "native")).token;
    const collector = new CollectorService(fixture.identity, (babyId, requestId, req, principal, actor) => fixture.records.verifyCollectorReceipt(babyId, requestId, req, principal, actor));
    const handle = createHandler(fixture.identity, "http://127.0.0.1:3320", { allowedOrigins: [] }, { records: fixture.records, attachments: fixture.attachments, collector });
    const request = (method: string, body?: unknown) => handle(new Request("http://127.0.0.1:3320/api/app/care-preferences?babyId=baby-a", {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const get = await request("GET"); expect(get.status).toBe(200);
    const patch = await request("PATCH", { requestId: "http-preferences-patch", expectedVersion: 0, updates: [{ key: "PUMP.milkAmount", values: [80, 100] }] });
    expect(patch.status, JSON.stringify(await patch.clone().json())).toBe(200);
    const put = await request("PUT", { requestId: "http-preferences-put-1", expectedVersion: 1, updates: [{ key: "SLEEP.durationMinutes", values: [30, 60] }] });
    expect(put.status).toBe(200);
    const current = await request("GET");
    const data = await current.json() as Awaited<ReturnType<RecordsFixture["records"]["preferences"]["get"]>>;
    expect(option(data, "PUMP.milkAmount").configuredValues).toEqual([80, 100]);
    expect(option(data, "SLEEP.durationMinutes").configuredValues).toEqual([30, 60]);
    expect((await handle(new Request("http://127.0.0.1:3320/api/app/care-preferences?babyId=baby-a"))).status).toBe(401);
  });

  it("exposes version-pinned preference MCP tools to caregivers but not group collectors", async () => {
    await fixture.resetRecords();
    const caregiverToken = (await fixture.identity.loginLegacy("old-alice", "correct-password", "native")).token;
    const collectorToken = (await fixture.identity.issueAgent(fixture.operator, "baby-a", "collector", { groupId: "account:group-a", agentId: "collector-a" })).token;
    const collector = new CollectorService(fixture.identity, (babyId, requestId, req, principal, actor) => fixture.records.verifyCollectorReceipt(babyId, requestId, req, principal, actor));
    const mcp = async (token: string, body: Record<string, unknown>) => {
      const request = new Request("http://127.0.0.1/api/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
      const response = await handleRecordsMcp(request, body, fixture.identity, fixture.records, collector);
      expect(response.status).toBe(200);
      return await response.json() as { result: { tools?: Array<{ name: string }>; content?: Array<{ text: string }> }; error?: unknown };
    };
    const listed = await mcp(caregiverToken, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(listed.result.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining(["bubu_get_care_preferences", "bubu_update_care_preferences"]));
    const collectorList = await mcp(collectorToken, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(collectorList.result.tools?.map(tool => tool.name)).not.toContain("bubu_update_care_preferences");
    const get = await mcp(caregiverToken, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "bubu_get_care_preferences", arguments: { babyId: "baby-a" } } });
    const current = JSON.parse(get.result.content![0]!.text) as { version: number };
    const update = await mcp(caregiverToken, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "bubu_update_care_preferences", arguments: { babyId: "baby-a", requestId: "direct-mcp-preferences", expectedVersion: current.version, updates: [{ key: "PUMP.milkAmount", values: [60, 90] }] } } });
    expect(JSON.parse(update.result.content![0]!.text)).toMatchObject({ kind: "care_preferences_changed", version: 1 });
  });

  it("runs the one-time first-week job at the exact server-created boundary and persists only actual supported patterns", async () => {
    await fixture.resetRecords();
    const startedAt = new Date(fixture.identity.now()).toISOString();
    await fixture.records.preferences.update(fixture.alice, { babyId: "baby-a", requestId: "manual-before-summary", expectedVersion: 0, updates: [
      { key: "BOTTLE.milkAmount", values: [150] }, { key: "ROLL_OVER.count", values: [] },
    ] });
    const record = (requestId: string, facts: Record<string, unknown>, progress?: "ongoing" | "ended", evidence?: Array<{ field: "durationMinutes"; kind: "default"; confirmed: true }>) =>
      fixture.records.record(fixture.alice, { babyId: "baby-a", requestId, events: [{ facts, ...(progress ? { progress } : {}), ...(evidence ? { evidence } : {}) }] });
    for (let index = 0; index < 3; index++) {
      await record(`summary-bottle-${index}`, { type: "BOTTLE", endTime: `2026-10-22T0${index + 1}:00:00Z`, milkItems: [{ id: `formula-${index}`, milkSource: "FORMULA", milkAmount: 180 }] });
      await record(`summary-pump-${index}`, { type: "PUMP", endTime: `2026-10-22T0${index + 4}:00:00Z`, milkAmount: 90 });
      await record(`summary-head-${index}`, { type: "HEAD_LIFT", startTime: `2026-10-22T${10 + index}:00:00Z`, durationMinutes: 5 });
      await record(`summary-roll-${index}`, { type: "ROLL_OVER", startTime: `2026-10-22T${14 + index}:00:00Z`, count: 4 });
    }
    await record("summary-roll-unquantified", { type: "ROLL_OVER", startTime: "2026-10-22T18:00:00Z" });
    await record("summary-pump-unknown", { type: "PUMP", endTime: "2026-10-22T19:00:00Z" });
    await record("summary-ongoing-duration", { type: "HEAD_LIFT", startTime: "2026-10-22T20:00:00Z", durationMinutes: 5 }, "ongoing");
    await record("summary-default-duration", { type: "EARLY_EDUCATION", startTime: "2026-10-22T21:00:00Z", durationMinutes: 10 }, "ended", [{ field: "durationMinutes", kind: "default", confirmed: true }]);
    await record("summary-duplicate-pump", { type: "PUMP", endTime: "2026-10-22T04:00:00Z", milkAmount: 90 });

    fixture.advance(7 * 86400_000 - 1);
    expect(await fixture.records.preferences.runDueSummaries()).toMatchObject({ completed: 0 });
    fixture.advance(1);
    const offline = await fixture.records.preferences.runDueSummaries();
    expect(offline.completed).toBe(1);
    const fresh = await fixture.identity.authenticate((await fixture.identity.loginLegacy("old-alice", "correct-password", "native")).token, "bearer");
    const view = await fixture.records.preferences.get(fresh, "baby-a");
    const summary = view.firstWeekSummary!;
    expect(summary.periodStart).toBe(startedAt);
    expect(Date.parse(summary.periodEnd) - Date.parse(summary.periodStart)).toBe(7 * 86400_000);
    expect(summary.sampleCounts).toMatchObject({ "BOTTLE.milkAmount": 3, "PUMP.milkAmount": 3, "HEAD_LIFT.durationMinutes": 3, "ROLL_OVER.count": 3 });
    expect(summary.sampleCounts).not.toHaveProperty("BOTTLE.durationMinutes");
    expect(summary.sampleCounts).not.toHaveProperty("EARLY_EDUCATION.durationMinutes");
    expect(summary.suggestions["BOTTLE.milkAmount"]).toEqual([{ value: 180, supportCount: 3 }]);
    expect(option(view, "BOTTLE.milkAmount")).toMatchObject({ source: "manual", configuredValues: [150] });
    expect(option(view, "ROLL_OVER.count")).toMatchObject({ source: "manual", configuredValues: [] });
    expect(option(view, "PUMP.milkAmount")).toMatchObject({ source: "learned", configuredValues: [90] });
    expect(summary.instructions).toBe("可继续聊天调整，也可到设置修改");
    expect(summary.text).not.toContain("上海时间");
    expect(summary.text).toContain("已自动整理：吸奶奶量 90 ml（3次记录）");
    expect(summary.text).toContain("家人手动设置已保留：瓶喂奶量、翻身次数");
    expect(summary.text).toContain("仅供参考，未自动覆盖");
    expect(summary.text).not.toMatch(/BOTTLE\.milkAmount|\d{4}-\d{2}-\d{2}T/);
    expect(view.notices).toEqual([{ id: summary.id, timestamp: summary.timestamp, text: summary.text }]);
    expect(JSON.stringify(summary)).not.toContain("synthetic-caregiver");

    await fixture.restart();
    const persisted = await fixture.records.preferences.historyData(fresh, "baby-a");
    expect(persisted.firstWeekSummary).toEqual(summary);
    expect(await fixture.records.preferences.runDueSummaries()).toMatchObject({ completed: 0 });
  });

  it("returns existing preferences but neither get nor the worker learns while processing is ineligible", async () => {
    await fixture.resetRecords();
    const recorder = await fixture.identity.authenticate((await fixture.identity.loginLegacy("old-alice", "correct-password", "native")).token, "bearer");
    for (let index = 0; index < 3; index++) await fixture.records.record(recorder, {
      babyId: "baby-a", requestId: `paused-summary-${index}`, events: [{ facts: { type: "PUMP", endTime: `2026-10-22T0${index + 1}:00:00Z`, milkAmount: 80 } }],
    });
    fixture.advance(7 * 86400_000);
    const fresh = await fixture.identity.authenticate((await fixture.identity.loginLegacy("old-alice", "correct-password", "native")).token, "bearer");
    const ineligible = new CarePreferencesService(fixture.identity, fixture.records.repo, async () => false);

    const read = await ineligible.get(fresh, "baby-a");
    expect(read.firstWeekSummary).toBeUndefined();
    expect(option(read, "PUMP.milkAmount")).toMatchObject({ source: "default", configuredValues: [] });
    expect(await ineligible.runDueSummaries()).toMatchObject({ completed: 0, skipped: 1, failed: 0 });
    const secondRead = await ineligible.get(fresh, "baby-a");
    expect(secondRead.firstWeekSummary).toBeUndefined();
    expect(option(secondRead, "PUMP.milkAmount")).toMatchObject({ source: "default", configuredValues: [] });

    expect(await fixture.records.preferences.runDueSummaries()).toMatchObject({ completed: 1 });
    const generated = await fixture.records.preferences.get(fresh, "baby-a");
    const pausedHistory = await ineligible.get(fresh, "baby-a");
    expect(pausedHistory.firstWeekSummary).toEqual(generated.firstWeekSummary);
    expect(option(pausedHistory, "PUMP.milkAmount")).toMatchObject({ source: "learned", configuredValues: [80] });
  });
});
