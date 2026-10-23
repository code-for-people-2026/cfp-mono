import { describe, expect, it, vi } from "vitest";
import { chatProviderFromEnv, OpenAIChatProvider } from "../src/chat/provider";
import type { ProviderInput } from "../src/chat/contracts";

const input: ProviderInput = {
  instructions: "Only use the authorized tools.",
  messages: [{ role: "user", content: [{ type: "text", text: "查看这张尿布照片" }, { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }] }],
  tools: [{ name: "bubu_get_rules", description: "Current rules", inputSchema: { type: "object", properties: { type: { type: "string" } } } }],
};
const completion = (name = "bubu_get_rules", args = '{"type":"DIAPER"}', reason = "tool_calls") => ({ choices: [{ finish_reason: reason, message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: args } }] } }] });
describe("chat OpenAI-compatible production provider boundary", () => {
  it("sends real vision/tool payload with credentials only in the transport and preserves tool-call correspondence", async () => {
    const network = vi.fn<typeof fetch>(async () => Response.json(completion()));
    const provider = new OpenAIChatProvider({ apiKey: "private-provider-secret", model: "configured-vision-model", baseUrl: "https://provider.example/v1", fetch: network });
    const result = await provider.complete(input);
    expect(result).toEqual({ text: "", calls: [{ id: "call_1", name: "bubu_get_rules", arguments: { type: "DIAPER" } }] });
    const [url, request] = network.mock.calls[0]!;
    expect(String(url)).toBe("https://provider.example/v1/chat/completions");
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer private-provider-secret");
    expect(request?.redirect).toBe("error");
    const payload = JSON.parse(String(request?.body));
    expect(payload).toMatchObject({ model: "configured-vision-model", stream: false, max_completion_tokens: 4000, parallel_tool_calls: false });
    expect(payload.messages[1].content[1].image_url.url).toBe("data:image/png;base64,aW1hZ2U=");
    expect(String(request?.body)).not.toContain("private-provider-secret");
    await provider.complete({ ...input, messages: [
      { role: "assistant", content: null, toolCalls: result.calls },
      { role: "tool", content: '{"missing":["hasPee"]}', toolCallId: "call_1" },
    ] });
    const followup = JSON.parse(String(network.mock.calls[1]![1]?.body));
    expect(followup.messages[1].tool_calls[0].id).toBe("call_1");
    expect(followup.messages[2].tool_call_id).toBe("call_1");
  });
  it.each([
    ["unknown tool", completion("bubu_collector")],
    ["truncated output", completion("bubu_get_rules", "{}", "length")],
    ["invalid arguments", completion("bubu_get_rules", "{broken")],
  ])("rejects %s without accepting partial output", async (_name, body) => {
    const provider = new OpenAIChatProvider({ apiKey: "key", model: "vision", fetch: async () => Response.json(body) });
    await expect(provider.complete(input)).rejects.toMatchObject({ code: "CHAT_PROVIDER_RESPONSE_INVALID" });
  });
  it("does not expose provider failures, credentials or original causes", async () => {
    const provider = new OpenAIChatProvider({ apiKey: "private-secret", model: "vision", fetch: async () => new Response("private-secret and customer image", { status: 401 }) });
    const failure = await provider.complete(input).catch(error => error);
    expect(failure.code).toBe("CHAT_PROVIDER_UNAVAILABLE");
    expect(`${String(failure)} ${JSON.stringify(failure)}`).not.toMatch(/private-secret|customer image/);
    expect(failure.cause).toBeUndefined();
  });
  it("missing configuration never selects a mock, and credential-bearing or insecure endpoints are rejected", () => {
    expect(chatProviderFromEnv({})).toBeUndefined();
    expect(chatProviderFromEnv({ BUBU_CHAT_API_KEY: "key" })).toBeUndefined();
    expect(() => new OpenAIChatProvider({ apiKey: "key", model: "vision", baseUrl: "http://public.example/v1" })).toThrow();
    expect(() => new OpenAIChatProvider({ apiKey: "key", model: "vision", baseUrl: "https://secret@provider.example/v1" })).toThrow();
  });
});
