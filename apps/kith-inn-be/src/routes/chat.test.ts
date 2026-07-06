import type { ChatMessage } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import type { AgentCms } from "../agent/services";
import { clearPending, getPending, setPending } from "../agent/pendingState";
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
    setFulfillmentsByOrders: vi.fn(),
    setFulfillmentsByIds: vi.fn(),
    listCustomers: vi.fn(),
    createCustomer: vi.fn(),
    listFulfillments: vi.fn(),
    listOrders: vi.fn(),
  listMenuPlans: vi.fn(),
  getMenuPlan: vi.fn(),
  upsertMenuPlans: vi.fn(),
  patchMenuPlan: vi.fn(),
  }) as AgentCms;

const token = async () => issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET);
const auth = async () => ({ Authorization: `Bearer ${await token()}` });
const json = async () => ({ ...(await auth()), "content-type": "application/json" });
const CARD = { type: "customer-confirm" as const, data: { items: [{ customerName: "大龙猫", quantity: 1, occasion: "lunch" as const }] } };

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
    runAgent: over.runAgent ?? vi.fn<typeof runAgent>(async () => ({ reply: "已记草稿" })),
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

  it("persists the assistant card snapshot but never attaches a card to the user message", async () => {
    const d = deps({ runAgent: vi.fn<typeof runAgent>(async () => ({ reply: "先确认新顾客", card: CARD })) });
    const app = chatRoutes(SECRET, d);
    const res = await app.request("/", { method: "POST", headers: await json(), body: JSON.stringify({ text: "大龙猫 午餐 1份" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: "先确认新顾客", card: CARD });
    expect(d.createChatMessage).toHaveBeenNthCalledWith(1, expect.any(String), { content: "大龙猫 午餐 1份", role: "user" });
    expect(d.createChatMessage).toHaveBeenNthCalledWith(2, expect.any(String), { content: "先确认新顾客", role: "assistant", card: CARD });
  });

  it("persists only visible assistant fields, not raw agent traces", async () => {
    const d = deps({
      runAgent: vi.fn<typeof runAgent>(async () => ({ reply: "看卡片", card: CARD, toolCalls: [{ name: "record_orders" }] }) as never),
    });
    const app = chatRoutes(SECRET, d);
    const res = await app.request("/", { method: "POST", headers: await json(), body: JSON.stringify({ text: "hi" }) });
    expect(res.status).toBe(200);
    expect(d.createChatMessage).toHaveBeenNthCalledWith(2, expect.any(String), { content: "看卡片", role: "assistant", card: CARD });
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

  it("returns valid card snapshots and marks incompatible historical card snapshots as unavailable", async () => {
    const listChatMessages = vi.fn(async () => [
      { id: 1, content: "有效卡片", role: "assistant", createdAt: "t1", seller: 7, card: CARD },
      { id: 2, content: "历史卡片不可解析", role: "assistant", createdAt: "t2", seller: 7, card: { type: "unknown", data: {} } },
      { id: 3, content: "普通回复", role: "assistant", createdAt: "t3", seller: 7 },
      { id: 4, content: "用户原话", role: "user", createdAt: "t4", seller: 7 },
    ] as ChatMessage[]);
    const app = chatRoutes(SECRET, { cms: mockCms(), listChatMessages });
    const res = await app.request("/", { headers: await auth() });
    const body = (await res.json()) as { messages: Record<string, unknown>[] };
    expect(res.status).toBe(200);
    expect(body.messages).toEqual([
      { id: 1, content: "有效卡片", role: "assistant", createdAt: "t1", card: CARD },
      { id: 2, content: "历史卡片不可解析", role: "assistant", createdAt: "t2", cardUnavailable: true },
      { id: 3, content: "普通回复", role: "assistant", createdAt: "t3" },
      { id: 4, content: "用户原话", role: "user", createdAt: "t4" },
    ]);
  });

  it("502 when the history load fails", async () => {
    const app = chatRoutes(SECRET, { cms: mockCms(), listChatMessages: vi.fn(async () => { throw new Error("cms down"); }) });
    expect((await app.request("/", { headers: await auth() })).status).toBe(502);
  });
});

describe("POST /chat/confirm-customers", () => {
  // operatorId 1 comes from issueToken in `token()` above.
  const OP = 1;
  // Canonical pending item (carries date — Codex P1) reused for seed + submitted body.
  const ITEM = { customerName: "大龙猫", address: "26B", quantity: 1, occasion: "dinner" as const, date: "2026-06-29" };
  const post = async (app: ReturnType<typeof chatRoutes>, items: unknown) =>
    app.request("/confirm-customers", { method: "POST", headers: await auth(), body: JSON.stringify({ items }) });

  const cmsWithCombo = (): AgentCms =>
    ({
      ...mockCms(),
      findOfferings: vi.fn(async () => [{ id: 10, kind: "combo-meal", name: "套餐", priceCents: 3000 }] as never),
      createCustomer: vi.fn(async (_jwt: string, input: { displayName: string }) => ({ id: 55, displayName: input.displayName }) as never),
      createOrderDraft: vi.fn(async () => ({ order: { id: 90 }, items: [] }) as never),
    }) as AgentCms;

  it("creates the pending customers + orders deterministically then clears (#97)", async () => {
    setPending(OP, [ITEM]);
    // Best-effort chat write (mirrors POST /chat): a throw here must NOT fail the turn.
    const createChatMessage = vi.fn(async () => { throw new Error("cms down"); });
    const app = chatRoutes(SECRET, { cms: cmsWithCombo(), createChatMessage });
    const res = await post(app, [ITEM]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { created: unknown[] }).created).toEqual([{ name: "大龙猫", orderId: 90 }]);
    expect(getPending(OP)).toEqual([]); // cleared after consuming
    expect(createChatMessage).toHaveBeenCalledTimes(1); // best-effort "已建" narration attempted
    clearPending(OP);
  });

  it("409 when the submitted items don't match pending (stale card, Codex P2)", async () => {
    setPending(OP, [ITEM]);
    const app = chatRoutes(SECRET, { cms: cmsWithCombo() });
    // A newer record_orders overwrote pending with a different customer → click is stale.
    const res = await post(app, [{ customerName: "别的顾客", quantity: 1, occasion: "lunch" }]);
    expect(res.status).toBe(409);
    expect(getPending(OP)).toEqual([ITEM]); // NOT cleared on a stale rejection
    clearPending(OP);
  });

  it("409 when items are missing from the body", async () => {
    setPending(OP, [ITEM]);
    const app = chatRoutes(SECRET, { cms: cmsWithCombo() });
    const res = await app.request("/confirm-customers", { method: "POST", headers: await auth(), body: JSON.stringify({}) });
    expect(res.status).toBe(409);
    clearPending(OP);
  });

  it("409 when the submitted length differs from pending", async () => {
    setPending(OP, [ITEM]);
    const app = chatRoutes(SECRET, { cms: cmsWithCombo() });
    // Pending has 1 item; submit an empty list (e.g. a card whose items got dropped).
    const res = await post(app, []);
    expect(res.status).toBe(409);
    clearPending(OP);
  });

  it("404 when nothing is pending", async () => {
    clearPending(OP);
    const app = chatRoutes(SECRET, { cms: mockCms() });
    expect((await post(app, [ITEM])).status).toBe(404);
  });

  it("401 without a token", async () => {
    const app = chatRoutes(SECRET, { cms: mockCms() });
    expect((await app.request("/confirm-customers", { method: "POST" })).status).toBe(401);
  });

  it("409 on a non-JSON body (json parse falls back to null → stale)", async () => {
    setPending(OP, [ITEM]);
    const app = chatRoutes(SECRET, { cms: cmsWithCombo() });
    const res = await app.request("/confirm-customers", { method: "POST", headers: await auth(), body: "not-json" });
    expect(res.status).toBe(409);
    clearPending(OP);
  });

  it("still 200 + clears pending when nothing could be created (no combo)", async () => {
    setPending(OP, [ITEM]);
    const cms = { ...mockCms(), findOfferings: vi.fn(async () => [{ id: 11, kind: "component" }] as never) } as AgentCms;
    const createChatMessage = vi.fn(async () => ({ id: 9, content: "x", role: "assistant", createdAt: "", seller: 7 }) as ChatMessage);
    const app = chatRoutes(SECRET, { cms, createChatMessage });
    const res = await post(app, [ITEM]);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { created: unknown[] }).created).toEqual([]);
    expect(createChatMessage).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ content: "没有建成，再看看？" }));
    expect(getPending(OP)).toEqual([]);
    clearPending(OP);
  });

  it("502 when customer creation blows up before the per-item guard", async () => {
    setPending(OP, [ITEM]);
    // A synchronous throw inside findOfferings escapes its `.catch(() => [])`.
    const cms = { ...mockCms(), findOfferings: vi.fn(() => { throw new Error("net"); }) } as AgentCms;
    const app = chatRoutes(SECRET, { cms });
    expect((await post(app, [ITEM])).status).toBe(502);
    clearPending(OP);
  });
});
