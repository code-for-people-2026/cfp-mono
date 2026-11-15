import { describe, expect, it, vi } from "vitest";
import { createBubuApi, type TransportRequest } from "../src/api/client";
import { ResponseFormatError } from "../src/api/contracts";
import {
  addPreferenceValue, changedPreferenceUpdates, clearPreferenceValues, deletePreferenceValue,
  draftFromPreferences, editPreferenceValue, movePreferenceValue, PreferenceRequestTracker,
  reconcilePreferenceDraft,
} from "../src/preferences/options-editor";
import {
  assertPreferenceUpdates, decodeCarePreferences, PREFERENCE_KEYS,
  type CarePreferencesView, type PreferenceField, type PreferenceOption,
} from "../src/preferences/shared-options";

const at = "2026-11-14T03:00:00.000Z";
const option = (overrides: Partial<PreferenceOption> = {}): PreferenceOption => ({
  key: "BOTTLE.milkAmount", activityType: "BOTTLE", field: "milkAmount",
  configuredValues: [90, 120], effectiveValues: [90, 120], source: "manual",
  version: 2, updatedAt: at, usingExampleFallback: false,
  examplesAreFacts: false, examplesAreRecommendations: false, ...overrides,
});
const view = (babyId = "baby-1", overrides: Partial<CarePreferencesView> = {}): CarePreferencesView => ({
  babyId, version: 2, updatedAt: at, options: [option()], notices: [],
  semantics: "默认示例不是宝宝事实、规律或建议。", ...overrides,
});
const api = (transport: (request: TransportRequest) => Promise<{ status: number; data: unknown }>) => createBubuApi({
  native: false, origin: "", authMode: "sidecar", transport,
  storage: { get: () => undefined, set: () => {}, remove: () => {} },
});

describe("baby-shared preference API", () => {
  it("uses authenticated baby-scoped GET/PATCH and sends only the mutation contract", async () => {
    const requests: TransportRequest[] = [];
    const client = api(async request => {
      requests.push(request);
      if (request.method === "GET") return { status: 200, data: view() };
      const changed = view("baby-1", { version: 3, updatedAt: "2026-11-14T03:01:00.000Z", options: [option({ configuredValues: [120, 150], effectiveValues: [120, 150], version: 3, updatedAt: "2026-11-14T03:01:00.000Z" })] });
      return { status: 200, data: { kind: "care_preferences_changed", requestId: "prefs-request-1", version: 3, updatedAt: changed.updatedAt, changedKeys: ["BOTTLE.milkAmount"], text: "已更新，不会修改记录。", preferences: changed } };
    });

    await expect(client.getCarePreferences("baby-1")).resolves.toMatchObject({ babyId: "baby-1", version: 2 });
    await expect(client.updateCarePreferences({ babyId: "baby-1", requestId: "prefs-request-1", expectedVersion: 2, updates: [{ key: "BOTTLE.milkAmount", values: [120, 150] }] })).resolves.toMatchObject({ kind: "care_preferences_changed", version: 3 });

    expect(requests[0]).toMatchObject({ method: "GET", url: "/api/app/care-preferences?babyId=baby-1", headers: { "x-baby-id": "baby-1", "X-Bubu-Client": "browser" } });
    expect(requests[1]).toMatchObject({ method: "PATCH", url: "/api/app/care-preferences?babyId=baby-1", headers: { "x-baby-id": "baby-1", "Content-Type": "application/json" } });
    expect(JSON.parse(requests[1]!.body!)).toEqual({ requestId: "prefs-request-1", expectedVersion: 2, updates: [{ key: "BOTTLE.milkAmount", values: [120, 150] }] });
    expect(requests[1]!.body).not.toContain("facts");
  });

  it("rejects cross-baby GET and PATCH responses", async () => {
    await expect(api(async () => ({ status: 200, data: view("baby-2") })).getCarePreferences("baby-1")).rejects.toBeInstanceOf(ResponseFormatError);
    const client = api(async () => ({ status: 200, data: { kind: "care_preferences_changed", requestId: "prefs-request-1", version: 2, updatedAt: at, changedKeys: [], text: "错误宝宝", preferences: view("baby-2") } }));
    await expect(client.updateCarePreferences({ babyId: "baby-1", requestId: "prefs-request-1", expectedVersion: 2, updates: [{ key: "BOTTLE.milkAmount", values: [] }] })).rejects.toBeInstanceOf(ResponseFormatError);
  });

  it("strictly rejects malformed keys, mismatched activities, units, duplicates and invalid numeric ranges", () => {
    expect(() => decodeCarePreferences({ ...view(), options: [{ ...option(), key: "BOTTLE.unknown" }] }, "baby-1")).toThrow(ResponseFormatError);
    expect(() => decodeCarePreferences({ ...view(), options: [{ ...option(), key: "DIAPER.milkAmount", activityType: "DIAPER", field: "milkAmount" }] }, "baby-1")).toThrow(ResponseFormatError);
    expect(() => decodeCarePreferences({ ...view(), options: [{ ...option(), activityType: "PUMP" }] }, "baby-1")).toThrow(ResponseFormatError);
    expect(() => decodeCarePreferences({ ...view(), options: [{ ...option(), unit: "oz" }] }, "baby-1")).toThrow(ResponseFormatError);
    expect(() => decodeCarePreferences({ ...view(), options: [{ ...option(), configuredValues: [90, 90] }] }, "baby-1")).toThrow(ResponseFormatError);
    expect(() => decodeCarePreferences({ ...view(), options: [{ ...option({ key: "ROLL_OVER.count", activityType: "ROLL_OVER", field: "count" }), configuredValues: [1.5], effectiveValues: [1.5] }] }, "baby-1")).toThrow(ResponseFormatError);
  });

  it("decodes every service key in service order and blocks unsupported milk keys", () => {
    const options = PREFERENCE_KEYS.map(key => {
      const [activityType, field] = key.split(".") as [PreferenceOption["activityType"], PreferenceField];
      const values = [field === "count" ? 2 : field === "milkAmount" ? 90 : 10];
      return option({ key, activityType, field, configuredValues: values, effectiveValues: values });
    });
    expect(decodeCarePreferences({ ...view(), options }, "baby-1").options.map(value => value.key)).toEqual(PREFERENCE_KEYS);
    expect(() => assertPreferenceUpdates(options.map(value => ({ key: value.key, values: value.configuredValues })))).not.toThrow();
    for (const key of ["DIAPER.milkAmount", "SLEEP.milkAmount", "ROLL_OVER.milkAmount"] as const) {
      expect(() => assertPreferenceUpdates([{ key, values: [1] }])).toThrow(ResponseFormatError);
    }
  });
});

describe("ordered preference editor", () => {
  it("adds, edits, reorders, deletes and keeps an explicitly empty configured list", () => {
    const original = view();
    let draft = draftFromPreferences(original);
    draft = addPreferenceValue(draft, "BOTTLE.milkAmount", 150);
    draft = editPreferenceValue(draft, "BOTTLE.milkAmount", 0, 80);
    draft = movePreferenceValue(draft, "BOTTLE.milkAmount", 2, -1);
    expect(draft["BOTTLE.milkAmount"]).toEqual([80, 150, 120]);
    draft = deletePreferenceValue(draft, "BOTTLE.milkAmount", 1);
    expect(changedPreferenceUpdates(original, draft)).toEqual([{ key: "BOTTLE.milkAmount", values: [80, 120] }]);
    draft = clearPreferenceValues(draft, "BOTTLE.milkAmount");
    expect(changedPreferenceUpdates(original, draft)).toEqual([{ key: "BOTTLE.milkAmount", values: [] }]);
  });

  it("updates only changed keys and preserves local draft keys across a stale-version refresh", () => {
    const pump = option({ key: "PUMP.milkAmount", activityType: "PUMP", configuredValues: [60], effectiveValues: [60] });
    const previous = view("baby-1", { options: [option(), pump] });
    const draft = editPreferenceValue(draftFromPreferences(previous), "BOTTLE.milkAmount", 0, 100);
    const latest = view("baby-1", { version: 3, options: [option({ configuredValues: [95, 120], effectiveValues: [95, 120] }), option({ ...pump, configuredValues: [70], effectiveValues: [70], version: 3 })] });
    const reconciled = reconcilePreferenceDraft(previous, draft, latest);
    expect(reconciled).toEqual({ "BOTTLE.milkAmount": [100, 120], "PUMP.milkAmount": [70] });
    expect(changedPreferenceUpdates(latest, reconciled)).toEqual([{ key: "BOTTLE.milkAmount", values: [100, 120] }]);
    expect(reconcilePreferenceDraft(previous, draft, view("baby-2"))).toEqual({ "BOTTLE.milkAmount": [90, 120] });
  });

  it("reuses a stable request id only for an exact retry", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const tracker = new PreferenceRequestTracker();
    const updates = [{ key: "BOTTLE.milkAmount" as const, values: [120] }];
    const first = tracker.requestId(2, updates);
    expect(tracker.requestId(2, updates)).toBe(first);
    expect(tracker.requestId(3, updates)).not.toBe(first);
  });
});
