import { deflateSync, inflateSync } from "node:zlib";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { uploadedAiXmp } from "./upload-provenance";
import { aiMetadata } from "./metadata";

vi.mock("node:zlib", async (original) => {
  const zlib = await original<typeof import("node:zlib")>();
  return { ...zlib, inflateSync: vi.fn(zlib.inflateSync) };
});
afterEach(() => vi.clearAllMocks());

function chunk(type: string, data: Buffer) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4);
  return bytes;
}
function textChunk(text: string, type = "zTXt", keyword = "AIGC") {
  const prefix = Buffer.from(keyword + (type === "zTXt" ? "\0\0" : type === "iTXt" ? "\0\x01\0\0\0" : "\0"));
  return chunk(type, Buffer.concat([prefix, type === "tEXt" ? Buffer.from(text) : deflateSync(text)]));
}
async function png(chunks: Buffer[]) {
  const base = await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  return Buffer.concat([base.subarray(0, 33), ...chunks, base.subarray(33)]);
}
it.each(["zTXt", "iTXt", "tEXt"])("保留单个有效 %s 来源标识", async (type) => {
  expect(await uploadedAiXmp(await png([textChunk(JSON.stringify(aiMetadata("source")), type)]))).toContain("AIGC");
});
it("数千个压缩来源标识在任何解压前被拒绝", async () => {
  const duplicate = textChunk(" ".repeat(16 * 1024));
  await expect(uploadedAiXmp(await png(Array(2000).fill(duplicate)))).rejects.toThrow("来源标识无法完整保留");
  expect(inflateSync).not.toHaveBeenCalled();
});
it("累计编码体积在任何解压前受限，即使来源标识唯一", async () => {
  const chunks = [textChunk(JSON.stringify(aiMetadata("one"))), textChunk("x".repeat(64 * 1024), "tEXt", "Comment")];
  await expect(uploadedAiXmp(await png(chunks))).rejects.toThrow("来源标识无法完整保留");
  expect(inflateSync).not.toHaveBeenCalled();
});
it.each(["zTXt", "iTXt"])("单个 %s 来源标识解压不能超过 16 KiB", async (type) => {
  await expect(uploadedAiXmp(await png([textChunk("x".repeat(16 * 1024 + 1), type)]))).rejects.toThrow("来源标识无法完整保留");
  expect(inflateSync).toHaveBeenCalledExactlyOnceWith(expect.any(Buffer), { maxOutputLength: 16 * 1024 });
});
it("非来源文本也共享 64 KiB 解压预算，不能绕过后交给图片解码器", async () => {
  const chunks = [textChunk("x".repeat(40 * 1024), "zTXt", "Comment"), textChunk("y".repeat(40 * 1024), "zTXt", "Description")];
  await expect(uploadedAiXmp(await png(chunks))).rejects.toThrow("来源标识无法完整保留");
  expect(inflateSync).toHaveBeenNthCalledWith(1, expect.any(Buffer), { maxOutputLength: 64 * 1024 });
  expect(inflateSync).toHaveBeenNthCalledWith(2, expect.any(Buffer), { maxOutputLength: 24 * 1024 });
});
