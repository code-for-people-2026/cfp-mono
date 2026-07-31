import { describe, expect, it } from "vitest";
import { clientFeedback } from "./client-feedback";

describe("客户端安全反馈", () => {
  it.each(["LOGIN_REQUIRED", "SESSION_REQUIRED", "SESSION_EXPIRED"])(
    "%s 会提示重新登录并返回首页",
    (code) => {
      expect(clientFeedback({ code }, "读取失败")).toEqual({
        returnHome: true,
        title: "登录已失效，请重新登录"
      });
    }
  );

  it("只使用稳定错误码，不显示原始敏感错误", () => {
    const secret = "code-token-openid-upstream-detail";
    const feedback = clientFeedback(
      {
        code: "REQUEST_FAILED",
        backendCode: "PLAN_NOT_FOUND",
        message: secret
      },
      "读取失败"
    );
    expect(feedback).toEqual({
      returnHome: false,
      title: "菜单不存在或已删除"
    });
    expect(JSON.stringify(feedback)).not.toContain(secret);

    const fallback = clientFeedback(new Error(secret), "操作失败，请重试");
    expect(fallback.title).toBe("操作失败，请重试");
    expect(JSON.stringify(fallback)).not.toContain(secret);
    expect(clientFeedback(null, "读取失败").title).toBe("读取失败");
    expect(clientFeedback(secret, "读取失败").title).toBe("读取失败");
  });

  it("为网络、限流和不可变状态提供可恢复提示", () => {
    expect(clientFeedback({ code: "LOGIN_FAILED" }, "失败").title).toBe(
      "微信登录失败，请重试"
    );
    expect(clientFeedback({ code: "CONFIG_REQUIRED" }, "失败").title).toBe(
      "真实 API 尚未配置"
    );
    expect(clientFeedback({ code: "API_UNAVAILABLE" }, "失败").title).toBe(
      "服务暂时不可用，请稍后重试"
    );
    expect(
      clientFeedback({ code: "REQUEST_FAILED", backendCode: "RATE_LIMITED" }, "失败")
        .title
    ).toBe("操作太频繁，请稍后重试");
    expect(clientFeedback({ code: "PLAN_IMMUTABLE" }, "失败").title).toBe(
      "菜单已确认，不能再修改"
    );
  });
});
