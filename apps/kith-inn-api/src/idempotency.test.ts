import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { idempotent } from "./idempotency";

const key = "A0000000-0000-4000-8000-000000000001", merchant = "b0000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-20T12:00:00Z");
const request = { method: "POST", path: "/dishes", body: { nested: { b: 2, a: 1 }, dishes: [1, 2] } };
function fakeClient() {
  const receipts = new Map<string, { merchantId: unknown; request_hash: unknown; response_status: unknown;
    response_body: unknown; expires_at: Date }>();
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    const receipt = receipts.get(`${values[0]}:${values[1]}`);
    if (sql.startsWith("SELECT")) return { rows: receipt ? [receipt] : [] };
    if (sql.startsWith("DELETE")) {
      expect(sql).toBe("DELETE FROM mutation_receipts WHERE merchant_id = $1 AND expires_at <= $2");
      for (const [id, stored] of receipts) {
        if (stored.merchantId === values[0] && stored.expires_at <= (values[1] as Date)) receipts.delete(id);
      }
    }
    if (sql.startsWith("INSERT")) receipts.set(`${values[0]}:${values[1]}`, {
      merchantId: values[0], request_hash: values[2], response_status: values[3],
      response_body: JSON.parse(values[4] as string), expires_at: values[6] as Date,
    });
    return { rows: [] };
  });
  return { client: { query } as unknown as PoolClient, query, receipts };
}

describe("mutation receipts", () => {
  it("replays recursively sorted object keys and normalizes the UUID without hashing extra credentials", async () => {
    const { client, query } = fakeClient(), work = vi.fn(async () => ({ status: 201, body: { version: 1 } }));
    const original = { ...request, token: "first-secret" };
    await idempotent(client, merchant, key, original, work, now);
    const reordered = { ...request, body: { dishes: [1, 2], nested: { a: 1, b: 2 } }, token: "new-secret" };
    await expect(idempotent(client, merchant, key.toLowerCase(), reordered, work, now)).resolves.toEqual({ status: 201, body: { version: 1 } });
    expect(work).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.find(([sql]) => sql.startsWith("INSERT"))![1]).toEqual([merchant, key.toLowerCase(), expect.any(Buffer), 201,
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
    expect(query).toHaveBeenCalledWith("DELETE FROM mutation_receipts WHERE merchant_id = $1 AND expires_at <= $2",
      [merchant, new Date(now.getTime() + 86_400_000)]);
    expect(query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"))).toHaveLength(1);
    await expect(idempotent(client, merchant, key, request, async () => { throw new Error("rollback"); }, now)).rejects.toThrow("rollback");
    expect(query.mock.calls.filter(([sql]) => sql.startsWith("INSERT"))).toHaveLength(1);
  });

  it("cleans unrelated expired keys only for the current merchant and retains live replay", async () => {
    const { client, receipts } = fakeClient(), work = vi.fn(async () => ({ status: 201, body: { version: 1 } }));
    const otherMerchant = "b0000000-0000-4000-8000-000000000003";
    const freshKey = "a0000000-0000-4000-8000-000000000004";
    const newKey = "a0000000-0000-4000-8000-000000000005";
    await idempotent(client, merchant, key, request, work, now);
    await idempotent(client, otherMerchant, key, request, work, now);
    const fresh = await idempotent(client, merchant, freshKey, request, work, new Date(now.getTime() + 1));
    const expiry = new Date(now.getTime() + 86_400_000);
    await idempotent(client, merchant, newKey, request, work, expiry);
    expect([...receipts.keys()].sort()).toEqual([
      `${otherMerchant}:${key.toLowerCase()}`, `${merchant}:${freshKey}`, `${merchant}:${newKey}`,
    ].sort());
    await expect(idempotent(client, merchant, freshKey, request, work, expiry)).resolves.toEqual(fresh);
    expect(work).toHaveBeenCalledTimes(4);
  });
});
