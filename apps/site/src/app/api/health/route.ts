import { NextResponse } from "next/server";
import { createHealthPayload } from "@/lib/health";

export function GET() {
  return NextResponse.json(createHealthPayload("site"));
}

