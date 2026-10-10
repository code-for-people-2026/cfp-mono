import { z } from "zod";

// 图片转为 base64 后会变长，CMS 字段容量必须与处理后的字节上限一致。
export const MAX_STORED_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_STORED_IMAGE_BASE64_LENGTH =
  4 * Math.ceil(MAX_STORED_IMAGE_BYTES / 3);

export const referenceSchema = z.object({
  provider: z.literal("oss"),
  bucket: z.string().min(1),
  region: z.string().min(1),
  key: z.string().regex(/^hello-agent\/[a-f0-9]{32}\/[a-f0-9-]+\.jpg$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: z.number().int().positive().max(MAX_STORED_IMAGE_BYTES),
});
export type ImageReference = z.output<typeof referenceSchema>;
