import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ImageObjectStore } from "../src/storage/oss";
import { ScriptedModel } from "./scripted-model";

const dir = await mkdtemp(path.join(tmpdir(), "hello-oss-regression-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/test.db`;
process.env.PAYLOAD_SECRET = "oss-regression-not-for-deployment";
process.env.HELLO_MEDIA_STORAGE = "database";
process.env.DEEPSEEK_API_KEY = "scripted-model-only";
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { MediaService } = await import("../src/domain/media");
const { GreetingService } = await import("../src/domain/greetings");
const { runGreeting } = await import("../src/agent/runtime");
const { createMcpServer } = await import("../src/server/mcp");
const { configuredImageStore } = await import("../src/storage/oss");
const config = await (await import("../payload.config")).default;
const mediaCollection = config.collections.find(
  (collection) => collection.slug === "media",
);
assert.ok(mediaCollection);
let failAfterMediaWrite: number | undefined;
let reachedAfterWrite = false;
// 使用 Payload 公开钩子模拟“数据库已写入、操作尚未提交”时的失败，不替换 Repository。
mediaCollection.hooks.afterChange.push(async ({ doc, operation, req }) => {
  if (operation === "update" && doc.id === failAfterMediaWrite) {
    const written = await req.payload.findByID({
      collection: "media",
      id: doc.id,
      req,
    });
    assert.equal(written.base64, null);
    assert.equal(written.object?.provider, "oss");
    reachedAfterWrite = true;
    throw new Error("injected-image-after-write-failure");
  }
  return doc;
});
const payload = await cms();
const objects = new Map<string, Buffer>();
let reads = 0,
  failPut = false,
  corrupt = false;
const store: ImageObjectStore = {
  bucket: "test-private-bucket",
  region: "oss-cn-shenzhen",
  async put(key, bytes) {
    if (failPut) throw new Error("模拟存储不可用");
    objects.set(key, Buffer.from(bytes));
  },
  async get(key) {
    reads++;
    const bytes = objects.get(key);
    assert.ok(bytes, "对象必须存在");
    return corrupt ? Buffer.from("损坏") : Buffer.from(bytes);
  },
};
try {
  const repo = new Repository(payload, { id: randomUUID(), auth: "miniapp" });
  const media = new MediaService(repo, () => store);
  const model = new ScriptedModel();
  const service = new GreetingService(
    repo,
    (args) => runGreeting(args, model),
    media,
  );
  const original = await sharp({
    create: { width: 256, height: 256, channels: 3, background: "#df573e" },
  })
    .png()
    .toBuffer();
  const saved = await service.upload(original);
  const row = await repo.get("media", saved.id);
  assert.equal(row.base64, null);
  assert.equal(objects.size, 1);
  assert.equal(
    (await sharp((await media.read(saved.id)).bytes).metadata()).width,
    256,
  );
  console.log("✓ 新图片只保存对象引用，读取能还原有效图片");

  const other = new MediaService(
    new Repository(payload, { id: randomUUID(), auth: "miniapp" }),
    () => store,
  );
  const before = reads;
  await assert.rejects(() => other.read(saved.id), { status: 404 });
  assert.equal(reads, before);
  const forged = await other.repo.create("media", {
    mimeType: "image/jpeg",
    object: row.object,
  });
  await assert.rejects(() => other.read(forged.id), /记录无效/);
  assert.equal(reads, before);
  console.log("✓ 跨用户请求、伪造其他用户对象引用，均在访问存储前拒绝");

  const session = await service.createSession();
  await service.generateGreeting({
    sessionId: session.id,
    requestId: randomUUID(),
    mode: "platform",
    input: { mediaIds: [saved.id] },
  });
  assert.ok(
    model.requests[0].contents.some((content) =>
      content.parts?.some((part) => part.inlineData?.data),
    ),
  );
  assert.ok(
    !JSON.stringify(await repo.all("adk-sessions")).includes("inlineData"),
  );
  console.log("✓ ADK 从对象存储读取图片，事件不重复保存图片内容");

  const server = createMcpServer(service);
  const client = new Client({ name: "oss-regression", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const result = await client.callTool({
    name: "hello_get_image",
    arguments: { mediaId: saved.id },
  });
  assert.ok(!result.isError);
  assert.ok(
    JSON.stringify(result.content).includes(
      (await media.read(saved.id)).bytes.toString("base64"),
    ),
  );
  await client.close();
  await server.close();
  console.log("✓ 自带 Agent 的 MCP 图片读取兼容新存储");

  const legacy = await new GreetingService(repo).upload(original);
  const old = await repo.get("media", legacy.id);
  corrupt = true;
  await assert.rejects(() => media.migrate(legacy.id), /完整性/);
  assert.equal((await repo.get("media", legacy.id)).base64, old.base64);
  corrupt = false;
  assert.equal(await media.migrate(legacy.id), true);
  assert.equal(await media.migrate(legacy.id), false);
  assert.deepEqual(
    (await media.read(legacy.id)).bytes,
    Buffer.from(String(old.base64), "base64"),
  );
  assert.equal((await repo.get("media", legacy.id)).base64, null);
  console.log("✓ 迁移校验失败保留原图；成功后清空旧内容且可安全重试");

  const interrupted = await new GreetingService(repo).upload(original);
  const previous = await repo.get("media", interrupted.id);
  const recordsBefore = (await repo.all("media")).length;
  const objectsBefore = objects.size;
  failAfterMediaWrite = interrupted.id;
  await assert.rejects(
    () => media.migrate(interrupted.id),
    /injected-image-after-write-failure/,
  );
  assert.equal(
    reachedAfterWrite,
    true,
    "故障必须发生在图片引用已写入、事务尚未提交之后",
  );
  assert.deepEqual(
    await repo.get("media", interrupted.id),
    previous,
    "保存失败后图片内容、归属、引用和更新时间必须全部回滚",
  );
  assert.deepEqual(
    (await media.read(interrupted.id)).bytes,
    Buffer.from(String(previous.base64), "base64"),
  );
  assert.equal(
    objects.size,
    objectsBefore + 1,
    "保留已上传对象，不因数据库失败误删图片",
  );
  failAfterMediaWrite = undefined;
  const retry = new MediaService(repo, () => store);
  assert.equal(await retry.migrate(interrupted.id), true);
  assert.equal(await retry.migrate(interrupted.id), false);
  assert.equal(
    objects.size,
    objectsBefore + 1,
    "重试复用确定性对象名，不产生重复文件",
  );
  assert.equal(
    (await repo.all("media")).length,
    recordsBefore,
    "重试更新原记录，不新增图片记录",
  );
  assert.equal((await repo.get("media", interrupted.id)).base64, null);
  assert.deepEqual(
    (await retry.read(interrupted.id)).bytes,
    Buffer.from(String(previous.base64), "base64"),
  );
  console.log(
    "✓ OSS 上传后数据库写入中途失败：旧图片完整可读，重试不重复创建记录或文件",
  );

  const count = (await repo.all("media")).length;
  failPut = true;
  await assert.rejects(() => service.upload(original));
  assert.equal((await repo.all("media")).length, count);
  failPut = false;
  corrupt = true;
  await assert.rejects(() => media.read(saved.id), /完整性/);
  corrupt = false;
  await assert.rejects(
    () =>
      new MediaService(repo, () => ({ ...store, bucket: "wrong" })).read(
        saved.id,
      ),
    /配置与记录不一致/,
  );
  process.env.HELLO_MEDIA_STORAGE = "oss";
  delete process.env.HELLO_OSS_ACCESS_KEY_ID;
  delete process.env.HELLO_OSS_ACCESS_KEY_SECRET;
  assert.throws(() => configuredImageStore(), /尚未配置完整/);
  process.env.HELLO_MEDIA_STORAGE = "database";
  console.log("✓ 写入失败不产生成功记录；损坏、错误桶和缺失凭证不会静默降级");

  // 管理后台入口独立验证管理员身份，匿名和普通设备凭证都不能借用。
  const { GET } = await import("../src/app/api/hello-admin/media/[id]/route");
  const { mintCredential } = await import("../src/server/auth");
  const context = { params: Promise.resolve({ id: String(legacy.id) }) };
  assert.equal(
    (
      await GET(
        new Request("http://localhost/api/hello-admin/media/1"),
        context,
      )
    ).status,
    401,
  );
  const device = await mintCredential(payload, "miniapp", repo.owner.id);
  assert.equal(
    (
      await GET(
        new Request("http://localhost/api/hello-admin/media/1", {
          headers: { Authorization: `Bearer ${device.token}` },
        }),
        context,
      )
    ).status,
    401,
  );
  const adminImage = await new GreetingService(repo).upload(original);
  const password = randomUUID();
  await payload.create({
    collection: "admins",
    data: { email: "oss-admin@example.invalid", password },
    context: { helloAdminBootstrap: true },
  });
  const login = await payload.login({
    collection: "admins",
    data: { email: "oss-admin@example.invalid", password },
  });
  const adminResponse = await GET(
    new Request("http://localhost/api/hello-admin/media/1", {
      headers: { Authorization: `JWT ${login.token}` },
    }),
    { params: Promise.resolve({ id: String(adminImage.id) }) },
  );
  assert.equal(adminResponse.status, 200);
  assert.equal(adminResponse.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (await sharp(Buffer.from(await adminResponse.arrayBuffer())).metadata())
      .width,
    256,
  );
  console.log("✓ 后台图片预览验证管理员身份，返回私有不可缓存图片");
} finally {
  await payload.destroy();
}
