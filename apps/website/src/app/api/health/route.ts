import { NextResponse } from "next/server";

// Lightweight liveness probe for deploy smoke tests and the reverse proxy.
// Intentionally does not touch the database — it reports that the Next server
// is up and serving, not that Payload/Postgres is reachable.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
