import { afterEach, describe, expect, it, vi } from "vitest";
import { callDeepSeek } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("callDeepSeek", () => {
  it("sends an OpenAI-compatible chat completion request", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-chat");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "回答内容" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callDeepSeek({
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "hello" },
      ],
      maxTokens: 300,
    });

    expect(result).toBe("回答内容");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
          "content-type": "application/json",
        }),
      }),
    );
  });

  it("falls back to defaults when DEEPSEEK_BASE_URL and DEEPSEEK_MODEL are empty strings", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_BASE_URL", "");
    vi.stubEnv("DEEPSEEK_MODEL", "");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "回答内容" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callDeepSeek({ messages: [{ role: "user", content: "hello" }], maxTokens: 300 });

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      model: string;
    };
    expect(body.model).toBe("deepseek-v4-pro");
  });
});
