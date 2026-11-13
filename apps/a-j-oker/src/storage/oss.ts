import OSS from "ali-oss";
import { AppError } from "../domain/contracts";

export interface ImageObjectStore {
  readonly bucket: string;
  readonly region: string;
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove?(key: string): Promise<void>;
  removePrefix?(prefix: string): Promise<void>;
}

// 只在服务端初始化；不生成公共 URL，不把供应商错误或凭证写入日志。
export function configuredImageStore(): ImageObjectStore | undefined {
  const mode = process.env.HELLO_MEDIA_STORAGE || "database";
  if (mode === "database") return undefined;
  if (mode !== "oss") throw new AppError(503, "图片存储配置无效");
  const bucket = process.env.HELLO_OSS_BUCKET;
  const region = process.env.HELLO_OSS_REGION;
  const accessKeyId = process.env.HELLO_OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.HELLO_OSS_ACCESS_KEY_SECRET;
  if (!bucket || !region || !accessKeyId || !accessKeySecret)
    throw new AppError(503, "图片存储尚未配置完整");
  const client = new OSS({
    bucket, region, accessKeyId, accessKeySecret,
    secure: true, authorizationV4: true,
    internal: process.env.HELLO_OSS_INTERNAL === "true",
    timeout: 20_000,
  });
  return {
    bucket, region,
    async put(key, bytes) {
      try {
        await client.put(key, bytes, {
          mime: "image/jpeg",
          headers: { "x-oss-object-acl": "private", "x-oss-server-side-encryption": "AES256" },
        });
      } catch { throw new AppError(503, "图片存储暂不可用，请稍后重试"); }
    },
    async remove(key) {
      try { await client.delete(key); }
      catch { throw new AppError(503, "图片删除未完成，请稍后重试"); }
    },
    async removePrefix(prefix) {
      try {
        // Repeat first page because deleting it changes pagination. Include
        // unreferenced objects left after uncertain database commits.
        while (true) {
          const result = await client.list({ prefix, "max-keys": 100 }, {});
          if (!result.objects?.length) break;
          for (const object of result.objects) await client.delete(object.name);
        }
      } catch { throw new AppError(503, "图片删除未完成，请保留当前身份并重试"); }
    },
    async get(key) {
      try {
        const result = await client.get(key);
        return Buffer.from(result.content);
      } catch { throw new AppError(503, "图片读取暂不可用，请稍后重试"); }
    },
  };
}
