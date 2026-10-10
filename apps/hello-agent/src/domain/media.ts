import { createHash, randomUUID } from "node:crypto";
import type { Repository } from "../cms/repository";
import type { Media } from "../payload-types";
import { configuredImageStore, type ImageObjectStore } from "../storage/oss";
import { AppError } from "./contracts";
import { MAX_STORED_IMAGE_BYTES, referenceSchema, type ImageReference } from "./media-policy";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const ownerPrefix = (owner: string) => `hello-agent/${createHash("sha256").update(owner).digest("hex").slice(0, 32)}/`;

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

  async save(bytes: Buffer) {
    if (!bytes.length || bytes.length > MAX_STORED_IMAGE_BYTES)
      throw new AppError(413, "处理后的图片大小无效");
    const store = this.storeFactory();
    const data = store
      ? { object: await this.writeObject(store, bytes), base64: null }
      : { base64: bytes.toString("base64") };
    // OSS 与数据库没有跨服务事务；数据库提交结果不明时保留对象，避免误删已引用的图片。
    return this.repo.create("media", { mimeType: "image/jpeg", ...data });
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
