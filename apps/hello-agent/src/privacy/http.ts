import { z } from "zod";
import type { Payload } from "payload";
import type { Owner } from "../domain/contracts";
import { AppError } from "../domain/contracts";
import { privacyService, withRecoveredOwner } from "./service";
import { privacyPolicy } from "./policy";
import { escapeHtml } from "../labeling/metadata";
import { authenticate, checkOrigin, COOKIE, mintCredential } from "../server/auth";
import { rateLimit, readJson } from "../server/http";
import { beginPrivacyExport } from "./export-limits";
import { limitRecoveryCaller, limitRecoveryLookup } from "./recovery-limits";
import { withRecovery } from "./recovery-lock";
import { withCredentialLock } from "../server/credential-lock";

const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
export function legalPage() {
  const policy = privacyPolicy();
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>阿 Q 先生 · 隐私与协议</title><style>body{max-width:760px;margin:auto;padding:24px;font:17px/1.8 system-ui;color:#142f29}p{white-space:pre-wrap}h1{font-size:26px}</style></head><body><h1>隐私政策、服务协议与第三方说明</h1><p>版本 ${escapeHtml(policy.version)} · ${policy.ready ? "运营资料已配置" : "本地验收版本，运营资料尚待确认"}</p>${policy.documents.map((doc) => `<section><h2>${escapeHtml(doc.title)}</h2>${doc.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}</section>`).join("")}</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'", "X-Content-Type-Options": "nosniff" } });
}
export async function recoveryResponse(payload: Payload, request: Request) {
  if (request.headers.has("origin")) checkOrigin(request);
  limitRecoveryCaller(request);
  const body = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), native: z.boolean().optional() }).strict().parse(await readJson(request, 2048));
  const native = body.native === true;
  if (native && request.headers.has("origin")) throw new AppError(403, "浏览器请使用访客 Cookie 入口");
  if (!native) checkOrigin(request);
  limitRecoveryLookup();
  return withRecovery(body.code, () => withRecoveredOwner(payload, body.code, async (owner) => {
    const credential = await mintCredential(payload, native ? "miniapp" : "cookie", owner);
    const response = json(native ? credential : { owner });
    if (!native) response.headers.set("Set-Cookie", `${COOKIE}=${credential.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${(process.env.HELLO_ORIGIN || "").startsWith("https:") ? "; Secure" : ""}`);
    return response;
  }));
}
export async function privacyGet(payload: Payload, owner: Owner, action: string | undefined) {
  if (owner.auth === "bearer") throw new AppError(403, "请本人打开隐私与数据页面");
  const service = privacyService(payload, owner);
  if (!action) return json(await service.status());
  if (action === "export") {
    const release = beginPrivacyExport(owner.id);
    try {
      const response = json(await service.exportData());
      response.headers.set("Content-Disposition", 'attachment; filename="aj-personal-data.json"');
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    } finally { release(); }
  }
  throw new AppError(404, "接口不存在");
}
export async function privacyPost(payload: Payload, owner: Owner, action: string | undefined, request: Request) {
  if (owner.auth === "bearer") throw new AppError(403, "外部连接不能代替你管理隐私授权或删除数据");
  rateLimit(`privacy-control:${owner.id}`);
  // Read potentially slow bodies before taking the owner gate. The credential
  // can be revoked while reading, so only the in-gate authentication authorizes
  // the mutation. Internal maintenance uses the service directly, without HTTP.
  const body = action === "consent" ? await readJson(request, 4096) : action === "delete" ? await readJson(request, 1024) : undefined;
  return withCredentialLock(owner.id, async () => {
    const current = await authenticate(payload, request);
    if (current.id !== owner.id || current.auth === "bearer") throw new AppError(401, "连接身份已失效，请重新连接");
    const service = privacyService(payload, current);
    if (action === "consent") return json(await service.consent(body));
    if (action === "withdraw") return json(await service.withdraw());
    if (action === "recovery-code") return json(await service.recoveryCode());
    if (action === "delete") {
      if (!body || typeof body !== "object" || !("confirmation" in body) || body.confirmation !== "删除我的全部在线数据") throw new AppError(400, "请明确确认删除全部在线数据");
      const response = json(await service.deleteData());
      response.headers.set("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return response;
    }
    if (action === "logout") {
      await service.revoke();
      const response = json({ loggedOut: true, notice: "已撤销该身份的全部连接；数据仍保留，找回需要恢复码" });
      response.headers.set("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return response;
    }
    throw new AppError(404, "接口不存在");
  });
}
