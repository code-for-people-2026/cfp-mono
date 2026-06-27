import { describe, expect, it, vi } from "vitest";
import type { Field } from "payload";
import { assertSameTenantRefs, collectRelationshipRefs } from "./assertSameTenantRefs";

const rel = (name: string, relationTo: string | string[]): Field =>
  ({ name, type: "relationship", relationTo }) as Field;
const text = (name: string): Field => ({ name, type: "text" }) as Field;

describe("collectRelationshipRefs", () => {
  it("returns nothing without data or fields", () => {
    expect(collectRelationshipRefs(undefined, [rel("seller", "sellers")])).toEqual([]);
    expect(collectRelationshipRefs({ seller: 1 }, undefined)).toEqual([]);
  });

  it("collects a single relationship id", () => {
    expect(collectRelationshipRefs({ customer: 7 }, [rel("customer", "customers")])).toEqual([
      { relationTo: "customers", id: 7 },
    ]);
  });

  it("flattens an array of relationship ids", () => {
    expect(
      collectRelationshipRefs({ offerings: [1, 2] }, [rel("offerings", "offerings")]),
    ).toEqual([
      { relationTo: "offerings", id: 1 },
      { relationTo: "offerings", id: 2 },
    ]);
  });

  it("extracts the id from a populated `{ id }` value", () => {
    expect(
      collectRelationshipRefs({ customer: { id: 9, name: "x" } }, [rel("customer", "customers")]),
    ).toEqual([{ relationTo: "customers", id: 9 }]);
  });

  it("reads a polymorphic relationship's embedded target + value (not fanned out)", () => {
    // Payload stores polymorphic refs as { relationTo, value } — the chosen
    // target is embedded, NOT one-ref-per-allowed-target.
    const fields = [rel("target", ["customers", "sellers"])];
    expect(
      collectRelationshipRefs({ target: { relationTo: "customers", value: 5 } }, fields),
    ).toEqual([{ relationTo: "customers", id: 5 }]);
    expect(
      collectRelationshipRefs({ target: { relationTo: "sellers", value: { id: 9 } } }, fields),
    ).toEqual([{ relationTo: "sellers", id: 9 }]);
  });

  it("skips a polymorphic value missing the embedded relationTo", () => {
    expect(
      collectRelationshipRefs({ target: { value: 5 } }, [rel("target", ["customers", "sellers"])]),
    ).toEqual([]);
  });

  it("skips polymorphic values with a non-string target or an unreadable value id", () => {
    const fields = [rel("target", ["customers", "sellers"])];
    // target isn't a string (malformed) → skip
    expect(collectRelationshipRefs({ target: { relationTo: 123, value: 5 } }, fields)).toEqual([]);
    // target ok but value has no readable id → skip
    expect(
      collectRelationshipRefs({ target: { relationTo: "customers", value: { noId: 1 } } }, fields),
    ).toEqual([]);
  });

  it("skips a populated doc whose id is not a string/number", () => {
    expect(
      collectRelationshipRefs({ customer: { id: true } }, [rel("customer", "customers")]),
    ).toEqual([]);
  });

  it("ignores non-relationship fields, null values, and fields absent from data", () => {
    const fields = [text("name"), rel("customer", "customers"), rel("absent", "customers")];
    expect(collectRelationshipRefs({ name: "x", customer: null }, fields)).toEqual([
      // name: text (not relationship); customer: null (not an id); absent: field
      // exists in config but the key is absent from data — all skipped.
    ]);
  });

  it("skips values that are neither an id nor a populated doc", () => {
    expect(
      collectRelationshipRefs({ customer: { foo: 1 } }, [rel("customer", "customers")]),
    ).toEqual([]);
  });
});

describe("assertSameTenantRefs", () => {
  const fields = [rel("seller", "sellers"), rel("customer", "customers")];
  const collection = { slug: "orders", fields };

  const makeReq = (
    user: unknown,
    docs: Record<string, Record<string, unknown>>,
  ) => ({
    user,
    payload: {
      findByID: vi.fn(async ({ collection, id }: { collection: string; id: string | number }) =>
        docs[`${collection}:${id}`] ?? null,
      ),
    },
  });

  const operator = (seller: unknown) => ({ seller, active: true, role: "owner" as const });

  it("is a no-op when there is no operator (access layer handles)", async () => {
    const req = makeReq(undefined, {});
    const data = { customer: 7 };
    const result = await assertSameTenantRefs({ data, req, collection });
    expect(result).toEqual(data);
    expect(req.payload.findByID).not.toHaveBeenCalled();
  });

  it("passes when refs point at the operator's own seller", async () => {
    const req = makeReq(operator(1), {
      "customers:7": { id: 7, seller: 1 }, // same seller
      // sellers:1 has no seller field (it IS the tenant root) → skipped
    });
    await expect(
      assertSameTenantRefs({ data: { customer: 7 }, req, collection }),
    ).resolves.toBeDefined();
  });

  it("blocks a cross-tenant reference", async () => {
    const req = makeReq(operator(1), { "customers:9": { id: 9, seller: 2 } }); // different seller
    await expect(
      assertSameTenantRefs({ data: { customer: 9 }, req, collection }),
    ).rejects.toThrow(/cross-tenant reference blocked: orders → customers:9/);
  });

  it("skips a referenced doc that has no seller field (non-tenant target)", async () => {
    const req = makeReq(operator(1), { "customers:7": { id: 7, note: "no seller here" } });
    await expect(
      assertSameTenantRefs({ data: { customer: 7 }, req, collection }),
    ).resolves.toBeDefined();
  });

  it("skips a referenced doc whose seller is unreadable", async () => {
    const req = makeReq(operator(1), { "customers:7": { id: 7, seller: { noId: true } } });
    await expect(
      assertSameTenantRefs({ data: { customer: 7 }, req, collection }),
    ).resolves.toBeDefined();
  });

  it("skips a referenced doc that does not exist (null)", async () => {
    const req = makeReq(operator(1), {}); // findByID → null
    await expect(
      assertSameTenantRefs({ data: { customer: 99 }, req, collection }),
    ).resolves.toBeDefined();
  });

  it("handles missing data (treats as empty)", async () => {
    const req = makeReq(operator(1), {});
    await expect(
      assertSameTenantRefs({ data: undefined, req, collection }),
    ).resolves.toEqual({});
  });
});
