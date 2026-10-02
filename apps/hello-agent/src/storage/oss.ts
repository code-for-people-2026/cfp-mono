import OSS from "ali-oss";
import { AppError } from "../domain/contracts";

export interface ImageObjectStore {
  readonly bucket: string;
  readonly region: string;
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
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
    async get(key) {
      try {
        const result = await client.get(key);
        return Buffer.from(result.content);
      } catch { throw new AppError(503, "图片读取暂不可用，请稍后重试"); }
    },
  };
}
