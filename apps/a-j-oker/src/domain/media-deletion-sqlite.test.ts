import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BasePayload, buildConfig, type Payload } from "payload";
import { sqliteAdapter, type MigrateUpArgs } from "@payloadcms/db-sqlite";
import { expect, it, vi } from "vitest";
import { Repository } from "../cms/repository";
import { MediaService } from "./media";
import { MAX_STORED_IMAGE_BASE64_LENGTH } from "./media-policy";
import { up as initial } from "../cms/migrations/20260930_123608_initial_preview";
import { up as images } from "../cms/migrations/20261002_014226_private_image_objects";

it("实际 SQLite 分批投影删除图片，不读取正文且保留其他身份", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "hello-media-erasure-"));
  let payload: Payload | undefined;
  try {
    payload = await new BasePayload().init({ config: buildConfig({ secret: "isolated-media-test", telemetry: false,
      db: sqliteAdapter({ client: { url: `file:${directory}/media.db` }, push: false, transactionOptions: {} }),
      collections: [{ slug: "admins", auth: true, fields: [] }, { slug: "media", fields: [{ name: "owner", type: "text" }, { name: "mimeType", type: "text" }, { name: "base64", type: "textarea", maxLength: MAX_STORED_IMAGE_BASE64_LENGTH }, { name: "object", type: "json" }] }],
    }) });
    await payload.db.migrate({ migrations: [initial, images].map((up, index) => ({ name: `media_test_${index}`, up: (args: unknown) => up(args as MigrateUpArgs), down: async () => {} })) });
    for (let index = 0; index < 106; index++) await payload.create({ collection: "media", overrideAccess: true, data: { owner: index < 105 ? "erase" : "keep", mimeType: "image/jpeg", base64: "A".repeat(65536) } });
    const originalFind = payload.db.find.bind(payload.db);
    const reads = vi.spyOn(payload.db, "find").mockImplementation(async (options) => {
      if (options.collection === "media") {
        expect(options.select).toBeDefined();
        expect(options.select).not.toHaveProperty("base64");
        expect(options.select?.object || options.select?.owner).toBe(true);
      }
      return originalFind(options);
    });
    try { await new MediaService(new Repository(payload, { id: "erase", auth: "cookie" }), () => undefined).deleteAll(); }
    finally { reads.mockRestore(); }
    const remaining = await payload.find({ collection: "media", overrideAccess: true });
    expect(remaining.docs).toHaveLength(1);
    expect(remaining.docs[0]).toMatchObject({ owner: "keep", base64: "A".repeat(65536) });
  } finally { await payload?.destroy(); await rm(directory, { recursive: true, force: true }); }
}, 15_000);
