import { offeringUpdateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { findOwned, hasSellerField, isUniqueConflict, operatorScope } from "@/lib/kiv1-internal";
import { normalizeOffering } from "../route";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = offeringUpdateSchema.safeParse(body);
  if (hasSellerField(body) || !parsed.success) {
    return NextResponse.json({ error: "invalid-offering-update" }, { status: 422 });
  }
  const { id } = await params;
  if (!await findOwned(scope.payload, "kiv1_offerings", id, scope.sellerId)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  try {
    const doc = await scope.payload.update({
      collection: "kiv1_offerings",
      id,
      data: parsed.data,
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeOffering(doc as Parameters<typeof normalizeOffering>[0]) });
  } catch (error) {
    return isUniqueConflict(error)
      ? NextResponse.json({ error: "offering-name-conflict" }, { status: 409 })
      : NextResponse.json({ error: "offering-update-failed" }, { status: 500 });
  }
}
