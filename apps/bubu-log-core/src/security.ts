import { timingSafeEqual } from "node:crypto";
export function coreAccess(request: Request, env: Record<string, string | undefined> = process.env): Response | undefined {
  const configured = env.BUBU_CORE_SERVICE_TOKEN || "";
  const given = request.headers.get("x-bubu-core-token") || "";
  if (!/^[a-f0-9]{64}$/.test(configured)) return Response.json({ error: "CORE_NOT_CONFIGURED" }, { status: 503 });
  if (!/^[a-f0-9]{64}$/.test(given) || !timingSafeEqual(Buffer.from(given), Buffer.from(configured))) return Response.json({ error: "CORE_UNAUTHORIZED" }, { status: 401 });
  // Separate secrets and explicit restore verification are required even on loopback.
  let database: URL;
  try { database = new URL(env.BUBU_CORE_DATABASE_URL || ""); } catch { return Response.json({ error: "CORE_NOT_CONFIGURED" }, { status: 503 }); }
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) || !/^[a-f0-9]{64}$/.test(env.BUBU_CORE_PAYLOAD_SECRET || "") || !/^[a-f0-9]{64}$/.test(env.AUTH_SECRET || "")) return Response.json({ error: "CORE_NOT_CONFIGURED" }, { status: 503 });
}
export function mutationAccess(env: Record<string, string | undefined> = process.env): Response | undefined {
  if (env.BUBU_CORE_WRITES_ENABLED !== "true") return Response.json({ error: "CORE_READ_ONLY" }, { status: 503 });
}
