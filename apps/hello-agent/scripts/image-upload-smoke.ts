import assert from "node:assert/strict";
import sharp from "sharp";

// 使用程序生成的测试图片走真实小程序上传接口，不读取用户相册或聊天内容。
const origin = process.env.HELLO_ORIGIN;
if (!origin) throw new Error("请显式提供 HELLO_ORIGIN");
const identity = await fetch(`${origin}/api/hello/miniapp-identity`, { method: "POST" });
assert.equal(identity.status, 200, "小程序测试身份应创建成功");
const { token } = await identity.json();
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
let failed = false;
// 固定种子的纹理模拟手机照片，覆盖纯色缩略图未能覆盖的真实体积。
const pixels = Buffer.alloc(1200 * 1600 * 3);
let seed = 42;
for (let i = 0; i < pixels.length; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  pixels[i] = seed >>> 24;
}
const fixtures = [
  { name: "small-png", image: await sharp({ create: { width: 128, height: 128, channels: 3, background: "#ef5934" } }).png().toBuffer() },
  { name: "phone-jpeg", image: await sharp(pixels, { raw: { width: 1200, height: 1600, channels: 3 } }).jpeg({ quality: 85 }).toBuffer() },
  { name: "phone-webp", image: await sharp(pixels, { raw: { width: 1200, height: 1600, channels: 3 } }).webp().toBuffer() },
];
for (const { name, image } of fixtures) {
  const response = await fetch(`${origin}/api/hello/upload`, {
    method: "POST", headers, body: JSON.stringify({ base64: image.toString("base64") }),
  });
  const data = await response.json();
  console.log(`${name} (${image.length} 字节) → HTTP ${response.status}${data.error ? `，${data.error}` : ""}`);
  if (response.status !== 200) { failed = true; continue; }
  const download: Response = await fetch(`${origin}/api/hello/media/${data.id}`, { headers });
  assert.equal(download.status, 200, "上传后应能读取图片");
  assert.ok((await sharp(Buffer.from(await download.arrayBuffer())).metadata()).width);
}
assert.equal(failed, false, "普通 PNG、JPEG、WebP 图片应当上传成功，而不是显示服务不可用");
