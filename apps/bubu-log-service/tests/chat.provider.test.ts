import { describe, expect, it, vi } from "vitest";
import { chatProviderFromEnv, OpenAIChatProvider } from "../src/chat/provider";
import type { ProviderInput } from "../src/chat/contracts";
import { replyCandidateJsonSchema } from "../src/chat/reply-gate";

const input: ProviderInput = {
  instructions: "Only use the authorized tools.",
  messages: [{ role: "user", content: [{ type: "text", text: "查看这张尿布照片" }, { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } }] }],
  tools: [{ name: "bubu_get_rules", description: "Current rules", inputSchema: { type: "object", properties: { type: { type: "string" } } } }],
  responseFormat: { name: "bubu_chat_reply", schema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } } },
};
const completion = (name = "bubu_get_rules", args = '{"type":"DIAPER"}', reason = "tool_calls") => ({ choices: [{ finish_reason: reason, message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: args } }] } }] });
describe("chat OpenAI-compatible production provider boundary", () => {
  it("sends real vision/tool payload with credentials only in the transport and preserves tool-call correspondence", async () => {
    const network = vi.fn<typeof fetch>(async () => Response.json(completion()));
    const provider = new OpenAIChatProvider({ apiKey: "private-provider-secret", model: "configured-vision-model", baseUrl: "https://provider.example/v1", structuredOutputMode: "json_schema", fetch: network });
    const result = await provider.complete(input);
    expect(result).toEqual({ text: "", calls: [{ id: "call_1", name: "bubu_get_rules", arguments: { type: "DIAPER" } }] });
    const [url, request] = network.mock.calls[0]!;
    expect(String(url)).toBe("https://provider.example/v1/chat/completions");
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer private-provider-secret");
    expect(request?.redirect).toBe("error");
    const payload = JSON.parse(String(request?.body));
    expect(payload).toMatchObject({ model: "configured-vision-model", stream: false, max_completion_tokens: 4000, parallel_tool_calls: false });
    expect(payload.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "bubu_chat_reply", strict: true } });
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
  it("uses DeepSeek Chat Completions json_object without exposing tools on reply-only checks", async () => {
    const network = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"verdict":"pass","issues":[]}' } }] }));
    const provider = new OpenAIChatProvider({ apiKey: "secret", model: "deepseek-flash", baseUrl: "https://api.deepseek.com", fetch: network });
    await provider.complete({ ...input, instructions: "Return the verdict.", messages: [{ role: "user", content: "candidate" }], tools: [] });
    const payload = JSON.parse(String(network.mock.calls[0]![1]?.body));
    expect(payload.response_format).toEqual({ type: "json_object" });
    expect(payload.messages[0].content).toContain('"type":"object"');
    expect(payload).toMatchObject({ model: "deepseek-flash", max_tokens: 1200, thinking: { type: "disabled" } });
    expect(payload).not.toHaveProperty("tools");
    expect(payload).not.toHaveProperty("tool_choice");
    expect(payload).not.toHaveProperty("parallel_tool_calls");
    expect(payload).not.toHaveProperty("max_completion_tokens");
  });
  it("disables DeepSeek thinking on both requests of a serialized tool round trip", async () => {
    let requestCount = 0;
    const network = vi.fn<typeof fetch>(async () => ++requestCount === 1
      ? Response.json(completion())
      : Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"text":"规则已读取"}' } }] }));
    const provider = new OpenAIChatProvider({ apiKey: "secret", model: "deepseek-flash", baseUrl: "https://api.deepseek.com", fetch: network });
    const first = await provider.complete(input);
    expect(first.calls).toHaveLength(1);
    const second = await provider.complete({ ...input, messages: [
      ...input.messages,
      { role: "assistant", content: null, toolCalls: first.calls },
      { role: "tool", content: '{"missing":["hasPee"]}', toolCallId: first.calls[0]!.id },
    ] });
    expect(second).toEqual({ text: '{"text":"规则已读取"}', calls: [] });
    type DeepSeekRequest = { thinking?: { type?: string }; response_format?: { type?: string }; messages: Array<{ role?: string; tool_call_id?: string; tool_calls?: Array<{ id: string; function: { name: string } }> }> };
    const requests = network.mock.calls.map(call => JSON.parse(String(call[1]?.body)) as DeepSeekRequest);
    expect(requests).toHaveLength(2);
    expect(requests.every(payload => payload.thinking?.type === "disabled")).toBe(true);
    expect(requests.every(payload => payload.response_format?.type === "json_object")).toBe(true);
    expect(requests[1]!.messages.at(-2)!.tool_calls![0]).toMatchObject({ id: "call_1", function: { name: "bubu_get_rules" } });
    expect(requests[1]!.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1" });
  });
  it("keeps OpenAI strict schema and uses anyOf for the supported reply union", async () => {
    const network = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }));
    const provider = new OpenAIChatProvider({ apiKey: "secret", model: "gpt", fetch: network });
    await provider.complete({ ...input, tools: [], responseFormat: { name: "bubu_chat_reply", schema: replyCandidateJsonSchema } });
    const payload = JSON.parse(String(network.mock.calls[0]![1]?.body));
    expect(payload.response_format.type).toBe("json_schema");
    expect(payload.response_format.json_schema.strict).toBe(true);
    const schemaText = JSON.stringify(payload.response_format.json_schema.schema);
    expect(schemaText).toContain('"anyOf"');
    expect(schemaText).not.toContain('"oneOf"');
  });
  it("sends the locally validated dynamic batch schema as explicitly non-strict", async () => {
    const network = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"answers":[]}' } }] }));
    const provider = new OpenAIChatProvider({ apiKey: "secret", model: "gpt", fetch: network });
    const schema = { type: "object", properties: { answers: { type: "array", items: { type: "object", additionalProperties: true } } } };
    await provider.complete({ ...input, tools: [], responseFormat: { name: "bubu_form_batch_parse", schema, strict: false } });
    const payload = JSON.parse(String(network.mock.calls[0]![1]?.body));
    expect(payload.response_format).toEqual({ type: "json_schema", json_schema: { name: "bubu_form_batch_parse", strict: false, schema } });
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
    expect(() => new OpenAIChatProvider({ apiKey: "key", model: "vision", baseUrl: "https://provider.example/v1" })).toThrow(/明确配置/);
    expect(() => chatProviderFromEnv({ BUBU_CHAT_API_KEY: "key", BUBU_CHAT_MODEL: "vision", BUBU_CHAT_BASE_URL: "https://provider.example/v1", BUBU_CHAT_STRUCTURED_OUTPUT_MODE: "guess" })).toThrow();
  });
});
