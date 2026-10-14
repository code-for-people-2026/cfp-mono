import { createHash, randomUUID } from "node:crypto";
import type { Repository } from "../cms/repository";
import type { Media } from "../payload-types";
import { configuredImageStore, type ImageObjectStore } from "../storage/oss";
import { AppError } from "./contracts";
import { MAX_STORED_IMAGE_BYTES, referenceSchema, type ImageReference } from "./media-policy";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const ownerPrefixFromDigest = (ownerDigest: string) => {
  if (!/^[a-f0-9]{64}$/.test(ownerDigest)) throw new AppError(500, "图片归属摘要无效");
  return `hello-agent/${ownerDigest.slice(0, 32)}/`;
};
const ownerPrefix = (owner: string) => ownerPrefixFromDigest(createHash("sha256").update(owner).digest("hex"));

// Trusted restore maintenance can only recover the digest, not the original
// identity. Purge its prefix even when the database snapshot has no owner row.
export async function deleteMediaObjectsByOwnerDigest(ownerDigest: string, storeFactory = configuredImageStore) {
  const prefix = ownerPrefixFromDigest(ownerDigest);
  const store = storeFactory();
  if (!store) return;
  if (!store.removePrefix) throw new AppError(503, "对象清理功能尚未配置");
  await store.removePrefix(prefix);
}

export class MediaService {
  constructor(readonly repo: Repository, private readonly storeFactory = configuredImageStore) {}

  private async writeObject(store: ImageObjectStore, bytes: Buffer, name: string = randomUUID()): Promise<ImageReference> {
    const reference = referenceSchema.parse({
      provider: "oss", bucket: store.bucket, region: store.region,
      key: `${ownerPrefix(this.repo.owner.id)}${name}.jpg`,
      sha256: digest(bytes), byteLength: bytes.length,
    });
    await store.put(reference.key, bytes);
    return reference;
  }

  async save(bytes: Buffer, generation?: { turnId: number; provider: string; model: string; taskId: string; review?: { decision: string; version: string; category: string } }) {
    if (!bytes.length || bytes.length > MAX_STORED_IMAGE_BYTES)
      throw new AppError(413, "处理后的图片大小无效");
    const lease = await this.repo.create("session-locks", { sessionKey: `upload:${this.repo.owner.id}:${randomUUID()}`, expiresAt: new Date(Date.now() + 180_000).toISOString() });
    try {
    const generationKey = generation ? `${this.repo.owner.id}:${generation.turnId}` : undefined;
    if (generationKey) {
      const existing = (await this.repo.list("media", { generationKey: { equals: generationKey } }, 1))[0];
      if (existing) { await this.read(existing.id); return existing; }
    }
    const store = this.storeFactory();
    const data = store
      ? { object: await this.writeObject(store, bytes, generation ? `${generation.turnId}-${digest(bytes)}` : undefined), base64: null }
      : { base64: bytes.toString("base64") };
    // OSS 与数据库没有跨服务事务；数据库提交结果不明时保留对象，避免误删已引用的图片。
    return await this.repo.create("media", { mimeType: "image/jpeg", ...data, ...(generation ? { generation, generationKey } : {}) });
    } finally { await this.repo.remove("session-locks", lease.id); }
  }

  private async readRow(row: Media) {
    if (row.mimeType !== "image/jpeg" && row.mimeType !== "image/png" && row.mimeType !== "image/webp")
      throw new AppError(500, "图片格式记录无效");
    let bytes: Buffer;
    if (row.object) {
      const parsed = referenceSchema.safeParse(row.object);
      if (!parsed.success || !parsed.data.key.startsWith(ownerPrefix(this.repo.owner.id)))
        throw new AppError(500, "图片存储记录无效");
      const ref = parsed.data;
      const store = this.storeFactory();
      if (!store || store.bucket !== ref.bucket || store.region !== ref.region)
        throw new AppError(503, "图片存储配置与记录不一致");
      bytes = await store.get(ref.key);
      if (bytes.length !== ref.byteLength || digest(bytes) !== ref.sha256)
        throw new AppError(503, "图片完整性校验失败");
    } else {
      if (typeof row.base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.base64))
        throw new AppError(404, "图片内容不存在");
      bytes = Buffer.from(row.base64, "base64");
    }
    if (!bytes.length || bytes.length > MAX_STORED_IMAGE_BYTES)
      throw new AppError(500, "图片大小记录无效");
    return { bytes, mimeType: row.mimeType };
  }

  async read(id: number) {
    // 必须先做 Payload 归属校验，再访问 OSS；对象名不能充当访问凭据。
    return this.readRow(await this.repo.get("media", id));
  }

  private async *deletionPages() {
    let cursor = 0;
    while (true) {
      // Erasure includes isolated media. The owner comes from the authenticated
      // repository (or trusted maintenance), never from request parameters.
      const { docs } = await this.repo.payload.find({ collection: "media", overrideAccess: true, depth: 0, pagination: false, limit: 100, sort: "id", select: { id: true, object: true }, where: { and: [{ owner: { equals: this.repo.owner.id } }, { id: { greater_than: cursor } }] } });
      if (!docs.length) return;
      yield docs;
      cursor = docs[docs.length - 1].id;
      if (docs.length < 100) return;
    }
  }

  async deleteAll() {
    const store = this.storeFactory();
    // Validate every reference before removing any object, without retaining
    // image bodies or an unbounded list of IDs. Deletion freezes new uploads.
    for await (const rows of this.deletionPages()) for (const row of rows) {
      if (!row.object) continue;
      const reference = referenceSchema.parse(row.object);
      if (!reference.key.startsWith(ownerPrefix(this.repo.owner.id))) throw new AppError(500, "图片归属异常，删除已暂停");
      if (!store || store.bucket !== reference.bucket || store.region !== reference.region || !store.removePrefix) throw new AppError(503, "图片删除配置不完整，记录已保留供重试");
    }
    await deleteMediaObjectsByOwnerDigest(createHash("sha256").update(this.repo.owner.id).digest("hex"), () => store);
    for await (const rows of this.deletionPages()) {
      const result = await this.repo.payload.delete({ collection: "media", overrideAccess: true, depth: 0, select: { owner: true }, where: { and: [{ owner: { equals: this.repo.owner.id } }, { id: { in: rows.map((row) => row.id) } }] } });
      if (result.errors.length) throw new AppError(503, "部分图片记录尚未删除，请稍后重试");
    }
  }

  async migrate(id: number) {
    const row = await this.repo.get("media", id);
    if (row.object) {
      await this.readRow(row);
      return false;
    }
    const store = this.storeFactory();
    if (!store) throw new AppError(503, "迁移需要配置 OSS");
    const { bytes } = await this.readRow(row);
    // 确定性对象名使迁移可重试；不会覆盖其他记录或重新编码历史图片。
    const object = await this.writeObject(store, bytes, `${id}-${digest(bytes)}`);
    await this.readRow({ ...row, object });
    await this.repo.update("media", id, { object, base64: null });
    return true;
  }
}
