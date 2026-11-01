import { AppError, type WechatProvider } from "./contracts";
export class WechatCodeProvider implements WechatProvider {
  constructor(private appId: string, private secret: string, private transport: typeof fetch = fetch) {}
  async exchange(code: string) {
    if (!this.appId || !this.secret) throw new AppError(503, "WECHAT_NOT_CONFIGURED", "微信登录尚未配置，请联系管理员。");
    if (!code || code.length > 512) throw new AppError(400, "INVALID_CODE", "请重新发起微信登录。");
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.search = new URLSearchParams({ appid: this.appId, secret: this.secret, js_code: code, grant_type: "authorization_code" }).toString();
    try {
      const response = await this.transport(url, { redirect: "error", signal: AbortSignal.timeout(10000) });
      const data = await response.json() as { openid?: unknown; session_key?: unknown; errcode?: unknown };
      if (!response.ok || (data.errcode !== undefined && data.errcode !== 0) || typeof data.openid !== "string" || !data.openid || typeof data.session_key !== "string" || !data.session_key)
        throw new AppError(401, "WECHAT_LOGIN_FAILED", "微信凭证无效或已使用，请重新登录。");
      // Neither session_key, openid nor AppSecret leaves this provider boundary.
      return { appId: this.appId, openId: data.openid };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, "WECHAT_UNAVAILABLE", "暂时无法完成微信登录，请稍后重试。");
    }
  }
}
