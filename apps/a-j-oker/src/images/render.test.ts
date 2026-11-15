import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { generatedJpeg } from "./render";
import { MAX_STORED_IMAGE_BYTES } from "../domain/media-policy";
import { uploadedAiXmp } from "../labeling/upload-provenance";
import { aiMetadata, labelPng } from "../labeling/metadata";

describe("生成图片保存格式与标识", () => {
  it.each(["#111111", "#ffffff"])("图内水印在 %s 背景可见，不增加白边或改变尺寸，并保留 AIGC 来源", async (background) => {
    const source = await sharp({ create: { width: 1280, height: 1280, channels: 3, background } }).png().toBuffer();
    const image = await generatedJpeg(source, "test-turn-1");
    const metadata = await sharp(image).metadata();
    expect(metadata).toMatchObject({ format: "jpeg", width: 1280, height: 1280 });
    expect(image.length).toBeLessThanOrEqual(MAX_STORED_IMAGE_BYTES);
    expect(metadata.exif).toBeUndefined();
    expect(await uploadedAiXmp(image)).toContain("AIGC");
    const corner = await sharp(await sharp(image).extract({ left: 1030, top: 1200, width: 250, height: 80 }).toBuffer()).stats();
    expect(corner.channels[0].max - corner.channels[0].min).toBeGreaterThan(60);
    const untouched = await sharp(await sharp(image).extract({ left: 0, top: 1200, width: 800, height: 80 }).toBuffer()).stats();
    expect(untouched.channels[0].stdev).toBeLessThan(1);
    expect(untouched.channels[0].mean).toBeCloseTo(background === "#ffffff" ? 255 : 17, 0);
  });
  it("不会把无效供应商数据伪装为成功图片", async () => {
    await expect(generatedJpeg(Buffer.from("not-an-image"), "test")).rejects.toThrow("格式无效");
  });
  it("保留万相双层 JSON 编码的平铺 AIGC 来源，包括原始签名", async () => {
    const source = await sharp({ create: { width: 1280, height: 1280, channels: 3, background: "#ff7755" } }).png().toBuffer();
    const label = { ...aiMetadata("synthetic-wan-source").AIGC, ContentProducer: "synthetic-supplier", ReservedCode1: "original-signature+/=", ReservedCode2: "original-signature+/=" };
    const tagged = labelPng(source, { AIGC: label });
    const oldLength = tagged.readUInt32BE(33);
    const data = Buffer.concat([Buffer.from("AIGC\0\0\0\0\0"), Buffer.from(JSON.stringify(JSON.stringify(label)))]);
    const chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length); chunk.write("iTXt", 4); data.copy(chunk, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, data.length + 8)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
    const vendorPng = Buffer.concat([tagged.subarray(0, 33), chunk, tagged.subarray(33 + oldLength + 12)]);
    const image = await generatedJpeg(vendorPng, "platform-turn");
    const xmp = await uploadedAiXmp(image);
    expect(xmp).toContain("synthetic-supplier");
    expect(xmp).toContain(label.ProduceID);
    expect(xmp?.match(/original-signature\+\/=/g)).toHaveLength(2);
  });
});
