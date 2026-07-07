import { afterEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_JWT_HEADER } from "./client";
import { createChatMessage, listChatMessages } from "./chat";

const ORIG = process.env.CMS_BASE_URL;
const CARD = { type: "operation-confirm" as const, data: { toolName: "mark_paid", summary: "将标记 #1 已付款", args: { orderId: 1 } } };
afterEach(() => {
  process.env.CMS_BASE_URL = ORIG;
  vi.unstubAllGlobals();
});

const mockFetch = (response: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status })),
});

describe("listChatMessages", () => {
  it("GETs recent chat with an optional limit and unwraps {docs}", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ docs: [{ id: 1, content: "hi", role: "assistant", card: CARD }] });
    const msgs = await listChatMessages("jwt", { limit: 20 }, deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/chat_messages?limit=20");
    expect(msgs).toEqual([{ id: 1, content: "hi", role: "assistant", card: CARD }]);
  });

  it("omits the query string when no limit and returns [] when docs is absent", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({});
    const msgs = await listChatMessages("jwt", {}, deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/chat_messages");
    expect(msgs).toEqual([]);
  });

  it("throws on a non-2xx", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = { fetch: vi.fn(async () => new Response("err", { status: 500 })) };
    await expect(listChatMessages("jwt", {}, deps)).rejects.toThrow(/500/);
  });

  it("uses global fetch when deps are omitted", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ docs: [{ id: 1 }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await listChatMessages("jwt"))[0]?.id).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("createChatMessage", () => {
  it("POSTs {content, role} with the operator JWT", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ id: 9, content: "hey", role: "assistant" });
    const msg = await createChatMessage("jwt", { content: "hey", role: "assistant", card: CARD }, deps);
    const [, init] = deps.fetch.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ [OPERATOR_JWT_HEADER]: "jwt", "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({ content: "hey", role: "assistant", card: CARD });
    expect(msg.id).toBe(9);
  });

  it("serializes only visible chat fields and never sends cards for user messages", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ id: 9, content: "hey", role: "user" });
    await createChatMessage("jwt", { content: "hey", role: "user", card: CARD, rawToolCalls: [{ name: "x" }] } as never, deps);
    const [, init] = deps.fetch.mock.calls[0]!;
    expect(JSON.parse(init?.body as string)).toEqual({ content: "hey", role: "user" });
  });

  it("throws on a non-2xx", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = { fetch: vi.fn(async () => new Response("err", { status: 400 })) };
    await expect(createChatMessage("jwt", { content: "x", role: "user" }, deps)).rejects.toThrow(/400/);
  });

  it("uses global fetch when deps are omitted", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 1 })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await createChatMessage("jwt", { content: "x", role: "user" }))?.id).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
