import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildConfig, getPayload, handleEndpoints, type CollectionConfig, type Field } from "payload";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { expect, it } from "vitest";
import { HttpLegacyBackend } from "../src/legacy";
import { activityTypes, type LegacyActivity } from "../src/records/types";
import { emptyDailyMetrics } from "../src/records/statistics";

it("round-trips record edits and snapshot conditions through actual Payload REST and isolated SQLite", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bubu-legacy-rest-"));
  const key = randomUUID();
  const access: CollectionConfig["access"] = { read: ({ req }) => !!req.user, create: ({ req }) => !!req.user, update: ({ req }) => !!req.user, delete: ({ req }) => !!req.user };
  const select = (name: string, options: string[]): Field => ({ name, type: "select", options });
  const activityFields: Field[] = [
    { name: "id", type: "text", required: true }, { name: "babyId", type: "text", required: true },
    { name: "type", type: "select", required: true, options: [...activityTypes] },
    { name: "startTime", type: "date", required: true }, { name: "endTime", type: "date" },
    ...["hasPoop", "hasPee", "burpSuccess"].map(name => ({ name, type: "checkbox" } as Field)),
    ...["milkAmount", "count"].map(name => ({ name, type: "number", min: 0 } as Field)),
    ...["poopPhotoUrl", "notes"].map(name => ({ name, type: "text" } as Field)),
    select("milkSource", ["BREAST_MILK", "FORMULA"]), select("breastFirmness", ["SOFT", "ELASTIC", "HARD"]),
    select("poopColor", ["YELLOW", "GREEN", "BROWN", "BLACK", "WHITE", "RED"]), select("peeAmount", ["SMALL", "MEDIUM", "LARGE"]),
    select("supplementType", ["AD", "D3", "PROBIOTICS", "PREBIOTICS"]), select("spitUpType", ["NORMAL", "PROJECTILE"]),
  ];
  const config = await buildConfig({ secret: "isolated-synthetic-legacy-rest-secret", telemetry: false, typescript: { autoGenerate: false },
    db: sqliteAdapter({ client: { url: `file:${directory}/legacy-test.db` }, push: true, transactionOptions: {} }),
    collections: [{ slug: "cms-admins", auth: true, fields: [] }, { slug: "activities", access, fields: activityFields },
      { slug: "daily-stats", access, fields: [{ name: "id", type: "text" }, { name: "babyId", type: "text", required: true }, { name: "date", type: "date", required: true }, ...Object.keys(emptyDailyMetrics()).map(name => ({ name, type: "number", required: true, min: 0 } as Field))] }],
  });
  const payload = await getPayload({ config, key });
  try {
    await payload.create({ collection: "cms-admins", data: { email: "test@example.test", password: "Synthetic-only-password-123!" } });
    const backend = new HttpLegacyBackend({ origin: "https://legacy.example.test", cmsEmail: "test@example.test", cmsPassword: "Synthetic-only-password-123!",
      fetch: async (input, init) => handleEndpoints({ config, payloadInstanceCacheKey: key, request: new Request(input, init) }) });
    const original: LegacyActivity = { id: "stable", babyId: "baby-1", type: "SUPPLEMENT", startTime: "2026-10-22T02:00:00.000Z", endTime: "2026-10-22T02:00:00.000Z", supplementType: "AD" };
    const created = await backend.writeActivity("baby-1", original.id, original, null);
    expect(created?.supplementType).toBe("AD");
    const changed = await backend.writeActivity("baby-1", original.id, { ...created!, supplementType: "PROBIOTICS" }, created);
    expect(changed?.supplementType).toBe("PROBIOTICS");
    await expect(backend.writeActivity("baby-1", original.id, { ...created!, supplementType: "D3" }, created)).rejects.toMatchObject({ code: "LEGACY_VERSION_CONFLICT" });
    const spitUp = await backend.writeActivity("baby-1", original.id, { ...changed!, type: "SPIT_UP", supplementType: undefined, spitUpType: "NORMAL" }, changed);
    expect(spitUp?.supplementType).toBeNull(); expect(spitUp?.spitUpType).toBe("NORMAL");
    expect(await backend.listActivities("baby-1")).toHaveLength(1);
    await backend.saveDailyStats("baby-1", "2026-10-22", { ...emptyDailyMetrics(), spitUpCount: 1 });
    const stored = await payload.find({ collection: "daily-stats", pagination: false, limit: 0 });
    expect(stored.docs).toHaveLength(1); expect(stored.docs[0]?.spitUpCount).toBe(1);
    expect(await backend.writeActivity("baby-1", original.id, null, spitUp)).toBeNull();
    expect(await backend.listActivities("baby-1")).toEqual([]);
  } finally { await payload.destroy(); await rm(directory, { recursive: true, force: true }); }
}, 30_000);
