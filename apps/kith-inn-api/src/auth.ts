import type { ErrorCode, ErrorDetails } from "@cfp/kith-inn-contracts";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, readonly message: string, readonly details?: ErrorDetails) {
    super(message);
  }
}

export function createWechatExchanger(input: {
  appId: string; appSecret: string; fetcher?: typeof fetch;
}) {
  return async (code: string): Promise<string> => {
    try {
      const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
      url.search = new URLSearchParams({
        appid: input.appId, secret: input.appSecret,
        js_code: code, grant_type: "authorization_code"
      }).toString();
      const response = await (input.fetcher ?? fetch)(url, {
        signal: AbortSignal.timeout(3_000), redirect: "error"
      });
      if (!response.ok) throw new Error();
      const payload = await response.json() as Record<string, unknown> | null;
      if (!payload || (payload.errcode !== undefined && payload.errcode !== 0) ||
          typeof payload.openid !== "string" || !payload.openid.trim()) throw new Error();
      return payload.openid;
    } catch {
      throw new ApiError(502, "WECHAT_LOGIN_FAILED", "微信登录暂不可用，请重新登录");
    }
  };
}
