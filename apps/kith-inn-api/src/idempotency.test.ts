import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { idempotent } from "./idempotency";

const key = "A0000000-0000-4000-8000-000000000001", merchant = "b0000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-20T12:00:00Z");
const request = { method: "POST", path: "/dishes", body: { nested: { b: 2, a: 1 }, dishes: [1, 2] } };
function fakeClient() {
  let receipt: Record<string, unknown> | undefined;
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    if (sql.startsWith("SELECT")) return { rows: receipt ? [receipt] : [] };
    if (sql.startsWith("DELETE")) receipt = undefined;
    if (sql.startsWith("INSERT")) receipt = { request_hash: values[2], response_status: values[3],
      response_body: JSON.parse(values[4] as string), expires_at: values[6] };
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, query };
}

describe("mutation receipts", () => {
  it("replays recursively sorted object keys and normalizes the UUID without hashing extra credentials", async () => {
    const { client, query } = fakeClient(), work = vi.fn(async () => ({ status: 201, body: { version: 1 } }));
    const original = { ...request, token: "first-secret" };
    await idempotent(client, merchant, key, original, work, now);
    const reordered = { ...request, body: { dishes: [1, 2], nested: { a: 1, b: 2 } }, token: "new-secret" };
    await expect(idempotent(client, merchant, key.toLowerCase(), reordered, work, now)).resolves.toEqual({ status: 201, body: { version: 1 } });
    expect(work).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1]![1]).toEqual([merchant, key.toLowerCase(), expect.any(Buffer), 201,
      '{"version":1}', now, new Date(now.getTime() + 86_400_000)]);
  });
  it.each([{ ...request, method: "PATCH" }, { ...request, path: "/week-plans" },
    { ...request, body: { ...request.body, dishes: [2, 1] } }])("rejects a different operation or array order", async (changed) => {
    const { client } = fakeClient(), work = vi.fn(async () => ({ status: 201, body: {} }));
    await idempotent(client, merchant, key, request, work, now);
    await expect(idempotent(client, merchant, key, changed, work, now)).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    expect(work).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid keys before querying, expires at exactly 24h and stores only success", async () => {
    const { client, query } = fakeClient(), work = vi.fn(async () => ({ status: 201, body: {} }));
    await expect(idempotent(client, merchant, "bad", request, work, now)).rejects.toMatchObject({ status: 400, code: "INVALID_REQUEST" });
    expect(query).not.toHaveBeenCalled();
    await idempotent(client, merchant, key, request, work, now);
    await expect(idempotent(client, merchant, key, request, async () => ({ status: 409, body: {} }),
      new Date(now.getTime() + 86_400_000))).rejects.toThrow("Mutation must return a successful response");
    expect(query.mock.calls.filter(([sql]) => sql.startsWith("DELETE"))).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"))).toHaveLength(1);
    await expect(idempotent(client, merchant, key, request, async () => { throw new Error("rollback"); }, now)).rejects.toThrow("rollback");
    expect(query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"))).toHaveLength(1);
  });
});
