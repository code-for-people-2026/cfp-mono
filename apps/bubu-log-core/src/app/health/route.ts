import { coreAccess } from "../../security";
import { getCore } from "../../client";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const denied = coreAccess(req); if (denied) return denied;
  try { const payload = await getCore(); await payload.count({ collection: "babies", overrideAccess: true }); return Response.json({ status: "ok", writesEnabled: process.env.BUBU_CORE_WRITES_ENABLED === "true" }); }
  catch { return Response.json({ status: "unavailable" }, { status: 503 }); }
}
