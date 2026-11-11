import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { ExactLocalMediaResolver } from "../src/collector/media";
import type { SourceMessage } from "../src/collector/types";
import { inspectAttachment } from "../src/records/attachments";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function temp() { const directory = await mkdtemp(path.join(tmpdir(), "bubu-collector-media-")); directories.push(directory); return directory; }
const sourceMessage = (sourceId: string): SourceMessage => ({
  sourceId, accountId: "fixture-account", groupId: "wechat:fixture-account:fixture@chatroom", chatId: "fixture@chatroom",
  databaseId: "message/message_0.db", tableName: "Msg_fixture", localId: 1,
  sentAt: "2026-11-11T00:00:01Z", senderId: "fixture-sender", kind: "image", text: "[image]",
  media: [{ sourceId, kind: "image", state: "unresolved", reason: "EXACT_PATH_REQUIRED" }],
});

// A fixed xorshift stream makes every large fixture reproducible without using
// a real child image or OS-dependent randomness.
async function syntheticPng(width: number, height: number, alpha: "opaque" | "mixed" | "opaque-alpha") {
  const channels = alpha === "opaque" ? 3 : 4;
  const pixels = Buffer.allocUnsafe(width * height * channels);
  let state = 0x12345678;
  const next = () => {
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return state;
  };
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * channels;
    pixels[offset] = next();
    pixels[offset + 1] = next();
    pixels[offset + 2] = next();
    if (channels === 4) pixels[offset + 3] = alpha === "opaque-alpha" ? 255 : pixel % 7 === 0 ? 128 : 255;
  }
  return sharp(pixels, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toBuffer();
}
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("collector media transport optimization", () => {
  it("checks the exact original hash before decoding or transforming", async () => {
    const root = await temp(), original = Buffer.from("not an image, but an exact local fixture");
    const file = path.join(root, "mismatch.png");
    await writeFile(file, original);
    const message = sourceMessage("hash-before-transform");
    const result = await new ExactLocalMediaResolver({ roots: [root], mappings: [{ sourceId: message.sourceId, index: 0, path: file, sha256: "0".repeat(64) }] }).resolve(message, 0);
    expect(result).toEqual({ available: false, reason: "MEDIA_MAPPING_HASH_MISMATCH" });
    expect(await readFile(file)).toEqual(original);
  });

  it("keeps a small synthetic screenshot byte-for-byte in PNG", async () => {
    const root = await temp(), original = await syntheticPng(96, 64, "opaque"), file = path.join(root, "small.png");
    await writeFile(file, original);
    const message = sourceMessage("small-png");
    const result = await new ExactLocalMediaResolver({ roots: [root], mappings: [{ sourceId: message.sourceId, index: 0, path: file, sha256: sha256(original) }] }).resolve(message, 0);
    expect(result).toEqual({ available: true, bytes: original, mime: "image/png" });
    expect(await readFile(file)).toEqual(original);
  });

  it("keeps a large non-opaque PNG byte-for-byte", async () => {
    const root = await temp(), original = await syntheticPng(1200, 1000, "mixed"), file = path.join(root, "transparent.png");
    await writeFile(file, original);
    expect(original.length).toBeGreaterThan(1024 * 1024);
    const message = sourceMessage("nonopaque-png");
    const result = await new ExactLocalMediaResolver({ roots: [root], mappings: [{ sourceId: message.sourceId, index: 0, path: file, sha256: sha256(original) }] }).resolve(message, 0);
    expect(result).toEqual({ available: true, bytes: original, mime: "image/png" });
    expect(await readFile(file)).toEqual(original);
  }, 20_000);

  it("keeps a large all-opaque RGBA PNG byte-for-byte", async () => {
    const root = await temp(), original = await syntheticPng(1200, 1000, "opaque-alpha"), file = path.join(root, "opaque-alpha.png");
    await writeFile(file, original);
    expect(original.length).toBeGreaterThan(1024 * 1024);
    const message = sourceMessage("opaque-alpha-png");
    const result = await new ExactLocalMediaResolver({ roots: [root], mappings: [{ sourceId: message.sourceId, index: 0, path: file, sha256: sha256(original) }] }).resolve(message, 0);
    expect(result).toEqual({ available: true, bytes: original, mime: "image/png" });
    expect(await readFile(file)).toEqual(original);
  }, 20_000);

  it("transports a large opaque noisy PNG as validated geometry-preserving JPEG", async () => {
    const root = await temp(), original = await syntheticPng(2049, 1200, "opaque"), file = path.join(root, "noisy.png");
    await writeFile(file, original);
    expect(original.length).toBeGreaterThan(1024 * 1024);
    expect(original.length).toBeLessThanOrEqual(10 * 1024 * 1024);
    const message = sourceMessage("opaque-png");
    const result = await new ExactLocalMediaResolver({ roots: [root], mappings: [{ sourceId: message.sourceId, index: 0, path: file, sha256: sha256(original) }] }).resolve(message, 0);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error(result.reason);
    expect(result.mime).toBe("image/jpeg");
    expect(result.bytes.length).toBeLessThan(original.length);
    await expect(inspectAttachment(result.bytes, result.mime)).resolves.toBe("image/jpeg");
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata).toMatchObject({ format: "jpeg", width: 2048, height: 1199, hasAlpha: false });
    expect(await readFile(file)).toEqual(original);
  }, 20_000);

  it("does not alter existing JPEG or WebP transport", async () => {
    const root = await temp(), base = sourceMessage("existing-formats"), message = { ...base, media: [base.media[0]!, { ...base.media[0]! }] };
    const originalJpeg = await syntheticPng(24, 16, "opaque").then(bytes => sharp(bytes).jpeg({ quality: 90 }).toBuffer());
    const originalWebp = await syntheticPng(24, 16, "opaque").then(bytes => sharp(bytes).webp({ lossless: true }).toBuffer());
    await writeFile(path.join(root, "existing.jpg"), originalJpeg);
    await writeFile(path.join(root, "existing.webp"), originalWebp);
    const resolver = new ExactLocalMediaResolver({
      roots: [root],
      mappings: [
        { sourceId: message.sourceId, index: 0, path: path.join(root, "existing.jpg"), sha256: sha256(originalJpeg) },
        { sourceId: message.sourceId, index: 1, path: path.join(root, "existing.webp"), sha256: sha256(originalWebp) },
      ],
    });
    expect(await resolver.resolve(message, 0)).toEqual({ available: true, bytes: originalJpeg, mime: "image/jpeg" });
    expect(await resolver.resolve(message, 1)).toEqual({ available: true, bytes: originalWebp, mime: "image/webp" });
    expect(await readFile(path.join(root, "existing.jpg"))).toEqual(originalJpeg);
    expect(await readFile(path.join(root, "existing.webp"))).toEqual(originalWebp);
  });
});
