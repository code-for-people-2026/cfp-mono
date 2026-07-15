import { describe, expect, it, vi } from "vitest";
import { createBusinessSnapshot, type SnapshotClient } from "../smoke/business-snapshot";

function clientWith(docs: Record<string, unknown[]>): SnapshotClient {
  return {
    find: vi.fn(async ({ collection }) => ({ docs: docs[collection] ?? [] })),
  };
}

describe("kith-inn business snapshot", () => {
  it("rejects a missing provisioning seller id before querying", async () => {
    const client = clientWith({});
    await expect(createBusinessSnapshot(client, "  ")).rejects.toThrow("seller id is required");
    expect(client.find).not.toHaveBeenCalled();
  });

  it("scopes every collection and produces an order-independent digest", async () => {
    const first = clientWith({
      sellers: [{ id: 42, name: "桃子" }],
      offerings: [
        { id: 2, seller: 42, tags: ["午", "晚"], note: null },
        { id: 1, seller: 42, nested: { b: 2, a: 1 } },
      ],
    });
    const second = clientWith({
      sellers: [{ name: "桃子", id: 42 }],
      offerings: [
        { nested: { a: 1, b: 2 }, seller: 42, id: 1 },
        { note: null, tags: ["午", "晚"], seller: 42, id: 2 },
      ],
    });

    const left = await createBusinessSnapshot(first, "42");
    const right = await createBusinessSnapshot(second, "42");

    expect(left).toEqual(right);
    expect(left).toMatchObject({
      schemaVersion: 1,
      sellerId: "42",
      recordCount: 3,
      counts: { sellers: 1, offerings: 2 },
    });
    expect(left.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first.find).toHaveBeenCalledWith(expect.objectContaining({
      collection: "sellers",
      where: { id: { equals: 42 } },
      depth: 0,
      limit: 0,
      overrideAccess: true,
    }));
    expect(first.find).toHaveBeenCalledWith(expect.objectContaining({
      collection: "offerings",
      where: { seller: { equals: 42 } },
    }));

    const stringId = clientWith({ sellers: [{ id: "seller-a" }] });
    await createBusinessSnapshot(stringId, "seller-a");
    expect(stringId.find).toHaveBeenCalledWith(expect.objectContaining({
      collection: "sellers",
      where: { id: { equals: "seller-a" } },
    }));
  });
});
