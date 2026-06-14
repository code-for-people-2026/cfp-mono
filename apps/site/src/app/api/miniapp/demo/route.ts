import { NextResponse, type NextRequest } from "next/server";
import { createCorsHeaders } from "@/lib/cors";
import { createDemoPayload } from "@/lib/miniapp-demo";

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: createCorsHeaders(request.headers.get("origin"))
  });
}

export function GET(request: NextRequest) {
  return NextResponse.json(createDemoPayload(), {
    headers: createCorsHeaders(request.headers.get("origin"))
  });
}

