import { AppError } from "./contracts";
export interface MediaOptions { allowedOrigins: string[]; fetch?: typeof fetch; maxBytes?: number }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
/** Keep the persisted legacy URL unchanged, but never return it through the authenticated API. */
export function protectLegacyPhotos(value: unknown, babyId: string): unknown {
  if (Array.isArray(value)) return value.map(row => protectLegacyPhotos(row, babyId));
  if (!object(value) || typeof value.poopPhotoUrl !== "string" || !value.poopPhotoUrl) return value;
  if (value.babyId !== babyId || typeof value.id !== "string") throw new AppError(403, "BABY_FORBIDDEN", "记录不属于当前宝宝。");
  return { ...value, poopPhotoUrl: `/api/app/media/activities/${encodeURIComponent(value.id)}?babyId=${encodeURIComponent(babyId)}` };
}
/** Revisions and receipts nest legacy facts inside their owning event. */
export function protectRecordPhotos(value: unknown, babyId: string, inheritedId?: string): unknown {
  if (Array.isArray(value)) return value.map(item => protectRecordPhotos(item, babyId, inheritedId));
  if (!object(value)) return value;
  if (typeof value.babyId === "string" && value.babyId !== babyId) throw new AppError(403, "BABY_FORBIDDEN", "记录不属于当前宝宝。");
  const id = typeof value.legacyId === "string" ? value.legacyId : typeof value.id === "string" && typeof value.startTime === "string" ? value.id : inheritedId;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (key === "poopPhotoUrl" && typeof item === "string" && item) return id ? [[key, `/api/app/media/activities/${encodeURIComponent(id)}?babyId=${encodeURIComponent(babyId)}`]] : [];
    return [[key, protectRecordPhotos(item, babyId, id)]];
  }));
}
export async function readLegacyPhoto(activity: unknown, babyId: string, options: MediaOptions): Promise<Response> {
  if (!object(activity) || activity.babyId !== babyId) throw new AppError(403, "BABY_FORBIDDEN", "记录不属于当前宝宝。");
  if (typeof activity.poopPhotoUrl !== "string" || !activity.poopPhotoUrl) throw new AppError(404, "MEDIA_NOT_FOUND", "此记录没有照片。");
  let url: URL;
  try { url = new URL(activity.poopPhotoUrl); } catch { throw new AppError(502, "MEDIA_UNAVAILABLE", "照片地址不可用。"); }
  if (url.protocol !== "https:" || url.username || url.password || !options.allowedOrigins.includes(url.origin)) throw new AppError(503, "MEDIA_ORIGIN_NOT_CONFIGURED", "此旧照片来源尚未配置，请联系运营。");
  const max = options.maxBytes || 10 * 1024 * 1024;
  let response: Response;
  try { response = await (options.fetch || fetch)(url, { redirect: "error", signal: AbortSignal.timeout(10000), cache: "no-store" }); }
  catch { throw new AppError(502, "MEDIA_UNAVAILABLE", "照片暂时不可用。"); }
  if (!response.ok || !response.body) throw new AppError(502, "MEDIA_UNAVAILABLE", "照片暂时不可用。");
  const type = response.headers.get("content-type")?.split(";")[0] || "";
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) { await response.body.cancel(); throw new AppError(415, "MEDIA_TYPE_UNSUPPORTED", "照片格式不支持。"); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new AppError(413, "MEDIA_TOO_LARGE", "照片超过读取大小限制。");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return new Response(Buffer.concat(chunks), { headers: { "Content-Type": type, "Content-Length": String(size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
}
