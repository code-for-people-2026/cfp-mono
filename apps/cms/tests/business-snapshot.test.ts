import { describe, expect, it, vi } from "vitest";
import { KITH_INN_BUSINESS_TABLES, readKithInnBusinessSnapshot } from "../src/smoke/businessSnapshot";

describe("readKithInnBusinessSnapshot", () => {
  it("counts every old kith-inn business and relationship table without v1 or Payload metadata", async () => {
    const query = vi.fn(async () => ({ rows: KITH_INN_BUSINESS_TABLES.map((table) => ({
      table, count: table.length, digest: "a".repeat(32),
    })) }));

    const snapshot = await readKithInnBusinessSnapshot(query);

    expect(Object.keys(snapshot)).toEqual([...KITH_INN_BUSINESS_TABLES]);
    expect(snapshot.sellers).toEqual({ count: expect.any(Number), digest: "a".repeat(32) });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls.flat().join(" ")).not.toMatch(/kiv1_|payload_(?:migrations|preferences|kv)/);
  });

  it("fails closed when a database count is missing or invalid", async () => {
    await expect(readKithInnBusinessSnapshot(async () => ({ rows: [] })))
      .rejects.toThrow("business snapshot unavailable");
    await expect(readKithInnBusinessSnapshot(async () => ({
      rows: KITH_INN_BUSINESS_TABLES.map((table) => ({ table, count: -1, digest: "a".repeat(32) })),
    })))
      .rejects.toThrow("business snapshot unavailable");
    await expect(readKithInnBusinessSnapshot(async () => ({
      rows: KITH_INN_BUSINESS_TABLES.map((table) => ({ table, count: 1, digest: "not-a-digest" })),
    })))
      .rejects.toThrow("business snapshot unavailable");
  });
});
