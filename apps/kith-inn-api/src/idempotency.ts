import { createHash } from "node:crypto";
import { IdSchema } from "@cfp/kith-inn-contracts";
import type { PoolClient } from "pg";
import { ApiError } from "./auth";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Request body must be JSON");
  return encoded;
}

// The caller holds the merchant lock and has rechecked the session in this transaction.
export async function idempotent<T>(
  client: PoolClient, merchantId: string, key: string,
  request: { method: string; path: string; body: unknown },
  work: () => Promise<{ status: number; body: T }>, now: Date
): Promise<{ status: number; body: T }> {
  const parsed = IdSchema.safeParse(key);
  if (!parsed.success) throw new ApiError(400, "INVALID_REQUEST", "写入请求标识必须为 UUID");
  const idempotencyKey = parsed.data.toLowerCase();
  const hash = createHash("sha256").update(canonical({
    method: request.method, path: request.path, body: request.body
  })).digest();
  await client.query("DELETE FROM mutation_receipts WHERE merchant_id = $1 AND expires_at <= $2", [merchantId, now]);
  const { rows: [receipt] } = await client.query<{
    request_hash: Buffer; response_status: number; response_body: T;
  }>(`SELECT request_hash, response_status, response_body FROM mutation_receipts
    WHERE merchant_id = $1 AND idempotency_key = $2`, [merchantId, idempotencyKey]);
  if (receipt) {
    if (!receipt.request_hash.equals(hash)) {
      throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "该写入请求标识已用于其他操作");
    }
    return { status: receipt.response_status, body: receipt.response_body };
  }
  const result = await work();
  if (!(result.status >= 200 && result.status < 300)) throw new Error("Mutation must return a successful response");
  await client.query(`INSERT INTO mutation_receipts
    (merchant_id, idempotency_key, request_hash, response_status, response_body, created_at, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [merchantId, idempotencyKey, hash,
    result.status, JSON.stringify(result.body), now, new Date(now.getTime() + 86_400_000)]);
  return result;
}
