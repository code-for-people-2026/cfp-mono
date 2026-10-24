import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { RuntimeOptions } from "@darabonba/typescript";
import OSS from "ali-oss";
import { z } from "zod";
import type { ImageReviewer } from "./review";

const { default: Green, ImageModerationRequest } = createRequire(import.meta.url)("@alicloud/green20220302") as typeof import("@alicloud/green20220302");
const tokenSchema = z.object({
  accessKeyId: z.string().min(1), accessKeySecret: z.string().min(1), securityToken: z.string().min(1),
  bucketName: z.string().regex(/^oss-cip-[a-z0-9-]+$/),
  ossInternetEndPoint: z.literal("https://oss-cn-shanghai.aliyuncs.com"),
  fileNamePrefix: z.string().regex(/^upload\/[a-zA-Z0-9_/-]+\/$/), expiration: z.number().positive(),
});
type UploadToken = z.infer<typeof tokenSchema>;
export interface GreenPorts {
  token(): Promise<unknown>;
  upload(token: UploadToken, name: string, bytes: Buffer, mime: string): Promise<unknown>;
  inspect(bucket: string, name: string, dataId: string): Promise<unknown>;
}
const verdictSchema = z.object({ code: z.literal(200), data: z.object({ riskLevel: z.enum(["none", "low", "medium", "high"]) }) });

/** Supplier temporary storage; never our public bucket, a user URL, or an image path containing a family ID. */
export function greenImageReviewer(ports: GreenPorts, deadlineMs = 20_000): ImageReviewer {
  return async (bytes, mime) => {
    let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => { if (expired) throw new Error("review deadline"); };
    const work = async (): Promise<Awaited<ReturnType<ImageReviewer>>> => {
      try {
        check(); const token = tokenSchema.parse(await ports.token()); check();
        if (token.expiration * 1000 < Date.now() + 60_000) throw new Error("expired token");
        const id = randomUUID(), extension = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
        const name = `${token.fileNamePrefix}${id}.${extension}`;
        await ports.upload(token, name, bytes, mime); check();
        const result = verdictSchema.parse(await ports.inspect(token.bucketName, name, id)); check();
        return result.data.riskLevel === "none" ? "allow" : result.data.riskLevel === "high" ? "block" : "uncertain";
      } catch { return "unavailable"; }
    };
    try {
      return await Promise.race([work(), new Promise<"unavailable">(resolve => { timer = setTimeout(() => { expired = true; resolve("unavailable"); }, deadlineMs); })]);
    } finally { if (timer) clearTimeout(timer); }
  };
}

export function configuredImageReviewer(): ImageReviewer | undefined {
  const key = process.env.BUBU_GREEN_ACCESS_KEY_ID?.trim(), secret = process.env.BUBU_GREEN_ACCESS_KEY_SECRET?.trim();
  const sts = process.env.BUBU_GREEN_SECURITY_TOKEN?.trim();
  if (process.env.BUBU_IMAGE_REVIEW_MODE !== "aliyun-green" || !key || !secret || ![key, secret, ...(sts ? [sts] : [])].every(v => /^[!-~]+$/.test(v))) return undefined;
  const client = new Green(new $OpenApiUtil.Config({ accessKeyId: key, accessKeySecret: secret, ...(sts ? { securityToken: sts } : {}), endpoint: "green-cip.cn-shanghai.aliyuncs.com", regionId: "cn-shanghai" }));
  const runtime = new RuntimeOptions({ connectTimeout: 5000, readTimeout: 15000, autoretry: false });
  return greenImageReviewer({
    async token() {
      const { body } = await client.describeUploadTokenWithOptions(runtime);
      if (body?.code !== 200) throw new Error("token unavailable");
      return body.data;
    },
    upload(token, name, content, mime) {
      const oss = new OSS({ accessKeyId: token.accessKeyId, accessKeySecret: token.accessKeySecret, stsToken: token.securityToken, bucket: token.bucketName, endpoint: token.ossInternetEndPoint, secure: true, timeout: 15000 });
      return oss.put(name, content, { mime });
    },
    async inspect(bucket, name, dataId) {
      const { body } = await client.imageModerationWithOptions(new ImageModerationRequest({ service: "baselineCheck", serviceParameters: JSON.stringify({ ossBucketName: bucket, ossObjectName: name, dataId }) }), runtime);
      return body;
    },
  });
}
