import { avatarResponse, readProfile, exportProfile, deleteProfileImages, PROFILE_BODY_LIMIT } from "../profile/service";
import type { Payload } from "payload";
import { AppError } from "../domain/contracts";
import { authenticate, checkClientRequest, mintCredential, revokeCredentials, withAuthenticatedExecution } from "../server/auth";
import { withCredentialLock } from "../server/credential-lock";
import { failure, rateLimit, readJson } from "../server/http";
import { rateLimitLogin } from "../server/login-limits";
import { ageNotice, providerConfigured, wechatConfigured } from "./policy";
import { AgeService, ageProfile } from "./service";
import { wechatLogin } from "./wechat";

const agePreviewEnabled = () => process.env.HELLO_PREVIEW_SCOPE === "login-and-age";
const previewStatus = (status: Awaited<ReturnType<AgeService["status"]>>) => ({ ...status, allowed: false, configuration: { ...status.configuration, previewOnly: true } });
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function previewPolicy() {
  return {
    version: `onboarding-preview-v1.${ageNotice().version}`, ready: false,
    contact: "请联系本次预览的提供者。", retentionDays: 30, backupDays: null, responseDays: null, imageReviewDisclosed: false,
    documents: [{ title: "登录与生日预览说明", paragraphs: [
      agePreviewEnabled() ? "本预览由码成仝软件（深圳）有限公司提供，体验微信登录、个人资料、生日与身份年龄核验。可通过本人姓名和身份证核验更正误填的生日。尚未开放聊天、聊天图片上传或外部连接。" : "本预览由码成仝软件（深圳）有限公司提供，仅供体验真实微信登录和生日窗口。可选择本人头像；尚未开放聊天、聊天图片上传、外部连接或姓名证件核验。",
      "点击微信登录后，通过微信官方接口识别当前账号。保存账号标识摘要、登录凭证摘要和同意版本，不获取手机号。昵称和头像仅用于本人账号展示，可选用微信资料；留空会分配随机资料。头像存于私有图片空间，不发送给模型。生日仅在页面计算年龄段，不上传完整生日；仅保存申报年龄段，用于显示相应提示。",
      "本预览使用独立数据空间，不读取或迁移现有聊天。未继续操作的登录资料和年龄申报记录在30天后由本预览的定时任务清理；可在隐私与数据中导出、退出或删除。删除清除在线记录，不承诺抹除你自行保存的副本或基础设施备份。",
      "继续体验或通过年龄核验，不会自动授予本预览的聊天、上传或外部访问权限。",
    ] }, ...(agePreviewEnabled() ? [{ title: "身份与年龄核验说明", paragraphs: ageNotice().paragraphs }] : [])],
  };
}
async function erase(payload: Payload, owner: string) {
  return withCredentialLock(owner, async () => {
    await deleteProfileImages(payload, owner);
    for (const collection of ["age-profiles", "wechat-identities", "privacy-profiles"] as const) {
      const result = await payload.delete({ collection, overrideAccess: true, where: { owner: { equals: owner } } });
      if (result.errors.length) throw new AppError(503, "部分预览数据尚未清理，请重试");
    }
    await revokeCredentials(payload, owner);
  });
}
// This separate process has no generation/upload/MCP handler. It never mounts
// the live database or loads model credentials. Full app readiness stays intact.
export async function onboardingPreview(payload: Payload, request: Request) {
  try {
    if (!wechatConfigured() || (agePreviewEnabled() ? !providerConfigured() : providerConfigured())) throw new AppError(503, "预览配置与当前开放范围不一致");
    const path = new URL(request.url).pathname.replace(/^\/api\/hello\//, "").split("/");
    if (request.method === "GET" && new URL(request.url).pathname === "/api/ready") {
      await payload.count({ collection: "wechat-identities", overrideAccess: true });
      return json({ ok: true, service: "hello-agent-onboarding-preview", scope: agePreviewEnabled() ? "login-and-age" : "login-and-birthday", release: process.env.HELLO_RELEASE });
    }
    if (request.method === "GET" && path[0] === "config") return json({ platformConfigured: false, model: "", origin: process.env.HELLO_ORIGIN, advertisement: { mode: "disabled", adUnitId: "", demoSeconds: 0 } });
    if (request.method === "GET" && path[0] === "legal") return json(previewPolicy());
    if (request.method === "POST" && ["wechat-login", "miniapp-identity"].includes(path[0])) {
      if (request.headers.has("origin")) throw new AppError(403, "请在微信小程序中体验登录");
      rateLimitLogin(request, `onboarding:${path[0]}`);
      return json(path[0] === "wechat-login" ? await wechatLogin(payload, request, await readJson(request, PROFILE_BODY_LIMIT)) : await mintCredential(payload, "miniapp"));
    }
    const owner = await authenticate(payload, request);
    if (owner.auth !== "miniapp") throw new AppError(403, "请在微信小程序中体验登录");
    if (request.method === "POST") checkClientRequest(request, owner);
    rateLimit(owner.id);
    if (request.method === "POST" && path[0] === "privacy" && ["delete", "logout"].includes(path[1])) {
      const body = path[1] === "delete" ? await readJson(request, 1024) : undefined;
      return await withCredentialLock(owner.id, async () => {
        const current = await authenticate(payload, request);
        if (current.id !== owner.id) throw new AppError(401, "身份已变更，请重新登录");
        if (path[1] === "logout") { await revokeCredentials(payload, current.id); return json({ loggedOut: true, notice: "已退出本次预览，可再次微信登录。" }); }
        if (!body || typeof body !== "object" || !("confirmation" in body) || body.confirmation !== "删除我的全部在线数据") throw new AppError(400, "请确认删除预览数据");
        await erase(payload, current.id);
        return json({ deleted: true, operations: { erased: 0, held: 0, notice: "本预览不接收聊天或审核案件。" }, backupNotice: "已清除本预览的在线登录、昵称头像和年龄申报记录。" });
      });
    }
    return await withAuthenticatedExecution(payload, request, owner, async (current) => {
      const age = new AgeService(payload, current);
      if (request.method === "GET") {
        if (path[0] === "age") return json(previewStatus(await age.status()));
        if (path[0] === "profile") {
          await age.requireLogin();
          if (path.length === 1) return json(await readProfile(payload, current.id));
          if (path.length === 2 && path[1] === "avatar") return avatarResponse(payload, current.id);
        }
        if (path[0] === "sessions") {
          await age.requireLogin();
          const rows = await payload.find({ collection: "sessions", overrideAccess: true, where: { owner: { equals: current.id } }, limit: 100 });
          return json(rows.docs.map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt })));
        }
        if (path[0] === "privacy" && path[1] === "export") {
          const profile = await ageProfile(payload, current.id);
          return json({ userProfile: await exportProfile(payload, current.id), format: "hello-onboarding-preview-v1", exportedAt: new Date().toISOString(), loggedIn: (await age.status()).loggedIn, ageDeclaration: profile?.declaration || null, ageState: profile?.state || "unverified", noticeVersion: profile?.noticeVersion || null, consentedAt: profile?.consentedAt || null, ageVerification: profile ? { source: profile.source || null, reference: profile.reference || null, assurance: profile.assurance || null, verifiedAt: profile.verifiedAt || null, expiresAt: profile.expiresAt || null } : null, notice: "仅包含本预览记录；完整生日、姓名和身份证原文不保存，未收集聊天。" });
        }
        if (path[0] === "privacy" && !path[1]) return json({ policy: previewPolicy(), state: "unaccepted", consent: null, expiresAt: null, hasRecoveryCode: false });
      }
      if (request.method === "POST" && path[0] === "age") {
        if (path[1] === "challenge") { const result = await age.challenge(await readJson(request, 2048)); return json({ ...result, status: previewStatus(result.status) }); }
        if (path[1] === "submit" && agePreviewEnabled()) return json(previewStatus(await age.submit(await readJson(request, 2048))));
        if (path[1] === "cancel") return json(previewStatus(await age.cancel()));
      }
      throw new AppError(503, "本次预览仅开放微信登录和生日窗口，其他功能尚未开放。");
    });
  } catch (error) { return failure(error); }
}
export async function cleanOnboardingPreview(payload: Payload) {
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  for (const collection of ["wechat-identities", "age-profiles"] as const) {
    let cursor = 0;
    while (true) {
      const rows = await payload.find({ collection, overrideAccess: true, limit: 100, sort: "id", depth: 0, select: { id: true, owner: true }, where: { and: [{ id: { greater_than: cursor } }, { updatedAt: { less_than: cutoff } }] } });
      for (const row of rows.docs) {
        const other = await payload.count({ collection: collection === "wechat-identities" ? "age-profiles" : "wechat-identities", overrideAccess: true, where: { and: [{ owner: { equals: row.owner } }, { updatedAt: { greater_than_equal: cutoff } }] } });
        if (!other.totalDocs) await erase(payload, row.owner);
      }
      if (rows.docs.length < 100) break;
      cursor = rows.docs[rows.docs.length - 1].id;
    }
  }
  for (const collection of ["credentials", "age-locks"] as const) {
    const result = await payload.delete({ collection, overrideAccess: true, where: { expiresAt: { less_than: new Date().toISOString() } } });
    if (result.errors.length) throw new Error("Preview expiry cleanup failed");
  }
}
