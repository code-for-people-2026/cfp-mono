import { z } from "zod";
import { cms } from "../../../../../../cms/client";
import { imaConnection } from "../../../../../../agent/configuration";
import { checkImaConnection } from "../../../../../../agent/knowledge";
import { AppError } from "../../../../../../domain/contracts";
import { checkOrigin } from "../../../../../../server/auth";
import { failure, rateLimit } from "../../../../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const payload = await cms();
    const { user } = await payload.auth({ headers: request.headers });
    if (user?.collection !== "admins")
      throw new AppError(401, "请先登录管理后台");
    rateLimit(`knowledge-check:${user.id}`);
    const id = z.coerce
      .number()
      .int()
      .positive()
      .parse((await context.params).id);
    const row = await payload.findByID({
      collection: "knowledge-bases",
      id,
      depth: 0,
      overrideAccess: false,
      user,
      context: { helloKnowledgeSecrets: true },
    });
    let message: string;
    if (row.provider === "inline") {
      message = row.content?.trim()
        ? "参考资料已保存，可绑定到 subagent。"
        : "尚未填写参考资料。";
    } else {
      try {
        const name = await checkImaConnection(
          imaConnection(row, payload.secret),
          request.signal,
        );
        message = `连接成功，可以读取「${name}」。${row.enabled ? "" : "当前知识库已停用。"}`;
      } catch {
        throw new AppError(
          502,
          "ima 连接未通过，请确认已保存知识库 ID、Client ID、API Key，并有该知识库的读取权限。",
        );
      }
    }
    return Response.json(
      { message },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
