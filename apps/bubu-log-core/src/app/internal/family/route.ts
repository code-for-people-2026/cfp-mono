import { coreAccess, mutationAccess } from "../../../security";
import { getCore } from "../../../client";
import { familyLifecycle, LifecycleError } from "../../../lifecycle";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  const denied = coreAccess(req); if (denied) return denied;
  if (req.method === "DELETE") { const held = mutationAccess(); if (held) return held; }
  try {
    const payload = await getCore(), { user } = await payload.auth({ headers: req.headers });
    if (user?.collection !== "cms-admins" || !process.env.BUBU_CORE_CMS_EMAIL || user.email !== process.env.BUBU_CORE_CMS_EMAIL) return Response.json({ error: "CORE_UNAUTHORIZED" }, { status: 401 });
    const babyId = new URL(req.url).searchParams.get("babyId") || "";
    if (req.method === "GET") return Response.json({ babyId, data: await familyLifecycle().exportFamilyData(babyId) }, { headers: { "Cache-Control": "no-store" } });
    await familyLifecycle().deleteFamilyData(babyId);
    return Response.json({ babyId, deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof LifecycleError;
    return Response.json({ error: known ? error.code : "CORE_LIFECYCLE_UNAVAILABLE" }, { status: known ? error.status : 503 });
  }
}
export const GET = handle;
export const DELETE = handle;
