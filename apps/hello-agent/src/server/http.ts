import { ZodError } from "zod";
import { AppError } from "../domain/contracts";

export function failure(error: unknown) {
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

export async function readJson(request: Request, maximum = 8 * 1024 * 1024): Promise<unknown> {
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
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(400, "请求不是有效 JSON");
  }
}

const buckets = new Map<string, { count: number; expires: number }>();
// 本地单进程演示的成本护栏；上线前需换成共享限流和注册身份。
export function rateLimit(owner: string) {
  const now = Date.now();
  for (const [key, value] of buckets)
    if (value.expires < now) buckets.delete(key);
  const bucket = buckets.get(owner) || { count: 0, expires: now + 60_000 };
  if (++bucket.count > 20)
    throw new AppError(429, "操作较频繁，请一分钟后再试");
  buckets.set(owner, bucket);
}
