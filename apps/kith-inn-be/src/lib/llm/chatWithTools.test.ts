import { afterEach, describe, expect, it, vi } from "vitest";
import { chatWithTools } from "./chatWithTools";

const ORIG_KEY = process.env.DEEPSEEK_API_KEY;
const ORIG_URL = process.env.DEEPSEEK_BASE_URL;
afterEach(() => {
  process.env.DEEPSEEK_API_KEY = ORIG_KEY;
  process.env.DEEPSEEK_BASE_URL = ORIG_URL;
  vi.unstubAllGlobals();
});

const ok = (body: unknown, status = 200) => ({ fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status })) });

describe("chatWithTools", () => {
  it("parses tool_calls from the response", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    process.env.DEEPSEEK_BASE_URL = "http://ds.test";
    const deps = ok({
      choices: [{ message: { content: "好的", tool_calls: [{ id: "c1", type: "function", function: { name: "record_order", arguments: '{"customerName":"lily","quantity":1,"occasion":"dinner"}' } }] } }],
    });
    const r = await chatWithTools({ messages: [{ role: "user", content: "x" }] }, deps);
    expect(r.toolCalls).toEqual([{ id: "c1", name: "record_order", args: { customerName: "lily", quantity: 1, occasion: "dinner" } }]);
    expect(r.content).toBe("好的");
  });

  it("returns content + no tool calls for a plain answer", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    process.env.DEEPSEEK_BASE_URL = "http://ds.test";
    const deps = ok({ choices: [{ message: { content: "今天3单" } }] });
    const r = await chatWithTools({ messages: [{ role: "user", content: "x" }] }, deps);
    expect(r.content).toBe("今天3单");
    expect(r.toolCalls).toEqual([]);
  });

  it("sends tools + tool_choice when tools are provided", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    process.env.DEEPSEEK_BASE_URL = "http://ds.test";
    const deps = ok({ choices: [{ message: { content: "x" } }] });
    await chatWithTools(
      { messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: { name: "f", description: "d", parameters: { type: "object" } } }] },
      deps,
    );
    const init = deps.fetch.mock.calls[0]![1];
    const body = JSON.parse((init?.body ?? "{}") as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tool_choice).toBe("auto");
  });

  it("tolerates malformed tool arguments (→ {})", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    process.env.DEEPSEEK_BASE_URL = "http://ds.test";
    const deps = ok({ choices: [{ message: { tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "not-json" } }] } }] });
    const r = await chatWithTools({ messages: [{ role: "user", content: "x" }] }, deps);
    expect(r.toolCalls[0]?.args).toEqual({});
  });

  it("throws on non-2xx", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    process.env.DEEPSEEK_BASE_URL = "http://ds.test";
    const deps = { fetch: vi.fn(async () => new Response("err", { status: 500 })) };
    await expect(chatWithTools({ messages: [{ role: "user", content: "x" }] }, deps)).rejects.toThrow(/500/);
  });

  it("throws if the key is missing", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(chatWithTools({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/DEEPSEEK_API_KEY/);
  });

  it("uses global fetch + default base URL when deps/env are absent", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    delete process.env.DEEPSEEK_BASE_URL;
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const r = await chatWithTools({ messages: [{ role: "user", content: "x" }] }); // no deps → global fetch
    expect(r.content).toBe("ok");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.deepseek.com/chat/completions");
  });
});
