import { apiErrorSchema, sellerSnapshotSchema } from "@cfp/kith-inn-v1-shared/api";
import type { SellerSnapshot } from "@cfp/kith-inn-v1-shared";
import { KIV1_OPERATOR_HEADER } from "./offerings";

export type CmsSellerDeps = { fetch?: typeof fetch };
const apiErrorCodeSchema = apiErrorSchema.pick({ error: true });

export class CmsSellerError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function cmsBaseUrl(): string {
  const value = process.env.CMS_BASE_URL;
  if (!value) throw new Error("CMS_BASE_URL not configured");
  return value.replace(/\/+$/, "");
}

export async function getSeller(token: string, deps: CmsSellerDeps = {}): Promise<SellerSnapshot> {
  const response = await (deps.fetch ?? fetch)(`${cmsBaseUrl()}/api/internal/kiv1/seller`, {
    headers: { [KIV1_OPERATOR_HEADER]: token }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    const codeOnly = apiErrorCodeSchema.safeParse(body);
    throw new CmsSellerError(
      response.status,
      parsed.success ? parsed.data.error : codeOnly.success ? codeOnly.data.error : "cms-seller-failed",
      parsed.success ? parsed.data.message : "商家服务失败"
    );
  }
  const doc = typeof body === "object" && body !== null ? (body as { doc?: unknown }).doc : undefined;
  const parsed = sellerSnapshotSchema.safeParse(doc);
  if (!parsed.success) throw new CmsSellerError(502, "invalid-cms-response", "商家服务返回无效数据");
  return parsed.data;
}
