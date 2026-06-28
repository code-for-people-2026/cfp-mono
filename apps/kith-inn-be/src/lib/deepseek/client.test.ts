import { afterEach, describe, expect, it, vi } from "vitest";
import { callDeepSeek } from "./client";

const ORIG_KEY = process.env.DEEPSEEK_API_KEY;
afterEach(() => {
  process.env.DEEPSEEK_API_KEY = ORIG_KEY;
  vi.unstubAllGlobals();
});

const INPUT = { messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100 };

describe("callDeepSeek", () => {
  it("posts to /chat/completions and returns the trimmed content", async () => {
    process.env.DEEPSEEK_API_KEY = "key";
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: "  hello  " } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const content = await callDeepSeek(INPUT);
    expect(content).toBe("hello");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({
      method: "POST",
      headers: { authorization: "Bearer key", "content-type": "application/json" },
    });
  });

  it("throws when DEEPSEEK_API_KEY is missing", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(callDeepSeek(INPUT)).rejects.toThrow(/DEEPSEEK_API_KEY/);
  });

  it("throws on a non-2xx response", async () => {
    process.env.DEEPSEEK_API_KEY = "key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    await expect(callDeepSeek(INPUT)).rejects.toThrow(/DeepSeek request failed: 429/);
  });

  it("throws on an empty response", async () => {
    process.env.DEEPSEEK_API_KEY = "key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }))),
    );
    await expect(callDeepSeek(INPUT)).rejects.toThrow(/empty response/);
  });
});
