import configPromise from "@payload-config";
import { getPayload } from "payload";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ReadyDeps = { internalToken?: string; probe: () => Promise<void> };

export async function probeCmsDatabase(): Promise<void> {
  const payload = await getPayload({ config: configPromise });
  if (payload.db.name !== "postgres") throw new Error("PostgreSQL required");
  await payload.find({ collection: "sellers", limit: 1, depth: 0, overrideAccess: true });
}

export async function readyResponse(
  request: Request,
  deps: ReadyDeps = { internalToken: process.env.CMS_INTERNAL_TOKEN, probe: probeCmsDatabase },
) {
  if (!deps.internalToken || request.headers.get("x-internal-token") !== deps.internalToken) {
    return NextResponse.json({ ok: false, service: "cms", category: "internal_auth_failed" }, { status: 503 });
  }
  try {
    await deps.probe();
    return NextResponse.json({ ok: true, service: "cms" });
  } catch {
    return NextResponse.json({ ok: false, service: "cms", category: "database_unavailable" }, { status: 503 });
  }
}

export function GET(request: Request) {
  return readyResponse(request);
}
