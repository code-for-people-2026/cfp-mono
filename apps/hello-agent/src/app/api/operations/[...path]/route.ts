import type { CollectionSlug } from "payload";
import { z } from "zod";
import { cms } from "../../../../cms/client";
import { AppError } from "../../../../domain/contracts";
import { checkOrigin } from "../../../../server/auth";
import { failure, readJson } from "../../../../server/http";
import { OperationsService } from "../../../../operations/service";
import { RulesService } from "../../../../operations/rules";
import { EvaluationsService } from "../../../../operations/evaluations";
import { activeRule, canAudit, isAdministrator, roleOf } from "../../../../operations/policy";
import { audit } from "../../../../operations/audit";
import { imageReviewConfigured } from "../../../../operations/image-review";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "private, no-store" } });
const id = (value: unknown) => z.coerce.number().int().positive().parse(value);
async function authenticate(request: Request) {
  const payload = await cms();
  const { user } = await payload.auth({ headers: request.headers });
  if (!user || user.collection !== "admins") throw new AppError(401, "请先登录 Payload 管理后台");
  return { payload, user };
}
export async function GET(request: Request, context: Context) {
  try {
    const { payload, user } = await authenticate(request);
    const path = (await context.params).path;
    const service = new OperationsService(payload);
    if (path[0] === "status") {
      const { version, mode } = await activeRule(payload);
      return json({ role: roleOf(user), id: user.id, configuration: await service.configuration(), rule: { version, mode }, imageReviewConfigured: imageReviewConfigured() });
    }
    if (path[0] === "cases") {
      const query = new URL(request.url).searchParams;
      return json(await service.queue(user, { status: query.get("status") || undefined, severity: query.get("severity") || undefined, mine: query.get("mine") === "true", overdue: query.get("overdue") === "true" }));
    }
    const collections: Record<string, CollectionSlug> = { rules: "safety-rules", regressions: "safety-regressions", releases: "safety-releases", items: "safety-evaluation-items", evaluations: "safety-evaluations", audit: "safety-audit", settings: "safety-settings" };
    if (path[0] === "export") {
      if (!isAdministrator(user)) throw new AppError(403, "导出评测报告需要管理员权限");
      const rows = (await payload.find({ collection: "safety-evaluations", user, overrideAccess: false, pagination: false, limit: 0 })).docs;
      await audit(payload, `admin:${user.id}`, "evaluation.export", "evaluations", "导出可审阅评测记录（可能包含测试敏感内容）", { rows: rows.length });
      const response = json({ exportedAt: new Date().toISOString(), qualification: "运行结果与人工判定记录，不构成正式合格或监管认可结论", evaluations: rows });
      response.headers.set("Content-Disposition", 'attachment; filename="aj-safety-evaluations.json"');
      return response;
    }
    const collection = collections[path[0]];
    if (!collection) throw new AppError(404, "接口不存在");
    if (path[0] === "audit" ? !canAudit(user) : !isAdministrator(user)) throw new AppError(403, "当前角色无此权限");
    return json((await payload.find({ collection, overrideAccess: false, user, limit: 100, sort: "-id", depth: 0 })).docs);
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const { payload, user } = await authenticate(request);
    const path = (await context.params).path;
    const body = await readJson(request, 128 * 1024);
    const service = new OperationsService(payload);
    if (path[0] === "cases" && path[2] === "evidence") return json(await service.evidence(user, id(path[1]), z.object({ reason: z.string() }).strict().parse(body).reason));
    if (path[0] === "cases" && path[2] === "action") return json(await service.action(user, id(path[1]), body));
    if (path[0] === "settings") return json(await service.configure(user, body));
    const rules = new RulesService(payload);
    if (path[0] === "rules" && path.length === 1) return json(await rules.create(user, body));
    if (path[0] === "rules" && path[2] === "regress") return json(await rules.regress(user, id(path[1])));
    if (path[0] === "rules" && path[2] === "release") {
      const args = z.object({ regressionId: z.number().int().positive(), reason: z.string() }).strict().parse(body);
      return json(await rules.release(user, id(path[1]), args.regressionId, args.reason));
    }
    const evaluations = new EvaluationsService(payload);
    if (path[0] === "items" && path.length === 1) return json(await evaluations.add(user, body));
    if (path[0] === "items" && path[2] === "run") {
      const args = z.object({ parentId: z.number().int().positive().optional(), remediation: z.string().optional() }).strict().parse(body);
      return json(await evaluations.run(user, id(path[1]), args.parentId, args.remediation));
    }
    if (path[0] === "evaluations" && path[2] === "judge") return json(await evaluations.judge(user, id(path[1]), body));
    throw new AppError(404, "接口不存在");
  } catch (error) { return failure(error); }
}
