import { isArtifactRequest } from "../domain/creation-scope";
import { needsProductDeleteClarification, productHelp } from "../domain/product-knowledge";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Payload, TypedUser } from "payload";
import { emergencyContactSchema, type InteractionStatus } from "@cfp/hello-agent-contracts";
import { AgeService, ageProfile } from "../age/service";
import { withAgeLock } from "../age/lock";
import { AppError, type Owner } from "../domain/contracts";
import { OperationsService, transaction } from "../operations/service";
import { audit } from "../operations/audit";
import { canReview, isAdministrator } from "../operations/policy";
import { feishuAlertStatus } from "../operations/alerts";
import { privacyService } from "../privacy/service";
import { durationDue, interactionSignals, noticeText, tickUsage, TWO_HOURS } from "./policy";

const stateSchema = z.object({
  activeMs: z.number().nonnegative().default(0), lastSeen: z.number().nonnegative().default(0), reminded: z.number().nonnegative().default(0),
  notice: z.object({ id: z.string(), kind: z.enum(["duration", "dependency", "crisis"]), text: z.string() }).nullable().default(null),
  cipher: z.string().optional(), consentedAt: z.string().optional(), contactVersion: z.string().optional(),
}).default({ activeMs: 0, lastSeen: 0, reminded: 0, notice: null });
type State = z.output<typeof stateSchema>;
const contactNotice = "仅在出现明确危及生命健康、重大财产损失等极端风险时，由获授权的运营人员使用紧急联系人信息提供必要协助。请先告知联系人并取得其同意；信息加密保存，不发送给聊天模型，不用于营销。你可随时移除，导出与删除账号数据也包括此项。尚未核验联系人真实性；保存不代表已联系。";
function encrypt(contact: { name: string; phone: string }, owner: string, secret: string) {
  const iv = randomBytes(12), key = createHash("sha256").update(`hello-emergency-v1:${secret}`).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(Buffer.from(owner));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(contact), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
}
function decrypt(value: string, owner: string, secret: string) {
  try {
    const b = Buffer.from(value, "base64"), key = createHash("sha256").update(`hello-emergency-v1:${secret}`).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(b.subarray(12, 28));
    return z.object({ name: z.string(), phone: z.string() }).parse(JSON.parse(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString()));
  } catch { throw new AppError(503, "紧急联系人暂时无法读取，请联系管理员核对加密配置"); }
}
function interactionSupport() {
  const configured = process.env.HELLO_EMERGENCY_PHONE || "19925452049";
  const phone = /^\+?[0-9 -]{7,20}$/.test(configured) ? configured : "19925452049";
  return { phone, hours: "孙逢本人处理，全天可电话联系；不承诺即时接听，危急情况请同时联系当地急救或警方", alertConfigured: false };
}
export class InteractionService {
  constructor(readonly payload: Payload, readonly owner: Owner) {}
  private async read() { const p = await ageProfile(this.payload, this.owner.id); return { profile: p, state: stateSchema.parse(p?.interaction ?? undefined) }; }
  private async change(action: (s: State) => State) {
    return withAgeLock(this.payload, `owner:${this.owner.id}`, async () => {
      const { profile, state } = await this.read();
      if (!profile) return state; // Internal synthetic evaluations have no personal profile.
      await privacyService(this.payload, this.owner).require();
      const next = action(state);
      await this.payload.update({ collection: "age-profiles", id: profile.id, overrideAccess: true, data: { interaction: next } });
      return next;
    });
  }
  async status(): Promise<InteractionStatus> {
    if (this.owner.auth === "bearer") throw new AppError(403, "外部连接不能读取紧急联系人");
    const { state } = await this.read();
    return { activeMs: state.activeMs, notice: state.notice, contact: state.cipher ? { ...decrypt(state.cipher, this.owner.id, this.payload.secret), consentedAt: state.consentedAt! } : null,
      contactNotice, contactVersion: "2026-10-24.v1", support: { ...interactionSupport(), alertConfigured: (await feishuAlertStatus(this.payload)).ready } };
  }
  async saveContact(value: unknown) {
    if (this.owner.auth === "bearer") throw new AppError(403, "请本人管理紧急联系人");
    await new AgeService(this.payload, this.owner).requireCapability();
    const input = emergencyContactSchema.parse(value);
    await this.change((s) => ({ ...s, cipher: encrypt({ name: input.name, phone: input.phone }, this.owner.id, this.payload.secret), consentedAt: new Date().toISOString(), contactVersion: input.version }));
    return this.status();
  }
  async removeContact() {
    if (this.owner.auth === "bearer") throw new AppError(403, "请本人管理紧急联系人");
    // Removal remains possible after withdrawal. No new collection or retained plaintext.
    await withAgeLock(this.payload, `owner:${this.owner.id}`, async () => {
      const { profile, state } = await this.read(); if (!profile) return;
      const next = { ...state }; delete next.cipher; delete next.consentedAt; delete next.contactVersion;
      await this.payload.update({ collection: "age-profiles", id: profile.id, overrideAccess: true, data: { interaction: next } });
    });
    return this.status();
  }
  async heartbeat() {
    await new AgeService(this.payload, this.owner).requireCapability();
    await this.change((s) => {
      const next = { ...s, ...tickUsage(s, Date.now()) };
      if (durationDue(next) && !next.notice) next.notice = { id: randomUUID(), kind: "duration", text: noticeText.duration };
      return next;
    });
    return this.status();
  }
  async acknowledge(value: unknown) {
    if (this.owner.auth === "bearer") throw new AppError(403, "请本人确认提醒");
    const { id } = z.object({ id: z.string().uuid() }).strict().parse(value);
    await this.change((s) => s.notice?.id === id ? { ...s, reminded: s.notice.kind === "duration" ? Math.floor(s.activeMs / TWO_HOURS) : s.reminded, notice: null } : s);
    return this.status();
  }
  async inspectInput(text: string, sessionId: number, requestId: string): Promise<string | undefined> {
    const flags = interactionSignals(text);
    if (flags.crisis) {
      await transaction(this.payload, async (req) => {
        const previous = await this.payload.find({ collection: "safety-cases", overrideAccess: true, req, limit: 1, where: { and: [{ owner: { equals: this.owner.id } }, { stage: { equals: "interaction_crisis" } }, { status: { not_equals: "resolved" } }] } });
        if (!previous.docs.length) await new OperationsService(this.payload).createCase({ owner: this.owner.id, source: "moderation", category: "self_harm", stage: "interaction_crisis", severity: "urgent", sessionId, requestId }, text, req);
      });
    }
    if (flags.minor) {
      await new AgeService(this.payload, this.owner).requireAdditionalVerification();
      throw new AppError(403, "你刚才提供的年龄信息与成年核验存在冲突，已暂停聊天、上传及外部连接。请通过设置→帮助与反馈申请年龄复核；隐私与删除入口仍可使用。若有紧急危险，请立即联系当地急救或警方，也可拨打人工联系电话 19925452049。");
    }
    if (flags.exit && !flags.crisis) return "已停止本次聊天。你可以直接离开页面；如需退出账号，可打开设置→隐私与数据。";
    if (!flags.crisis && !flags.dependency && !flags.overuse && (!isArtifactRequest(text) || needsProductDeleteClarification(text))) {
      const help = productHelp(text);
      if (help) return help;
    }
    const kind = flags.crisis ? "crisis" : flags.dependency ? "dependency" : flags.overuse ? "duration" : undefined;
    if (kind) await this.change((s) => ({ ...s, notice: { id: randomUUID(), kind, text: noticeText[kind] } }));
    if (kind) return `${noticeText[kind]}${kind === "crisis" ? ` 人工联系电话：${interactionSupport().phone}（孙逢，全天可联系，不保证即时接听）。` : ""}`;
    return undefined;
  }
}
export async function emergencyContactForCase(payload: Payload, user: TypedUser, caseId: number, value: unknown) {
  if (!canReview(user)) throw new AppError(403, "需要审核运营权限");
  const input = z.object({ reason: z.string().trim().min(8).max(500), result: z.enum(["read", "contacted", "unreachable"]).default("read") }).strict().parse(value);
  const row = await payload.findByID({ collection: "safety-cases", id: caseId, overrideAccess: true });
  if (row.severity !== "urgent" || row.status === "resolved" || (row.retainUntil && Date.parse(row.retainUntil) <= Date.now())) throw new AppError(403, "仅可在有效的紧急处置中读取联络资料");
  if (row.assignedTo !== user.id && !isAdministrator(user)) throw new AppError(403, "请先领取此紧急案件");
  return withAgeLock(payload, `owner:${row.owner}`, async () => {
  const contact = (await new InteractionService(payload, { id: row.owner, auth: "cookie" }).status()).contact;
  if (!contact && input.result !== "read") throw new AppError(409, "当前没有有效授权的联系人，不能登记联系结果");
  await audit(payload, `admin:${user.id}`, `emergency_contact.${input.result}`, `case:${row.id}`, input.reason, { hasContact: !!contact });
  return { contact: input.result === "read" ? contact : null, recorded: true, notice: input.result === "read" ? "仅展示供人工必要联络；系统没有自动拨号或发送消息。请实际联系后另行登记结果。" : "已登记操作人声明的联系结果，非自动送达凭证。" };
  });
}
