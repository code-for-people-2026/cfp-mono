import { afterEach, describe, expect, it, vi } from "vitest";
import { code2session } from "./code2session";

const ORIG_APPID = process.env.WX_APPID;
const ORIG_SECRET = process.env.WX_SECRET;
afterEach(() => {
  process.env.WX_APPID = ORIG_APPID;
  process.env.WX_SECRET = ORIG_SECRET;
  vi.unstubAllGlobals();
});

const ok = (openid: string) => ({
  fetch: vi.fn(async () => new Response(JSON.stringify({ openid }))),
});

describe("code2session", () => {
  it("returns the openid on success", async () => {
    process.env.WX_APPID = "appid";
    process.env.WX_SECRET = "secret";
    expect(await code2session("the-code", ok("openid-1"))).toBe("openid-1");
  });

  it("calls the auth.code2Session endpoint with the code", async () => {
    process.env.WX_APPID = "appid";
    process.env.WX_SECRET = "secret";
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ openid: "o" })));
    await code2session("the-code", { fetch: fetchMock });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/sns/jscode2session");
    expect(url).toContain("js_code=the-code");
  });

  it("throws when WX_APPID/WX_SECRET are not configured", async () => {
    delete process.env.WX_APPID;
    delete process.env.WX_SECRET;
    await expect(code2session("c", ok("x"))).rejects.toThrow(/WX_APPID\/WX_SECRET/);
  });

  it("throws when WeChat returns an error (no openid)", async () => {
    process.env.WX_APPID = "appid";
    process.env.WX_SECRET = "secret";
    const failing = {
      fetch: vi.fn(async () => new Response(JSON.stringify({ errcode: 40029, errmsg: "invalid code" }))),
    };
    await expect(code2session("bad", failing)).rejects.toThrow(/code2session failed: invalid code/);
  });

  it("throws 'no openid' when the response has neither openid nor errmsg", async () => {
    process.env.WX_APPID = "appid";
    process.env.WX_SECRET = "secret";
    const empty = { fetch: vi.fn(async () => new Response(JSON.stringify({}))) };
    await expect(code2session("bad", empty)).rejects.toThrow(/code2session failed: no openid/);
  });
});

describe("code2session (global fetch fallback)", () => {
  it("uses the global fetch when no deps are provided", async () => {
    process.env.WX_APPID = "appid";
    process.env.WX_SECRET = "secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ openid: "openid-1" })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await code2session("the-code")).toBe("openid-1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
