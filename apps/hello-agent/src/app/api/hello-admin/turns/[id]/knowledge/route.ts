import { z } from "zod";
import { cms } from "../../../../../../cms/client";
import { readTurnKnowledge } from "../../../../../../agent/knowledge-evidence";
import { AppError } from "../../../../../../domain/contracts";
import { failure } from "../../../../../../server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const payload = await cms();
    const { user } = await payload.auth({ headers: request.headers });
    if (user?.collection !== "admins")
      throw new AppError(401, "请先登录管理后台");
    const id = z.coerce
      .number()
      .int()
      .positive()
      .parse((await context.params).id);
    return Response.json(
      { experts: await readTurnKnowledge(payload, id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
