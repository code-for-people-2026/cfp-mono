import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { RuntimeOptions } from "@darabonba/typescript";
import OSS from "ali-oss";
import { z } from "zod";
import type { ImageReviewer } from "./image-review";
import { greenReviewCredentials } from "./review-config";

// Alibaba publishes this SDK as CommonJS; Node ESM otherwise exposes an extra
// default wrapper (unlike Vitest's transform). Load its actual exported class.
const { default: Green, ImageModerationRequest } = createRequire(import.meta.url)("@alicloud/green20220302") as typeof import("@alicloud/green20220302");

const tokenSchema = z.object({
  accessKeyId: z.string().min(1), accessKeySecret: z.string().min(1), securityToken: z.string().min(1),
  bucketName: z.string().regex(/^oss-cip-[a-z0-9-]+$/),
  ossInternetEndPoint: z.literal("https://oss-cn-shanghai.aliyuncs.com"),
  fileNamePrefix: z.string().regex(/^upload\/[a-zA-Z0-9_/-]+\/$/),
  expiration: z.number().positive(),
});
type UploadToken = z.infer<typeof tokenSchema>;
type GreenPorts = {
  token(): Promise<unknown>;
  upload(token: UploadToken, name: string, bytes: Buffer): Promise<unknown>;
  inspect(bucket: string, name: string, dataId: string): Promise<unknown>;
};
const verdictSchema = z.object({ code: z.literal(200), data: z.object({ riskLevel: z.enum(["none", "low", "medium", "high"]) }) });

// The temporary bucket belongs to Green. Rejected pixels never enter our OSS.
export function greenImageReviewer(ports: GreenPorts): ImageReviewer {
  return async (bytes) => {
    try {
      const token = tokenSchema.parse(await ports.token());
      if (token.expiration * 1000 < Date.now() + 60_000) throw new Error("expired upload token");
      const id = randomUUID();
      const name = `${token.fileNamePrefix}${id}.jpg`;
      await ports.upload(token, name, bytes);
      const result = verdictSchema.parse(await ports.inspect(token.bucketName, name, id));
      const risk = result.data.riskLevel;
      return { decision: risk === "none" ? "allow" : risk === "high" ? "block" : "uncertain", version: "aliyun-green-baselineCheck-2022-03-02", category: risk === "none" ? "other" : "image_risk" };
    } catch {
      return { decision: "unavailable", version: "aliyun-green-unavailable", category: "image_unreviewed" };
    }
  };
}

export const configuredGreenReviewer: ImageReviewer = async (bytes) => {
  const credentials = greenReviewCredentials();
  if (!credentials) return { decision: "unavailable", version: "unconfigured", category: "image_unreviewed" };
  const client = new Green(new $OpenApiUtil.Config({ ...credentials, endpoint: "green-cip.cn-shanghai.aliyuncs.com", regionId: "cn-shanghai" }));
  const runtime = new RuntimeOptions({ connectTimeout: 5000, readTimeout: 15000, autoretry: false });
  return greenImageReviewer({
    async token() {
      const { body } = await client.describeUploadTokenWithOptions(runtime);
      if (body?.code !== 200) throw new Error("upload token unavailable");
      return body.data;
    },
    upload(token, name, content) {
      const oss = new OSS({ accessKeyId: token.accessKeyId, accessKeySecret: token.accessKeySecret, stsToken: token.securityToken, bucket: token.bucketName, endpoint: token.ossInternetEndPoint, secure: true, timeout: 15_000 });
      return oss.put(name, content, { mime: "image/jpeg" });
    },
    async inspect(bucket, name, dataId) {
      const { body } = await client.imageModerationWithOptions(new ImageModerationRequest({ service: "baselineCheck", serviceParameters: JSON.stringify({ ossBucketName: bucket, ossObjectName: name, dataId }) }), runtime);
      return body;
    },
  })(bytes);
};
