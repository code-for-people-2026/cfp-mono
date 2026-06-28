/** Mini-program auth.code2Session endpoint (wx.login → code → openid). */
const WX_CODE2SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session";

export type Code2SessionDeps = { fetch?: typeof fetch };

/**
 * Exchange a `wx.login` code for an openid by calling the WeChat API. This is the
 * login trust root's first hop (Tech Spec §3.1). `fetch` is injectable so tests
 * stub the WeChat boundary instead of hitting the network.
 */
export async function code2session(code: string, deps: Code2SessionDeps = {}): Promise<string> {
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (!appid || !secret) throw new Error("WX_APPID/WX_SECRET not configured");
  const url = `${WX_CODE2SESSION_URL}?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const fetchImpl = deps.fetch ?? fetch;
  const res = await fetchImpl(url);
  const json = (await res.json()) as { openid?: string; errcode?: number; errmsg?: string };
  if (!json.openid) throw new Error(`code2session failed: ${json.errmsg ?? "no openid"}`);
  return json.openid;
}
