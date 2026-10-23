import { afterEach, describe, expect, it, vi } from "vitest";
import { WechatCodeProvider } from "../src/wechat";

afterEach(() => { vi.restoreAllMocks(); });
const appId = "wx-test-app";
const secret = "secret&never=log-this";
const code = "one-time&code=proof";

describe("real WeChat code provider", () => {
  it("exchanges the one-time code only at the official HTTPS endpoint and discards provider secrets", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ openid: "verified-openid", session_key: "private-session-key", unionid: "unused-unionid", errcode: 0 }));
    const result = await new WechatCodeProvider(appId, secret, transport).exchange(code);
    expect(result).toEqual({ appId, openId: "verified-openid" });
    const [target, init] = transport.mock.calls[0]!;
    const url = new URL(String(target));
    expect(url.origin).toBe("https://api.weixin.qq.com");
    expect(url.pathname).toBe("/sns/jscode2session");
    expect(Object.fromEntries(url.searchParams)).toEqual({ appid: appId, secret, js_code: code, grant_type: "authorization_code" });
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(result)).not.toMatch(/session_key|unionid|private-session-key|never/);
  });

  it.each([["", secret], [appId, ""], ["", ""]])("fails closed before contacting WeChat when configuration is absent", async (id, key) => {
    const transport = vi.fn<typeof fetch>();
    await expect(new WechatCodeProvider(id!, key!, transport).exchange(code)).rejects.toMatchObject({ status: 503, code: "WECHAT_NOT_CONFIGURED" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["", "x".repeat(513)])("rejects an empty or oversized code before making a provider request", async (value) => {
    const transport = vi.fn<typeof fetch>();
    await expect(new WechatCodeProvider(appId, secret, transport).exchange(value)).rejects.toMatchObject({ status: 400, code: "INVALID_CODE" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([40029, 40163, 45011, -1, "40029"])("rejects WeChat errcode %s even if identity fields are present", async (errcode) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ errcode, errmsg: `provider echo ${secret} ${code}`, openid: "untrusted", session_key: "key" }));
    const exchange = new WechatCodeProvider(appId, secret, transport).exchange(code);
    await expect(exchange).rejects.toMatchObject({ status: 401, code: "WECHAT_LOGIN_FAILED", message: "微信凭证无效或已使用，请重新登录。" });
  });

  it.each([
    { session_key: "key" },
    { openid: "" , session_key: "key" },
    { openid: 123, session_key: "key" },
    { openid: "verified" },
    { openid: "verified", session_key: "" },
    { openid: "verified", session_key: 123 },
  ])("requires both verified openid and a valid provider session response: %j", async (body) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(new WechatCodeProvider(appId, secret, transport).exchange(code)).rejects.toMatchObject({ status: 401, code: "WECHAT_LOGIN_FAILED" });
  });

  it("does not accept identity fields from a failed HTTP response", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ openid: "forged", session_key: "key" }, { status: 503 }));
    await expect(new WechatCodeProvider(appId, secret, transport).exchange(code)).rejects.toMatchObject({ status: 401, code: "WECHAT_LOGIN_FAILED" });
  });

  it("enforces the ten-second timeout and replaces abort details with a safe error", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const transport: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error(`request timed out: ${secret} ${code}`)), { once: true });
    });
    const exchange = new WechatCodeProvider(appId, secret, transport).exchange(code);
    controller.abort();
    await expect(exchange).rejects.toMatchObject({ status: 503, code: "WECHAT_UNAVAILABLE", message: "暂时无法完成微信登录，请稍后重试。" });
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it.each([
    () => Promise.reject(new Error(`redirect rejected; URL contains ${secret} ${code}`)),
    () => Promise.resolve(new Response(`invalid JSON: ${secret}`, { status: 200 })),
  ])("sanitizes transport and parse failures without leaking secret, session key or login code", async (operation) => {
    const transport: typeof fetch = async () => operation();
    const exchange = new WechatCodeProvider(appId, secret, transport).exchange(code);
    await expect(exchange).rejects.toMatchObject({ status: 503, code: "WECHAT_UNAVAILABLE", message: "暂时无法完成微信登录，请稍后重试。" });
  });
});
