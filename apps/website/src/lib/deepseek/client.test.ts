import { afterEach, describe, expect, it, vi } from "vitest";
import { callDeepSeek } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: "回答内容" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
    model: string;
  };
}

describe("callDeepSeek (website)", () => {
  it("falls back to defaults when DEEPSEEK_BASE_URL and DEEPSEEK_MODEL are empty strings", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_BASE_URL", "");
    vi.stubEnv("DEEPSEEK_MODEL", "");
    const fetchMock = mockFetchOk();

    await callDeepSeek({ messages: [{ role: "user", content: "hello" }], maxTokens: 300 });

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
    expect(requestBody(fetchMock).model).toBe("deepseek-v4-pro");
  });

  it("uses an explicitly configured model", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://api.deepseek.com");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-flash");
    const fetchMock = mockFetchOk();

    await callDeepSeek({ messages: [{ role: "user", content: "hi" }], maxTokens: 100 });

    expect(requestBody(fetchMock).model).toBe("deepseek-v4-flash");
  });
});
