import { randomUUID } from "node:crypto";
import type { Payload, TypedUser } from "payload";
import { z } from "zod";
import { Repository } from "../cms/repository";
import { GreetingService } from "../domain/greetings";
import { AppError } from "../domain/contracts";
import { DEFAULT_MODEL } from "../models/deepseek";
import { activeRule, isAdministrator } from "./policy";
import { audit } from "./audit";
import { transaction } from "./service";
const evaluationItemSchema = z.object({ suite: z.string().trim().min(3).max(100), key: z.string().trim().min(1).max(80), category: z.string().trim().min(1).max(80), input: z.string().trim().min(1).max(4000), expected: z.string().trim().min(5).max(1000), provenance: z.string().trim().min(5).max(500) }).strict();
export class EvaluationsService {
  constructor(readonly payload: Payload) {}
  private admin(user: TypedUser) { if (!isAdministrator(user)) throw new AppError(403, "评测管理需要管理员权限"); }
  async add(user: TypedUser, value: unknown) {
    this.admin(user); const data = evaluationItemSchema.parse(value);
    return transaction(this.payload, async (req) => {
      const row = await this.payload.create({ collection: "safety-evaluation-items", overrideAccess: true, req, data });
      await audit(this.payload, `admin:${user.id}`, "evaluation.item", `item:${row.id}`, data.provenance, undefined, req);
      return row;
    });
  }
  async run(user: TypedUser, itemId: number, parentId?: number, remediation?: string, factory = (repo: Repository) => new GreetingService(repo)) {
    this.admin(user);
    if (parentId && (!remediation || remediation.trim().length < 8)) throw new AppError(400, "复测需要整改说明");
    const item = await this.payload.findByID({ collection: "safety-evaluation-items", id: itemId, overrideAccess: true });
    if (parentId) {
      const parent = await this.payload.findByID({ collection: "safety-evaluations", id: parentId, overrideAccess: true });
      if (parent.itemId !== itemId) throw new AppError(400, "复测必须对应原题目");
    }
    const owner = `evaluation:${randomUUID()}`;
    const rule = await activeRule(this.payload);
    const row = await transaction(this.payload, async (req) => {
      const row = await this.payload.create({ collection: "safety-evaluations", overrideAccess: true, req, data: { itemId, parentId, remediation, owner, input: item.input, state: "running", judgment: "pending", modelVersion: process.env.HELLO_MODEL || DEFAULT_MODEL, ruleVersion: rule.version } });
      await audit(this.payload, `admin:${user.id}`, "evaluation.start", `evaluation:${row.id}`, remediation || "执行真实应用链路，等待人工判定", undefined, req);
      return row;
    });
    let output: Record<string, unknown> = {};
    try {
      const service = factory(new Repository(this.payload, { id: owner, auth: "cookie" }));
      const session = await service.createSession("运营安全评测（合成输入）");
      const turn = await service.generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: item.input, mediaIds: [] } });
      output = { state: "completed", turnId: turn.id, output: { greeting: turn.greeting, association: turn.association, artifacts: turn.artifacts } };
    } catch (error) { output = { state: error instanceof AppError && error.status === 422 ? "blocked" : "failed", error: error instanceof AppError ? error.message : "应用运行失败，未取得真实输出" }; }
    return transaction(this.payload, async (req) => {
      const result = await this.payload.update({ collection: "safety-evaluations", id: row.id, overrideAccess: true, req, data: output });
      await audit(this.payload, `admin:${user.id}`, "evaluation.finish", `evaluation:${row.id}`, "保存实际应用运行结果；尚未人工判定", { state: output.state }, req);
      return result;
    });
  }
  async judge(user: TypedUser, id: number, value: unknown) {
    this.admin(user);
    const data = z.object({ judgment: z.enum(["pass", "fail", "inconclusive"]), reason: z.string().trim().min(8).max(1000) }).strict().parse(value);
    return transaction(this.payload, async (req) => {
      const row = await this.payload.findByID({ collection: "safety-evaluations", id, overrideAccess: true, req });
      if (!["completed", "blocked"].includes(row.state) && data.judgment !== "inconclusive") throw new AppError(409, "未实际完成运行，不能判定通过或失败");
      if (row.judgment !== "pending") throw new AppError(409, "判定已保存；请用整改复测追加新记录");
      const result = await this.payload.update({ collection: "safety-evaluations", id, overrideAccess: true, req, data: { judgment: data.judgment, judgmentReason: data.reason, judge: `admin:${user.id}`, judgedAt: new Date().toISOString() } });
      await audit(this.payload, `admin:${user.id}`, "evaluation.judge", `evaluation:${id}`, data.reason, { judgment: data.judgment }, req);
      return result;
    });
  }
}
