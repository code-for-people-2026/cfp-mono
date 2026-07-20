import configPromise from "@payload-config";
import { getPayload } from "payload";
import { NextResponse } from "next/server";
import { resolveReleaseSha } from "@/lib/deployment/release";

export const dynamic = "force-dynamic";

type DatabaseReadyDeps = {
  dbName: string;
  findDocument: () => Promise<unknown>;
};

type ReadyDeps = {
  probe: () => Promise<void>;
  releaseSha: string;
  timeoutMs?: number;
};

function timeoutAfter(ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("database probe timed out")), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

export async function verifyWebsiteDatabaseReady(deps: DatabaseReadyDeps): Promise<void> {
  if (deps.dbName !== "postgres") throw new Error("PostgreSQL required");
  await deps.findDocument();
}

export async function probeWebsiteDatabase(): Promise<void> {
  const payload = await getPayload({ config: configPromise });
  await verifyWebsiteDatabaseReady({
    dbName: payload.db.name,
    findDocument: () =>
      payload.find({
        collection: "site-documents",
        depth: 0,
        limit: 1,
        overrideAccess: true,
      }),
  });
}

export async function readyResponse(
  deps: ReadyDeps = {
    probe: probeWebsiteDatabase,
    releaseSha: resolveReleaseSha(),
  },
) {
  const timeout = timeoutAfter(deps.timeoutMs ?? 5_000);
  try {
    await Promise.race([deps.probe(), timeout.promise]);
    return NextResponse.json({ ok: true, service: "website", releaseSha: deps.releaseSha });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        service: "website",
        releaseSha: deps.releaseSha,
        category: "database_unavailable",
      },
      { status: 503 },
    );
  } finally {
    timeout.cancel();
  }
}

export function GET() {
  return readyResponse();
}
