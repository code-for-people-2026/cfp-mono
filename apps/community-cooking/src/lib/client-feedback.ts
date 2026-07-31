export type ClientFeedback = Readonly<{
  returnHome: boolean;
  title: string;
}>;

function stableCode(error: unknown, key: "backendCode" | "code"): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)
    ? value
    : undefined;
}

export function clientFeedback(
  error: unknown,
  fallbackTitle: string
): ClientFeedback {
  const code = stableCode(error, "code");
  const backendCode = stableCode(error, "backendCode");

  if (
    code === "LOGIN_REQUIRED" ||
    code === "SESSION_EXPIRED" ||
    code === "SESSION_REQUIRED"
  ) {
    return { returnHome: true, title: "登录已失效，请重新登录" };
  }
  if (code === "LOGIN_FAILED") {
    return { returnHome: false, title: "微信登录失败，请重试" };
  }
  if (code === "CONFIG_REQUIRED") {
    return { returnHome: false, title: "真实 API 尚未配置" };
  }
  if (backendCode === "PLAN_IMMUTABLE" || code === "PLAN_IMMUTABLE") {
    return { returnHome: false, title: "菜单已确认，不能再修改" };
  }
  if (backendCode === "PLAN_NOT_FOUND" || code === "PLAN_NOT_FOUND") {
    return { returnHome: false, title: "菜单不存在或已删除" };
  }
  if (backendCode === "RATE_LIMITED") {
    return { returnHome: false, title: "操作太频繁，请稍后重试" };
  }
  if (
    code === "API_UNAVAILABLE" ||
    code === "REQUEST_FAILED" ||
    backendCode === "DEPENDENCY_UNAVAILABLE"
  ) {
    return { returnHome: false, title: "服务暂时不可用，请稍后重试" };
  }
  return { returnHome: false, title: fallbackTitle };
}
