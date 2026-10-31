import { z } from "zod";
import { cms } from "../../../../../cms/client";
import { Repository } from "../../../../../cms/repository";
import { MediaService } from "../../../../../domain/media";
import { AppError } from "../../../../../domain/contracts";
import { failure } from "../../../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const payload = await cms();
    const { user } = await payload.auth({ headers: request.headers });
    if (!user || user.collection !== "admins") throw new AppError(401, "请先登录管理后台");
    const id = z.coerce.number().int().positive().parse((await context.params).id);
    const result = await payload.find({
      collection: "media", where: { id: { equals: id } }, limit: 1, depth: 0,
      overrideAccess: false, user,
    });
    const row = result.docs[0];
    if (!row || typeof row.owner !== "string") throw new AppError(404, "图片不存在");
    const media = await new MediaService(new Repository(payload, { id: row.owner, auth: "cookie" })).read(id);
    return new Response(new Uint8Array(media.bytes), { headers: {
      "Content-Type": media.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return failure(error); }
}
