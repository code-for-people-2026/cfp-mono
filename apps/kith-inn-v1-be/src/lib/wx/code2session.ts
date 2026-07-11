const WX_CODE2SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session";
const INVALID_CODE_ERRCODES = new Set([40029, 40163]);

export type Code2SessionDeps = { fetch?: typeof fetch };

export class Code2SessionError extends Error {
  constructor(public readonly kind: "invalid" | "unavailable", message: string) {
    super(message);
  }
}

export async function code2session(code: string, deps: Code2SessionDeps = {}): Promise<string> {
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appid || !secret) throw new Code2SessionError("unavailable", "WX_APPID/WX_SECRET not configured");
  const url = `${WX_CODE2SESSION_URL}?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const response = await (deps.fetch ?? fetch)(url);
  if (!response.ok) throw new Code2SessionError("unavailable", `code2session failed: ${response.status}`);
  const body = await response.json() as { openid?: unknown; errcode?: unknown; errmsg?: unknown };
  if (typeof body.openid !== "string" || body.openid === "") {
    throw new Code2SessionError(
      typeof body.errcode === "number" && INVALID_CODE_ERRCODES.has(body.errcode) ? "invalid" : "unavailable",
      `code2session failed: ${typeof body.errmsg === "string" ? body.errmsg : "no openid"}`
    );
  }
  return body.openid;
}
