import { randomBytes, randomUUID, createHash } from "node:crypto";
import type { Payload } from "payload";
import { AppError, type Owner } from "../domain/contracts";

export const COOKIE = "hello_identity";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function checkOrigin(request: Request) {
  const allowed = process.env.HELLO_ORIGIN || "http://127.0.0.1:3310";
  if (request.headers.get("origin") !== allowed)
    throw new AppError(403, "请求来源不受信任");
}

export function checkClientRequest(request: Request, owner: Owner) {
  // 微信原生请求不携带浏览器 Origin；仅已验证的小程序专用令牌可走此路径。
  if (owner.auth === "miniapp" && !request.headers.has("origin")) return;
  checkOrigin(request);
}

export async function mintCredential(
  payload: Payload,
  kind: Owner["auth"],
  owner: string = randomUUID(),
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + (kind === "bearer" ? 7 : 30) * 86400_000,
  ).toISOString();
  // 凭证仓库是认证模块的私有存储；只有这里允许提升权限，其他业务请求不能直接访问。
  await payload.create({
    collection: "credentials",
    overrideAccess: true,
    data: { owner, digest: digest(token), kind, expiresAt },
  });
  return { token, owner, expiresAt };
}

export async function authenticate(
  payload: Payload,
  request: Request,
  bearerOnly = false,
): Promise<Owner> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : undefined;
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const token = bearer || (!bearerOnly ? cookie : undefined);
  if (!token || token.length > 256)
    throw new AppError(401, "请重新打开页面或提供有效的连接令牌");
  const kinds = bearer
    ? bearerOnly
      ? ["bearer"]
      : ["bearer", "miniapp"]
    : ["cookie"];
  const result = await payload.find({
    collection: "credentials",
    overrideAccess: true,
    limit: 1,
    where: {
      and: [
        { digest: { equals: digest(token) } },
        { kind: { in: kinds } },
        { expiresAt: { greater_than: new Date().toISOString() } },
      ],
    },
  });
  if (!result.docs[0]) throw new AppError(401, "连接凭证无效或已过期");
  const kind = result.docs[0].kind;
  if (kind !== "cookie" && kind !== "bearer" && kind !== "miniapp")
    throw new AppError(401, "凭证类型无效");
  return { id: String(result.docs[0].owner), auth: kind };
}

export async function revokeTokens(payload: Payload, owner: Owner) {
  await payload.delete({
    collection: "credentials",
    overrideAccess: true,
    where: {
      and: [{ owner: { equals: owner.id } }, { kind: { equals: "bearer" } }],
    },
  });
}
