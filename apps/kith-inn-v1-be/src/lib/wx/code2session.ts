const WX_CODE2SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session";

export type Code2SessionDeps = { fetch?: typeof fetch };

export async function code2session(code: string, deps: Code2SessionDeps = {}): Promise<string> {
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appid || !secret) throw new Error("WX_APPID/WX_SECRET not configured");
  const url = `${WX_CODE2SESSION_URL}?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const response = await (deps.fetch ?? fetch)(url);
  if (!response.ok) throw new Error(`code2session failed: ${response.status}`);
  const body = await response.json() as { openid?: unknown; errmsg?: unknown };
  if (typeof body.openid !== "string" || body.openid === "") {
    throw new Error(`code2session failed: ${typeof body.errmsg === "string" ? body.errmsg : "no openid"}`);
  }
  return body.openid;
}
