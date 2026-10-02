import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

// 独立临时数据库：不接触本机或线上用户数据。
const dir = await mkdtemp(path.join(tmpdir(), "hello-image-regression-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/test.db`;
process.env.PAYLOAD_SECRET = "image-regression-not-for-deployment";
process.env.HELLO_ADMIN_BOOTSTRAP = "false";
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { MAX_STORED_IMAGE_BASE64_LENGTH } = await import("../src/domain/media-policy");
const payload = await cms();
const service = new GreetingService(new Repository(payload, { id: randomUUID(), auth: "miniapp" }));
let failed = false;
try {
  for (const width of [128, 256, 512]) {
    const pixels = Buffer.alloc(width * width * 3);
    let seed = 42;
    for (let i = 0; i < pixels.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[i] = seed >>> 24;
    }
    const image = await sharp(pixels, { raw: { width, height: width, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
    try {
      const saved = await service.upload(image);
      const row = await service.repo.get("media", saved.id);
      assert.equal(row.mimeType, "image/jpeg");
      const metadata = await sharp(Buffer.from(String(row.base64), "base64")).metadata();
      assert.equal(metadata.width, width);
      assert.equal(metadata.height, width);
      if (width >= 256) assert.ok(String(row.base64).length > 40_000, "回归样例必须覆盖旧的字段上限");
      console.log(`${width}px / ${image.length} 字节：保存成功，存储字符 ${String(row.base64).length}`);
    } catch (error) {
      failed = true;
      // 不输出原始错误、SQL、图片或请求，只显示字段验证摘要。
      const safe = error as { name?: string; data?: { errors?: { path?: string; message?: string }[] } };
      console.log(`${width}px / ${image.length} 字节：${safe.name}，${JSON.stringify(safe.data?.errors?.map(({ path, message }) => ({ path, message })))}`);
    }
  }
  assert.equal(failed, false, "正常手机照片必须能经过真实 Payload 保存并读取");
  await assert.rejects(() => service.upload(Buffer.alloc(5 * 1024 * 1024 + 1)), { status: 413 });
  await assert.rejects(() => service.upload(Buffer.from("这不是图片")), { status: 400 });
  await assert.rejects(() => service.repo.create("media", {
    mimeType: "image/jpeg", base64: "A".repeat(MAX_STORED_IMAGE_BASE64_LENGTH + 1),
  }), { name: "ValidationError" });
  console.log("原图体积、无效格式和 CMS 字段上限仍受到限制。");
} finally {
  await payload.destroy();
}
