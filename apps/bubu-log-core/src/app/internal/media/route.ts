import { coreAccess, mutationAccess } from "../../../security";
import { getCore } from "../../../client";
import { corePool, profileOwnersFromEnv, LifecycleError } from "../../../lifecycle";
import { OriginalMediaReferences, type MediaReference } from "../../../media";
export const dynamic = "force-dynamic";
async function handle(req: Request, operation: "read" | "write") {
  const denied = coreAccess(req); if (denied) return denied;
  if (operation === "write") { const held = mutationAccess(); if (held) return held; }
  try {
    const payload = await getCore(), { user } = await payload.auth({ headers: req.headers });
    if (user?.collection !== "cms-admins" || !process.env.BUBU_CORE_CMS_EMAIL || user.email !== process.env.BUBU_CORE_CMS_EMAIL) return Response.json({ error: "CORE_UNAUTHORIZED" }, { status: 401 });
    const media = new OriginalMediaReferences(corePool(), profileOwnersFromEnv());
    if (operation === "read") return Response.json(await media.inventory(), { headers: { "Cache-Control": "no-store" } });
    const reader = req.body?.getReader(); if (!reader) throw new LifecycleError("INVALID_MEDIA_REFERENCE", 400);
    const parts: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8192) throw new LifecycleError("INVALID_MEDIA_REFERENCE", 413); parts.push(value); } } finally { await reader.cancel(); }
    const input: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new LifecycleError("INVALID_MEDIA_REFERENCE", 400);
    const value = input as Record<string, unknown>;
    if (!["kind", "documentId", "babyId", "url", "uri"].every(key => typeof value[key] === "string")) throw new LifecycleError("INVALID_MEDIA_REFERENCE", 400);
    return Response.json(await media.replace(value as unknown as MediaReference, value.uri as string), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof LifecycleError ? error.code : "CORE_MEDIA_UNAVAILABLE" }, { status: error instanceof LifecycleError ? error.status : 503 }); }
}
export const GET = (req: Request) => handle(req, "read");
export const POST = (req: Request) => handle(req, "write");
