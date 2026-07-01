import type { ChatMessage } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import type { AgentCms } from "../agent/services";
import { runAgent } from "../agent/run";
import { chatRoutes, type ChatRoutesDeps } from "./chat";

const SECRET = "test-secret";

// cms methods are never invoked when runAgent is mocked — stubs satisfy the type.
const mockCms = (): AgentCms =>
  ({
    getSeller: vi.fn(),
    findOfferings: vi.fn(),
    getOrder: vi.fn(),
    createOrderDraft: vi.fn(),
    updateOrder: vi.fn(),
    upsertSlots: vi.fn(),
    createFulfillments: vi.fn(),
    setFulfillmentsByOrderItems: vi.fn(),
    listCustomers: vi.fn(),
    createCustomer: vi.fn(),
    listFulfillments: vi.fn(),
    listOrders: vi.fn(),
  }) as AgentCms;

const token = async () => issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET);
const auth = async () => ({ Authorization: `Bearer ${await token()}` });
const json = async () => ({ ...(await auth()), "content-type": "application/json" });

const sampleHistory = (): ChatMessage[] => [
  { id: 1, content: "老消息", role: "user", createdAt: "", seller: 7 },
  { id: 2, content: "好", role: "assistant", createdAt: "", seller: 7 },
];

describe("default deps wiring", () => {
  it("constructs the app with the real cms when deps are omitted (no cms call on a 401)", async () => {
    const app = chatRoutes(SECRET); // exercises realAgentCms() default
    expect((await app.request("/")).status).toBe(401);
  });
});

describe("POST /chat", () => {
  const deps = (over: Partial<ChatRoutesDeps> = {}): Required<ChatRoutesDeps> => ({
    cms: over.cms ?? mockCms(),
    listChatMessages: over.listChatMessages ?? vi.fn(async () => sampleHistory()),
    createChatMessage:
      over.createChatMessage ?? vi.fn(async () => ({ id: 9, content: "x", role: "assistant", createdAt: "", seller: 7 }) as ChatMessage),
    runAgent: over.runAgent ?? vi.fn<typeof runAgent>(async () => "已记草稿"),
  });

  it("runs the agent over reversed history and persists user+assistant messages", async () => {
    const d = deps();
    const app = chatRoutes(SECRET, d);
    const res = await app.request("/", { method: "POST", headers: await json(), body: JSON.stringify({ text: "王燕萍 午餐 2份" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reply: string }).reply).toBe("已记草稿");
    expect(d.runAgent).toHaveBeenCalledWith(expect.objectContaining({ userText: "王燕萍 午餐 2份" }));
    // history fed chronologically (reversed from newest-first cms order)
    expect((vi.mocked(d.runAgent).mock.calls[0]![0] as { history: unknown[] }).history).toHaveLength(2);
    expect(d.listChatMessages).toHaveBeenCalledWith(expect.any(String), { limit: 20 });
    expect(d.createChatMessage).toHaveBeenCalledTimes(2);
  });

  it("400 when text is missing", async () => {
    const app = chatRoutes(SECRET, deps());
    expect((await app.request("/", { method: "POST", headers: await json(), body: JSON.stringify({}) })).status).toBe(400);
  });

  it("400 when the body is not JSON", async () => {
    const app = chatRoutes(SECRET, deps());
    expect((await app.request("/", { method: "POST", headers: await auth(), body: "not-json" })).status).toBe(400);
  });

  it("still returns 200 when chat persistence fails (best-effort; reply already verified)", async () => {
    const d = deps({ createChatMessage: vi.fn(async () => { throw new Error("cms down"); }) });
    const app = chatRoutes(SECRET, d);
    const res = await app.request("/", { method: "POST", headers: await json(), body: JSON.stringify({ text: "hi" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reply: string }).reply).toBe("已记草稿");
  });

  it("502 when runAgent itself throws (before any business write is reported)", async () => {
    const d = deps({ runAgent: vi.fn<typeof runAgent>(async () => { throw new Error("boom"); }) });
    const app = chatRoutes(SECRET, d);
    expect((await app.request("/", { method: "POST", headers: await json(), body: JSON.stringify({ text: "hi" }) })).status).toBe(502);
  });

  it("401 without a token", async () => {
    const app = chatRoutes(SECRET, deps());
    expect((await app.request("/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) })).status).toBe(401);
  });
});

describe("GET /chat", () => {
  it("returns the recent chat history, projected to safe fields", async () => {
    const listChatMessages = vi.fn(async () => sampleHistory());
    const app = chatRoutes(SECRET, { cms: mockCms(), listChatMessages });
    const res = await app.request("/", { headers: await auth() });
    const json = (await res.json()) as { messages: Record<string, unknown>[] };
    expect(res.status).toBe(200);
    expect(json.messages).toHaveLength(2);
    // operator/seller (populated by cms depth) must NOT leak — only the 4 fields.
    expect(Object.keys(json.messages[0]!).sort()).toEqual(["content", "createdAt", "id", "role"]);
    expect(listChatMessages).toHaveBeenCalledWith(expect.any(String), { limit: 50 });
  });

  it("502 when the history load fails", async () => {
    const app = chatRoutes(SECRET, { cms: mockCms(), listChatMessages: vi.fn(async () => { throw new Error("cms down"); }) });
    expect((await app.request("/", { headers: await auth() })).status).toBe(502);
  });
});
