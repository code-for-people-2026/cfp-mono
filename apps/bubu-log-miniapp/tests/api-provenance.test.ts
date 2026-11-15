import { describe, expect, it } from "vitest";
import { ApiError, createBubuApi, type Transport, type TransportRequest, type TransportResponse } from "../src/api/client";
import { ResponseFormatError } from "../src/api/contracts";
import type { SessionStorage } from "../src/api/session";

const babyId = "baby /二";
const activityId = "activity/一";
const createdAt = "2026-10-23T01:02:03.000Z";

function storage() {
  const values = new Map<string, unknown>();
  const store: SessionStorage = {
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    remove: (key) => { values.delete(key); },
  };
  return { store, values };
}
const response = (data: unknown, status = 200): TransportResponse => ({ status, data });
function fixture(transport: Transport) {
  const saved = storage();
  const client = createBubuApi({
    native: true, origin: "https://baby.example.test", transport, storage: saved.store,
  });
  return { client, values: saved.values };
}
const audit = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  action: "CREATE",
  resourceType: "ACTIVITY",
  success: true,
  inputMethod: "VOICE",
  resourceId: activityId,
  activityId: null,
  babyId,
  userId: "account-1",
  inputText: "审计记录里的原话",
  createdAt,
  beforeData: { ignored: true },
  afterData: { ignored: true },
  errorMessage: null,
  description: "ignored",
  ...extra,
});
const page = (data: unknown[], hasMore = false) => ({ data, total: data.length, hasMore });
const query = (request: TransportRequest): Record<string, string> =>
  Object.fromEntries(new URL(request.url).searchParams.entries());

describe("read-only activity provenance adapter", () => {
  it("uses a scoped GET audit query and returns only the existing provenance fields", async () => {
    const requests: TransportRequest[] = [];
    const { client, values } = fixture(async (request) => {
      requests.push(request);
      return response(page([audit("log-1")]));
    });
    const result = await client.getActivityProvenance(babyId, activityId);
    expect(result).toEqual({
      complete: true,
      pages: 1,
      provenance: {
        accountId: "account-1",
        inputMethod: "VOICE",
        inputText: "审计记录里的原话",
        addedAt: createdAt,
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "GET" });
    expect(requests[0]!.url.startsWith("https://baby.example.test/api/app/audits?")).toBe(true);
    expect(requests[0]!.headers["x-baby-id"]).toBe(babyId);
    expect(query(requests[0]!)).toEqual({
      action: "CREATE",
      resourceType: "ACTIVITY",
      success: "true",
      limit: "200",
      offset: "0",
      babyId,
    });
    expect(JSON.stringify(result)).not.toContain("beforeData");
    expect(JSON.stringify(result)).not.toContain("afterData");
    expect(values.size).toBe(0);
  });

  it("finds a second-page CREATE while ignoring UPDATE, failed CREATE and unrelated logs", async () => {
    const offsets: string[] = [];
    const { client } = fixture(async (request) => {
      const offset = query(request).offset;
      offsets.push(offset);
      if (offset === "0") {
        const rows = Array.from({ length: 198 }, (_, index) => audit(`unrelated-${index}`, {
          resourceId: `other-${index}`, userId: "other-account",
        }));
        return response(page([
          ...rows,
          audit("update-log", { action: "UPDATE", inputText: "UPDATE 不能当作来源" }),
          audit("failed-log", { success: false, inputText: "失败 CREATE 不能当作来源" }),
        ], true));
      }
      return response(page([audit("matching-create")]));
    });
    const result = await client.getActivityProvenance(babyId, activityId);
    expect(offsets).toEqual(["0", "200"]);
    expect(result.complete).toBe(true);
    expect(result.pages).toBe(2);
    expect(result.provenance).toMatchObject({ accountId: "account-1", inputText: "审计记录里的原话" });
  });

  it("accepts either matching id when the other is null", async () => {
    for (const row of [
      audit("resource-only", { activityId: null }),
      audit("activity-only", { resourceId: null, activityId }),
    ]) {
      const { client } = fixture(async () => response(page([row])));
      const result = await client.getActivityProvenance(babyId, activityId);
      expect(result.provenance).toMatchObject({ accountId: "account-1" });
      expect(result.complete).toBe(true);
    }
  });

  it("rejects conflicting resource/activity ids and any missing, null or foreign baby scope", async () => {
    for (const row of [
      audit("conflicting-ids", { resourceId: "another-activity", activityId }),
      audit("cross-baby", { babyId: "other-baby" }),
      audit("missing-baby", { babyId: undefined }),
      audit("null-baby", { babyId: null }),
    ]) {
      const { client } = fixture(async () => response(page([row])));
      const result = await client.getActivityProvenance(babyId, activityId);
      expect(result.provenance).toBeNull();
      expect(result.complete).toBe(false);
    }
  });

  it("keeps missing original text null and never substitutes an activity note", async () => {
    const { client } = fixture(async () => response(page([audit("no-input", {
      inputText: null, notes: "活动备注不是原话",
    })])));
    const result = await client.getActivityProvenance(babyId, activityId);
    expect(result.provenance?.inputText).toBeNull();
    expect(JSON.stringify(result)).not.toContain("活动备注不是原话");
  });

  it("strictly validates page shape and each audit field", async () => {
    const invalid: unknown[] = [
      { data: {}, total: 0, hasMore: false },
      { data: [], total: -1, hasMore: false },
      { data: [], total: 0, hasMore: "no" },
      page([audit("bad-action", { action: "UNKNOWN" })]),
      page([audit("bad-method", { inputMethod: "PHOTO" })]),
      page([audit("bad-success", { success: "true" })]),
      page([audit("bad-date", { createdAt: "not a date" })]),
      page([audit("bad-resource", { resourceId: 42 })]),
      page([audit("bad-id", { id: " " })]),
    ];
    for (const data of invalid) {
      const { client } = fixture(async () => response(data));
      await expect(client.getActivityProvenance(babyId, activityId)).rejects.toBeInstanceOf(ResponseFormatError);
    }
  });

  it("stops at the server's 5000 offset cap and reports an incomplete scan", async () => {
    const offsets: number[] = [];
    const { client } = fixture(async (request) => {
      const offset = Number(query(request).offset);
      offsets.push(offset);
      const rows = Array.from({ length: 200 }, (_, index) => audit(`log-${offset}-${index}`, {
        resourceId: `other-${offset}-${index}`,
      }));
      return response(page(rows, true));
    });
    const result = await client.getActivityProvenance(babyId, activityId);
    expect(result).toEqual({ provenance: null, complete: false, pages: 26 });
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(5000);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(5000);
    expect(offsets).toEqual(Array.from({ length: 26 }, (_, index) => index * 200));
  });

  it("detects repeated and short hasMore pages without unbounded scanning", async () => {
    const requests: TransportRequest[] = [];
    const repeated = audit("same-row", { resourceId: "other" });
    const { client } = fixture(async (request) => {
      requests.push(request);
      return response(page(Array.from({ length: 200 }, () => repeated), true));
    });
    expect(await client.getActivityProvenance(babyId, activityId)).toEqual({ provenance: null, complete: false, pages: 2 });
    expect(requests).toHaveLength(2);

    const short = fixture(async () => response(page([audit("short", { resourceId: "other" })], true)));
    expect(await short.client.getActivityProvenance(babyId, activityId)).toEqual({ provenance: null, complete: false, pages: 1 });

    const emptyMore = fixture(async () => response(page([], true)));
    expect(await emptyMore.client.getActivityProvenance(babyId, activityId)).toEqual({ provenance: null, complete: false, pages: 1 });

    const emptyEnd = fixture(async () => response(page([], false)));
    expect(await emptyEnd.client.getActivityProvenance(babyId, activityId)).toEqual({ provenance: null, complete: true, pages: 1 });
  });

  it("stops requesting further pages when the caller cancels", async () => {
    const requests: TransportRequest[] = [];
    const { client } = fixture(async (request) => {
      requests.push(request);
      const rows = Array.from({ length: 200 }, (_, index) => audit(`cancel-${index}`, { resourceId: `other-${index}` }));
      return response(page(rows, true));
    });
    let checks = 0;
    const result = await client.getActivityProvenance(babyId, activityId, () => ++checks > 1);
    expect(result).toEqual({ provenance: null, complete: false, pages: 1 });
    expect(requests).toHaveLength(1);
  });

  it("propagates ordinary endpoint errors for retry and keeps no provenance cache", async () => {
    for (const status of [404, 500]) {
      const { client, values } = fixture(async () => response({ error: "audit outage" }, status));
      await expect(client.getActivityProvenance(babyId, activityId)).rejects.toMatchObject({ status });
      expect(values.size).toBe(0);
    }
    const missing = fixture(async () => response({ error: "Unauthorized", code: "UNAUTHORIZED" }, 401));
    await expect(missing.client.getActivityProvenance(babyId, activityId)).rejects.toBeInstanceOf(ApiError);
    await expect(missing.client.getActivityProvenance(babyId, activityId)).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });

  it("requires both scoped ids before any request", async () => {
    const { client } = fixture(async () => { throw new Error("must not request"); });
    await expect(client.getActivityProvenance(" ", activityId)).rejects.toMatchObject({ status: 400 });
    await expect(client.getActivityProvenance(babyId, " ")).rejects.toMatchObject({ status: 400 });
  });
});
