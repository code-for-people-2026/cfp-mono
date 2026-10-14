import { withCredentialLock } from "../server/credential-lock";
import { createHash, randomUUID } from "node:crypto";
import type { Payload } from "payload";
import { z } from "zod";
import { AppError, type Owner } from "../domain/contracts";
import { authenticate, mintCredential, checkClientRequest, revokeCredentials } from "../server/auth";
import { withAgeLock } from "./lock";
import { ageNotice, wechatConfigured } from "./policy";

export type WechatExchange = (code: string) => Promise<string>;
export const exchangeWechat: WechatExchange = async (code) => {
  if (!wechatConfigured()) throw new AppError(503, "微信登录尚未配置，请联系运营方；不会用访客身份冒充微信登录");
  try {
    const query = new URLSearchParams({ appid: process.env.HELLO_WECHAT_APP_ID!, secret: process.env.HELLO_WECHAT_APP_SECRET!, js_code: code, grant_type: "authorization_code" });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`, { signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store" });
    if (!response.ok) throw new Error("wechat unavailable");
    const data = await response.json();
    if (data.errcode || typeof data.openid !== "string" || !/^[A-Za-z0-9_-]{10,128}$/.test(data.openid)) throw new Error("invalid login response");
    // session_key and unionid are not needed and are discarded.
    return createHash("sha256").update(`${process.env.HELLO_WECHAT_APP_ID}:${data.openid}`).digest("hex");
  } catch { throw new AppError(502, "微信登录未完成，请重新点击登录；请勿提供他人身份信息"); }
};
const loginSchema = z.object({ code: z.string().min(1).max(256), consent: z.literal(true), noticeVersion: z.string().max(100), migrateCurrent: z.boolean() }).strict();
export async function wechatLogin(payload: Payload, request: Request, body: unknown, exchange: WechatExchange = exchangeWechat) {
  if (request.headers.has("origin")) throw new AppError(403, "请在微信小程序中完成微信登录");
  const input = loginSchema.parse(body);
  if (input.noticeVersion !== ageNotice().version) throw new AppError(409, "登录与年龄说明已更新，请重新阅读后登录");
  let current: Owner | undefined;
  if (request.headers.has("authorization")) {
    current = await authenticate(payload, request);
    checkClientRequest(request, current);
    if (current.auth !== "miniapp") throw new AppError(403, "外部连接不能用于微信身份绑定");
  }
  const key = await exchange(input.code);
  // jscode2session consumes a short-lived, one-time platform code. Client OpenID
  // or owner parameters are never accepted. DB locks serialize both identities.
  return withAgeLock(payload, `wx:${key}`, async (assertLease) => {
    const existing = (await payload.find({ collection: "wechat-identities", overrideAccess: true, limit: 1, where: { key: { equals: key } } })).docs[0];
    if (existing) return withCredentialLock(existing.owner, async () => {
      await assertLease();
      await payload.update({ collection: "wechat-identities", overrideAccess: true, id: existing.id, data: { noticeVersion: input.noticeVersion, consentedAt: new Date().toISOString() } });
      return { ...(await mintCredential(payload, "miniapp", String(existing.owner), key)), history: current?.id === existing.owner ? "kept" : "wechat_restored" };
    });
    const bind = async () => {
      if (current) {
        const checked = await authenticate(payload, request);
        if (checked.id !== current.id || checked.auth !== "miniapp") throw new AppError(401, "连接身份已变更，请重新登录");
        current = checked;
      }
      const bound = current && (await payload.find({ collection: "wechat-identities", overrideAccess: true, limit: 1, where: { owner: { equals: current.id } } })).docs[0];
      const profile = current && (await payload.find({ collection: "privacy-profiles", overrideAccess: true, limit: 1, select: { state: true }, where: { owner: { equals: current.id } } })).docs[0];
      const adopt = current && input.migrateCurrent && !bound && !["deleting", "deleted"].includes(String(profile?.state));
      const owner = adopt && current ? current.id : randomUUID();
      await assertLease();
      await payload.create({ collection: "wechat-identities", overrideAccess: true, data: { owner, key, noticeVersion: input.noticeVersion, consentedAt: new Date().toISOString() } });
      // Anonymous credentials cannot be used later to silently act as WeChat.
      if (adopt) await revokeCredentials(payload, owner);
      return { ...(await mintCredential(payload, "miniapp", owner, key)), history: adopt ? "kept" : "new" };
    };
    return current ? withCredentialLock(current.id, () => withAgeLock(payload, `owner:${current!.id}`, bind)) : bind();
  });
}
