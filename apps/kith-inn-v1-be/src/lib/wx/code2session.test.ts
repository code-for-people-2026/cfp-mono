import { afterEach, describe, expect, it, vi } from "vitest";
import { code2session } from "./code2session";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("code2session", () => {
  it("exchanges an encoded code for openid", async () => {
    process.env.WX_APPID = "app id";
    process.env.WX_SECRET = "secret/value";
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ openid: "wx-openid" })));
    await expect(code2session("code+value", { fetch: fetchMock })).resolves.toBe("wx-openid");
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://api.weixin.qq.com/sns/jscode2session?appid=app%20id&secret=secret%2Fvalue&js_code=code%2Bvalue&grant_type=authorization_code"
    );
  });

  it("fails closed for missing configuration, non-ok, malformed or empty responses", async () => {
    delete process.env.WX_APPID;
    delete process.env.WX_SECRET;
    await expect(code2session("code")).rejects.toThrow(/WX_APPID/);
    process.env.WX_APPID = "app";
    process.env.WX_SECRET = "secret";
    await expect(code2session("code", { fetch: vi.fn(async () => new Response("{}", { status: 500 })) })).rejects.toThrow(/500/);
    await expect(code2session("code", { fetch: vi.fn(async () => new Response("not-json")) })).rejects.toThrow();
    await expect(code2session("code", { fetch: vi.fn(async () => new Response(JSON.stringify({ errcode: 1, errmsg: "bad code" }))) })).rejects.toThrow(/bad code/);
    await expect(code2session("code", { fetch: vi.fn(async () => new Response("{}")) })).rejects.toThrow(/no openid/);
  });

  it("uses global fetch when no dependency is injected", async () => {
    process.env.WX_APPID = "app";
    process.env.WX_SECRET = "secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ openid: "global-openid" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(code2session("code")).resolves.toBe("global-openid");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
