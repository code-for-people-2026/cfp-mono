import { ZodError } from "zod";
import { AppError } from "../domain/contracts";
import { errorCategory } from "./error-category";

export function failure(error: unknown) {
  if (!(error instanceof AppError) && !(error instanceof ZodError))
    console.error({ event: "hello.request_failed", at: new Date().toISOString(), category: errorCategory(error) });
  const status =
    error instanceof AppError
      ? error.status
      : error instanceof ZodError
        ? 400
        : 500;
  const message =
    error instanceof AppError
      ? error.message
      : error instanceof ZodError
        ? "输入格式不正确，请检查内容和字段"
        : "服务暂时不可用，请稍后重试";
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function readJson(request: Request, maximum = 8 * 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "缺少请求内容");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new AppError(413, "请求内容过大");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AppError(400, "请求不是有效 JSON");
  }
}

const buckets = new Map<string, { count: number; expires: number }>();
// 单进程按访客限频；平台模型成本另由 Payload 的全站共享额度限制。
export function rateLimit(owner: string, maximum = 20) {
  rateLimitGroup([{ key: owner, maximum }]);
}
export function rateLimitGroup(limits: { key: string; maximum: number }[]) {
  const now = Date.now();
  for (const [key, value] of buckets)
    if (value.expires < now) buckets.delete(key);
  // No awaits between checking and committing: a rejection consumes no quota
  // at either level and does not create a bucket for a rejected new identity.
  const admitted = limits.map(({ key, maximum }) => {
    const bucket = buckets.get(key) || { count: 0, expires: now + 60_000 };
    if (bucket.count >= maximum) throw new AppError(429, "操作较频繁，请一分钟后再试");
    return { key, bucket };
  });
  for (const { key, bucket } of admitted) {
    bucket.count++;
    buckets.set(key, bucket);
  }
}
