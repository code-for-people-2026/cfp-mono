import { getPayload } from "payload";
import config from "@payload-config";
import { seedSiteContent } from "@/payload/seed";
import { seedRecipes } from "@/payload/recipes.seed";

export const dynamic = "force-dynamic";

// Seeds the current site copy into Payload (published). Guarded by PAYLOAD_SEED so it is
// only reachable in seed contexts (local/CI/first deploy). Idempotent — safe to re-run.
export async function GET() {
  if (process.env.PAYLOAD_SEED !== "true") {
    return Response.json({ error: "seeding is disabled" }, { status: 403 });
  }
  try {
    const payload = await getPayload({ config });
    await seedSiteContent(payload);
    await seedRecipes(payload);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "seed failed" },
      { status: 500 },
    );
  }
}
