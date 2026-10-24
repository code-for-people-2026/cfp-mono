import { handlers } from "../../../../auth";
import { coreAccess } from "../../../../security";
export const dynamic = "force-dynamic";
const allowed = new Set(["/api/auth/csrf", "/api/auth/callback/credentials", "/api/auth/session"]);
const guard = (handler: typeof handlers.GET) => async (req: Parameters<typeof handler>[0]) => coreAccess(req) || (allowed.has(new URL(req.url).pathname) ? handler(req) : Response.json({ error: "NOT_FOUND" }, { status: 404 }));
export const GET = guard(handlers.GET);
export const POST = guard(handlers.POST);
