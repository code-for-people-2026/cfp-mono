import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { HttpLegacyBackend } from "../src/legacy";
import { emptyDailyMetrics } from "../src/records/statistics";
import type { LegacyActivity } from "../src/records/types";

type Doc = Record<string, unknown>;
type Request = { url: URL; method: string; body: Doc };
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
const sample = (id: string, extra: Partial<LegacyActivity> = {}): LegacyActivity => ({ id, babyId: "baby-1", type: "BOTTLE", startTime: "2026-10-22T02:00:00.000Z", endTime: "2026-10-22T02:15:00.000Z", milkAmount: 100, milkSource: "BREAST_MILK", updatedAt: "2026-10-22T02:16:00.000Z", ...extra });

/** Synthetic Payload-compatible HTTP server: requests use real HTTP, JWT login and collection query encoding. */
async function fixture() {
  const activities = new Map<string, Doc>(); const stats = new Map<string, Doc>(); const requests: Request[] = [];
  const control: { loseNextResponse?: boolean; beforeMutation?: () => void; wrongBaby?: boolean; zeroMutation?: boolean } = {};
  let clock = Date.parse("2026-10-23T00:00:00Z");
  const matches = (row: Doc, url: URL) => {
    for (const [key, value] of url.searchParams) {
      const field = /^where(?:\[and\]\[\d+\])?\[([^\]]+)\]\[(equals|exists)\]$/.exec(key);
      if (!field) continue;
      const actual = row[field[1]!];
      if (field[2] === "exists" && (actual !== undefined && actual !== null) !== (value === "true")) return false;
      if (field[2] === "equals" && String(actual) !== value) return false;
    }
    return true;
  };
  const server = createServer(async (req, res) => {
    try {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) as Doc : {};
      const url = new URL(req.url!, "http://localhost"); const method = req.method || "GET";
      requests.push({ url, method, body });
      const respond = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
      if (url.pathname === "/api/cms-admins/login") { respond({ token: "synthetic-cms", exp: Math.floor(Date.now() / 1000) + 3600 }); return; }
      if (req.headers.authorization !== "JWT synthetic-cms") { respond({}, 401); return; }
      const [, , collection, documentId] = url.pathname.split("/");
      if (collection !== "activities" && collection !== "daily-stats") { respond({}, 404); return; }
      const rows = collection === "activities" ? activities : stats;
      if (method === "GET" && documentId) {
        const value = rows.get(decodeURIComponent(documentId));
        respond(value ? { ...value, ...(control.wrongBaby ? { babyId: "other-baby" } : {}) } : {}, value ? 200 : 404); return;
      }
      if (method === "GET") {
        const all = [...rows.values()].filter(row => matches(row, url)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const page = Number(url.searchParams.get("page") || 1); const paginated = url.searchParams.get("pagination") === "true";
        const pageSize = 2; const slice = paginated ? all.slice((page - 1) * pageSize, page * pageSize) : all;
        respond({ docs: slice, hasNextPage: paginated && page * pageSize < all.length, nextPage: paginated && page * pageSize < all.length ? page + 1 : null }); return;
      }
      control.beforeMutation?.(); control.beforeMutation = undefined;
      let result: Doc;
      if (method === "POST") {
        if (rows.has(String(body.id))) { respond({ errors: [{ message: "duplicate" }] }, 409); return; }
        const value = { ...body, updatedAt: new Date(clock++).toISOString() }; rows.set(String(body.id), value); result = { doc: value };
      } else if (documentId && method === "PATCH") {
        const value = { ...rows.get(documentId), ...body, updatedAt: new Date(clock++).toISOString() }; rows.set(documentId, value); result = { doc: value };
      } else {
        const matched = control.zeroMutation ? [] : [...rows.values()].filter(row => matches(row, url));
        const docs = matched.map(row => {
          if (method === "DELETE") { rows.delete(String(row.id)); return row; }
          const value = { ...row, ...body, updatedAt: new Date(clock++).toISOString() }; rows.set(String(row.id), value); return value;
        });
        result = { docs, errors: [] };
      }
      if (control.loseNextResponse) { control.loseNextResponse = false; req.socket.destroy(); return; }
      respond(result, method === "POST" ? 201 : 200);
    } catch { res.writeHead(500); res.end(); }
  });
  server.listen(0, "127.0.0.1"); servers.push(server); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing port");
  const backend = new HttpLegacyBackend({ origin: `http://127.0.0.1:${address.port}`, cmsEmail: "synthetic@example.test", cmsPassword: "test-only" });
  return { backend, activities, stats, requests, control };
}

describe("restricted legacy record HTTP protocol", () => {
  it("reads every page under the fixed baby filter, including backend-capped page sizes", async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) f.activities.set(`a${i}`, { ...sample(`a${i}`) });
    f.activities.set("other", { ...sample("other", { babyId: "baby-2" }) });
    expect((await f.backend.listActivities("baby-1")).map(row => row.id)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
    expect(f.requests.filter(request => request.url.pathname === "/api/activities")).toHaveLength(3);
    expect(f.requests.filter(request => request.url.pathname === "/api/activities").every(request => request.url.searchParams.get("where[babyId][equals]") === "baby-1")).toBe(true);
  });
  it("creates a deterministic ID once, clears absent old fields, and never persists extension metadata in the old collection", async () => {
    const f = await fixture(); const desired = sample("stable-record", { type: "BOTTLE", milkSource: "FORMULA", preparedMilkAmount: 120, remainingMilkAmount: 20, milkAmount: 100 });
    await f.backend.writeActivity("baby-1", desired.id, desired, null);
    await f.backend.writeActivity("baby-1", desired.id, desired, null);
    const posts = f.requests.filter(request => request.url.pathname === "/api/activities" && request.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ id: desired.id, babyId: "baby-1", breastFirmness: null, supplementType: null, spitUpType: null });
    expect(posts[0]?.body).not.toHaveProperty("preparedMilkAmount");
    expect(posts[0]?.body).not.toHaveProperty("remainingMilkAmount");
    expect(posts[0]?.body).not.toHaveProperty("updatedAt");
  });
  it("updates both formerly omitted type fields with id/baby/snapshot conditions", async () => {
    const f = await fixture(); const before = sample("edit", { type: "SUPPLEMENT", supplementType: "AD" }); f.activities.set(before.id, { ...before });
    const desired = { ...before, supplementType: "PREBIOTICS" as const };
    const saved = await f.backend.writeActivity("baby-1", before.id, desired, before);
    expect(saved?.supplementType).toBe("PREBIOTICS");
    const request = f.requests.find(item => item.method === "PATCH")!;
    expect(request.url.pathname).toBe("/api/activities");
    expect(request.url.searchParams.get("where[and][0][id][equals]")).toBe(before.id);
    expect(request.url.searchParams.get("where[and][1][babyId][equals]")).toBe("baby-1");
    expect(request.url.searchParams.get("where[and][2][updatedAt][equals]")).toBe(before.updatedAt);
    const changed = await f.backend.writeActivity("baby-1", before.id, { ...saved!, type: "SPIT_UP", supplementType: undefined, spitUpType: "NORMAL" }, saved);
    expect(changed?.supplementType).toBeNull(); expect(changed?.spitUpType).toBe("NORMAL");
  });
  it("rejects a stale snapshot and a concurrent legacy edit between GET and conditional PATCH", async () => {
    const f = await fixture(); const before = sample("race"); f.activities.set(before.id, { ...before, milkAmount: 90 });
    await expect(f.backend.writeActivity("baby-1", before.id, { ...before, milkAmount: 80 }, before)).rejects.toMatchObject({ code: "LEGACY_VERSION_CONFLICT" });
    f.activities.set(before.id, { ...before });
    f.control.beforeMutation = () => f.activities.set(before.id, { ...before, milkAmount: 70, updatedAt: "2026-10-22T02:17:00.000Z" });
    await expect(f.backend.writeActivity("baby-1", before.id, { ...before, milkAmount: 80 }, before)).rejects.toMatchObject({ code: "LEGACY_VERSION_CONFLICT" });
    expect(f.activities.get(before.id)?.milkAmount).toBe(70);
  });
  it("uses the complete expected field selection when an old record has no updatedAt", async () => {
    const f = await fixture(); const before = sample("no-timestamp", { updatedAt: undefined }); f.activities.set(before.id, { ...before });
    f.control.beforeMutation = () => f.activities.set(before.id, { ...before, notes: "旧站刚刚更正" });
    await expect(f.backend.writeActivity("baby-1", before.id, { ...before, milkAmount: 80 }, before)).rejects.toMatchObject({ code: "LEGACY_VERSION_CONFLICT" });
    const request = f.requests.find(item => item.method === "PATCH")!;
    expect([...request.url.searchParams].some(([key]) => key.includes("[notes][exists]"))).toBe(true);
    expect(f.activities.get(before.id)?.notes).toBe("旧站刚刚更正");
  });
  it.each(["create", "update", "delete"])("recovers %s after committed response loss without repeating its mutation", async kind => {
    const f = await fixture(); const before = sample(`lost-${kind}`); const desired = kind === "delete" ? null : { ...before, milkAmount: 90 };
    if (kind !== "create") f.activities.set(before.id, { ...before });
    f.control.loseNextResponse = true;
    await expect(f.backend.writeActivity("baby-1", before.id, desired, kind === "create" ? null : before)).resolves.toEqual(desired ? expect.objectContaining({ milkAmount: 90 }) : null);
    await f.backend.writeActivity("baby-1", before.id, desired, kind === "create" ? null : before);
    expect(f.requests.filter(request => request.url.pathname.startsWith("/api/activities") && request.method !== "GET")).toHaveLength(1);
  });
  it("fences deletion and refuses all cross-baby payloads and responses", async () => {
    const f = await fixture(); const before = sample("delete"); f.activities.set(before.id, { ...before });
    f.control.beforeMutation = () => f.activities.set(before.id, { ...before, updatedAt: "2026-10-22T02:18:00.000Z" });
    await expect(f.backend.writeActivity("baby-1", before.id, null, before)).rejects.toMatchObject({ code: "LEGACY_VERSION_CONFLICT" });
    expect(f.activities.has(before.id)).toBe(true);
    await expect(f.backend.writeActivity("baby-2", before.id, before, null)).rejects.toMatchObject({ code: "LEGACY_SCOPE_INVALID" });
    f.control.wrongBaby = true;
    await expect(f.backend.getActivity("baby-1", before.id)).rejects.toMatchObject({ code: "LEGACY_SCOPE_INVALID" });
  });
  it("refreshes saved daily stats with only the old metric fields and recovers a lost response", async () => {
    const f = await fixture(); const metrics = { ...emptyDailyMetrics(), totalMilkAmount: 100, bottleCount: 1 };
    f.control.loseNextResponse = true;
    await f.backend.saveDailyStats("baby-1", "2026-10-22", metrics);
    await f.backend.saveDailyStats("baby-1", "2026-10-22", metrics);
    await f.backend.saveDailyStats("baby-1", "2026-10-22", { ...metrics, totalMilkAmount: 80 });
    expect(f.stats.size).toBe(1);
    expect([...f.stats.values()][0]).toMatchObject({ babyId: "baby-1", date: "2026-10-21T16:00:00.000Z", totalMilkAmount: 80 });
    expect(f.requests.filter(request => request.method === "POST" && request.url.pathname === "/api/daily-stats")).toHaveLength(1);
    await expect(f.backend.saveDailyStats("baby-1", "2026-10-22", { ...metrics, pendingCount: 1 })).rejects.toMatchObject({ code: "INVALID_METRICS" });
  });
});
