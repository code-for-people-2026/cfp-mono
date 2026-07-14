import configPromise from "@payload-config";
import { getPayload } from "payload";
import { NextResponse } from "next/server";
import { assertCmsMigrationHead, shouldRequireCmsMigrationHead } from "../../../db/migrationHead";

export const dynamic = "force-dynamic";

type ReadyDeps = { internalToken?: string; probe: () => Promise<void>; timeoutMs?: number };

function timeoutAfter(ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("database probe timed out")), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

export async function probeCmsDatabase(): Promise<void> {
  const payload = await getPayload({ config: configPromise });
  if (payload.db.name !== "postgres") throw new Error("PostgreSQL required");
  if (shouldRequireCmsMigrationHead()) await assertCmsMigrationHead(payload);
  await payload.find({ collection: "sellers", limit: 1, depth: 0, overrideAccess: true });
}

export async function readyResponse(
  request: Request,
  deps: ReadyDeps = { internalToken: process.env.CMS_INTERNAL_TOKEN, probe: probeCmsDatabase },
) {
  if (!deps.internalToken || request.headers.get("x-internal-token") !== deps.internalToken) {
    return NextResponse.json({ ok: false, service: "cms", category: "internal_auth_failed" }, { status: 503 });
  }
  const timeout = timeoutAfter(deps.timeoutMs ?? 5_000);
  try {
    await Promise.race([deps.probe(), timeout.promise]);
    return NextResponse.json({ ok: true, service: "cms" });
  } catch {
    return NextResponse.json({ ok: false, service: "cms", category: "database_unavailable" }, { status: 503 });
  } finally {
    timeout.cancel();
  }
}

export function GET(request: Request) {
  return readyResponse(request);
}
