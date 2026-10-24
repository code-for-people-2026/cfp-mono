import config from "@payload-config";
import { REST_GET, REST_POST, REST_PATCH, REST_DELETE } from "@payloadcms/next/routes";
import { coreAccess, mutationAccess } from "../../../security";
export const dynamic = "force-dynamic";
const collections = new Set(["app-users", "babies", "baby-users", "activities", "daily-stats", "audit-logs"]);
const guard = (handler: ReturnType<typeof REST_GET>) => async (...args: Parameters<typeof handler>) => {
  const [req] = args, denied = coreAccess(req); if (denied) return denied;
  const path = new URL(req.url).pathname;
  const login = path === "/api/cms-admins/login" && req.method === "POST";
  if (!login && !collections.has(path.split("/")[2] || "")) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!login && !["GET", "HEAD"].includes(req.method)) { const held = mutationAccess(); if (held) return held; }
  return handler(...args);
};
export const GET = guard(REST_GET(config));
export const POST = guard(REST_POST(config));
export const PATCH = guard(REST_PATCH(config));
export const DELETE = guard(REST_DELETE(config));
