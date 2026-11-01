import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { sanitizeAttachment } from "../src/records/attachments";
import { decryptMedia, encryptMedia } from "../src/privacy/media-encryption";

describe("private image content and encryption", () => {
  it("removes EXIF and orientation metadata while retaining decoded image content", async () => {
    const original = await sharp({ create: { width: 8, height: 4, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: "private photographer", ImageDescription: "private note" } }).toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const result = await sanitizeAttachment(original, "image/jpeg");
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.exif).toBeUndefined(); expect(metadata.xmp).toBeUndefined(); expect(metadata.icc).toBeUndefined();
    expect(metadata.orientation).toBeUndefined(); expect(metadata.width).toBe(4); expect(metadata.height).toBe(8);
    expect(result.bytes.includes(Buffer.from("private photographer"))).toBe(false);
  });
  it("authenticates ciphertext, scope and key, uses fresh nonces, and rejects plaintext", () => {
    const key = Buffer.alloc(32, 7), other = Buffer.alloc(32, 8), plain = Buffer.from("private image pixels");
    const first = encryptMedia(plain, key, "baby-a:sha"), second = encryptMedia(plain, key, "baby-a:sha");
    expect(first.equals(second)).toBe(false); expect(first.includes(plain)).toBe(false);
    expect(decryptMedia(first, key, "baby-a:sha")).toEqual(plain);
    expect(() => decryptMedia(first, other, "baby-a:sha")).toThrow();
    expect(() => decryptMedia(first, key, "baby-b:sha")).toThrow();
    const corrupt = Buffer.from(first); corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    expect(() => decryptMedia(corrupt, key, "baby-a:sha")).toThrow();
    expect(() => decryptMedia(plain, key, "baby-a:sha")).toThrow();
  });
});
