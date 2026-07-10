import { beforeEach, describe, expect, it, vi } from "vitest";

const seedMocks = vi.hoisted(() => ({
  oldApplySeed: vi.fn(),
  oldResetSeedData: vi.fn(),
  v1ApplySeed: vi.fn(),
}));

vi.mock("@cfp/kith-inn-payload/seed", () => ({
  applySeed: seedMocks.oldApplySeed,
  resetSeedData: seedMocks.oldResetSeedData,
  taoziFixture: { seller: { name: "桃子" }, offerings: [] },
}));

vi.mock("@cfp/kith-inn-v1-payload/seed", () => ({
  applySeed: seedMocks.v1ApplySeed,
  RESET_COLLECTIONS: [
    "kiv1_orders",
    "kiv1_booking_batches",
    "kiv1_meal_slots",
    "kiv1_customer_profiles",
    "kiv1_offerings",
    "kiv1_operators",
    "kiv1_sellers",
  ],
}));

import {
  applyAllSeeds,
  assertDevResetAllowed,
  configuredPostgresUrl,
  resetAllSeedData,
} from "../seed/run";

const allow = { KITH_INN_ALLOW_DEV_SEED_RESET: "1" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("shared seed orchestration", () => {
  it("runs the old seed before v1 and returns both seeded/skipped results", async () => {
    const oldResult = { seeded: false, offeringCount: 0 };
    const v1Result = {
      seeded: true,
      sellerId: 2,
      sellerCreated: true,
      operatorCreated: true,
    };
    seedMocks.oldApplySeed.mockResolvedValue(oldResult);
    seedMocks.v1ApplySeed.mockResolvedValue(v1Result);

    const payload = {};
    await expect(applyAllSeeds(payload)).resolves.toEqual({
      old: oldResult,
      v1: v1Result,
    });
    expect(seedMocks.oldApplySeed).toHaveBeenCalledWith(payload, expect.anything());
    expect(seedMocks.v1ApplySeed).toHaveBeenCalledWith(payload);
    expect(seedMocks.oldApplySeed.mock.invocationCallOrder[0]).toBeLessThan(
      seedMocks.v1ApplySeed.mock.invocationCallOrder[0]!,
    );
  });

  it("can retry the shared seed after v1 fails", async () => {
    seedMocks.oldApplySeed.mockResolvedValue({ seeded: false, offeringCount: 0 });
    seedMocks.v1ApplySeed
      .mockRejectedValueOnce(new Error("temporary v1 failure"))
      .mockResolvedValueOnce({
        seeded: false,
        sellerId: 2,
        sellerCreated: false,
        operatorCreated: false,
      });

    await expect(applyAllSeeds({})).rejects.toThrow("temporary v1 failure");
    await expect(applyAllSeeds({})).resolves.toMatchObject({
      old: { seeded: false },
      v1: { seeded: false },
    });
    expect(seedMocks.oldApplySeed).toHaveBeenCalledTimes(2);
    expect(seedMocks.v1ApplySeed).toHaveBeenCalledTimes(2);
  });

  it("resets old data first, then deletes every v1 collection in FK-safe order", async () => {
    seedMocks.oldResetSeedData.mockResolvedValue({ deleted: { sellers: 1 } });
    const find = vi.fn(async ({ collection }: { collection: string }) => ({
      docs: [{ id: `${collection}-1` }],
    }));
    const deleteDoc = vi.fn().mockResolvedValue(undefined);
    const payload = { find, delete: deleteDoc };

    await expect(resetAllSeedData(payload)).resolves.toEqual({
      old: { deleted: { sellers: 1 } },
      v1: {
        deleted: {
          kiv1_orders: 1,
          kiv1_booking_batches: 1,
          kiv1_meal_slots: 1,
          kiv1_customer_profiles: 1,
          kiv1_offerings: 1,
          kiv1_operators: 1,
          kiv1_sellers: 1,
        },
      },
    });
    expect(seedMocks.oldResetSeedData).toHaveBeenCalledWith(payload);
    expect(seedMocks.oldResetSeedData.mock.invocationCallOrder[0]).toBeLessThan(
      find.mock.invocationCallOrder[0]!,
    );
    expect(find.mock.calls.map(([args]) => args.collection)).toEqual([
      "kiv1_orders",
      "kiv1_booking_batches",
      "kiv1_meal_slots",
      "kiv1_customer_profiles",
      "kiv1_offerings",
      "kiv1_operators",
      "kiv1_sellers",
    ]);
    expect(deleteDoc.mock.calls.map(([args]) => [args.collection, args.id])).toEqual([
      ["kiv1_orders", "kiv1_orders-1"],
      ["kiv1_booking_batches", "kiv1_booking_batches-1"],
      ["kiv1_meal_slots", "kiv1_meal_slots-1"],
      ["kiv1_customer_profiles", "kiv1_customer_profiles-1"],
      ["kiv1_offerings", "kiv1_offerings-1"],
      ["kiv1_operators", "kiv1_operators-1"],
      ["kiv1_sellers", "kiv1_sellers-1"],
    ]);
  });
});

describe("configuredPostgresUrl", () => {
  it("mirrors Payload's Postgres URL fallback order", () => {
    expect(configuredPostgresUrl({
      DATABASE_URI: "postgresql://uri/db",
      POSTGRES_URL: "postgresql://postgres-url/db",
      POSTGRES_URL_NON_POOLING: "postgresql://non-pooling/db",
      DATABASE_URL_UNPOOLED: "postgresql://unpooled/db",
      DATABASE_URL: "postgresql://database-url/db",
      PAYLOAD_DATABASE_URL: "postgresql://payload/db",
    })).toBe("postgresql://payload/db");
  });

  it("ignores sqlite DATABASE_URI", () => {
    expect(configuredPostgresUrl({ DATABASE_URI: "file:./payload.db" })).toBeUndefined();
  });
});

describe("assertDevResetAllowed", () => {
  it("rejects a remote Postgres URL from fallback env names", () => {
    expect(() => assertDevResetAllowed({
      ...allow,
      POSTGRES_URL: "postgresql://user:pass@db.example.com/cfp",
    })).toThrow(/non-local database URL/);
  });

  it("allows an explicit local dev reset against local Postgres", () => {
    expect(() => assertDevResetAllowed({
      ...allow,
      POSTGRES_URL_NON_POOLING: "postgresql://postgres:postgres@127.0.0.1:54324/cfp",
    })).not.toThrow();
  });

  it("allows sqlite fallback when no Postgres URL is configured", () => {
    expect(() => assertDevResetAllowed({
      ...allow,
      DATABASE_URI: "file:./payload.db",
    })).not.toThrow();
  });
});
