import { afterEach, expect, it, vi } from "vitest";
import { rateLimitLogin } from "./login-limits";

afterEach(() => vi.unstubAllEnvs());
it("重复登录只耗尽自己的限额，不阻断其他来源", () => {
  vi.stubEnv("HELLO_TRUST_PROXY", "true");
  const request = (ip: string) => new Request("https://example.test", { headers: { "x-real-ip": ip } });
  for (let i = 0; i < 20; i++) rateLimitLogin(request("192.0.2.1"), "login-test");
  expect(() => rateLimitLogin(request("192.0.2.1"), "login-test")).toThrow("操作较频繁");
  expect(() => rateLimitLogin(request("192.0.2.2"), "login-test")).not.toThrow();
  expect(() => rateLimitLogin(new Request("https://example.test", { headers: { "x-forwarded-for": "192.0.2.3" } }), "login-test")).toThrow("来源校验");
});
