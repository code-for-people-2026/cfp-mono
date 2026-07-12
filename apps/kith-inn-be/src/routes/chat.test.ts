import type { ChatMessage } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import type { AgentCms } from "../agent/services";
import type { AgentServices } from "../agent/tools";
import { clearPendingOp, getPendingOp, setPendingOp } from "../agent/pendingOps";
import { runAgent } from "../agent/run";
import { CmsHttpError } from "../lib/cms/orders";
import { chatRoutes, dispatchPendingOp, operationReplySucceeded, type ChatRoutesDeps } from "./chat";

const SECRET = "test-secret";

// cms methods are never invoked when runAgent is mocked — stubs satisfy the type.
const mockCms = (): AgentCms =>
  ({
    getSeller: vi.fn(),
    findOfferings: vi.fn(),
    getOrder: vi.fn(),
    createOrderDraft: vi.fn(),
    confirmOrderAtomic: vi.fn(),
    cancelOrderAtomic: vi.fn(),
    updateOrder: vi.fn(),
    setFulfillmentsByIds: vi.fn(),
    listCustomers: vi.fn(),
    createCustomer: vi.fn(),
    listFulfillments: vi.fn(),
    listOrders: vi.fn(),
    reconcileOrders: vi.fn(),
  listMenuPlans: vi.fn(),
  getMenuPlan: vi.fn(),
  upsertMenuPlans: vi.fn(),
  patchMenuPlan: vi.fn(),
  createOffering: vi.fn(),
  }) as AgentCms;

const token = async () => issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET);
const auth = async () => ({ Authorization: `Bearer ${await token()}` });
const json = async () => ({ ...(await auth()), "content-type": "application/json" });
const CARD = { type: "operation-confirm" as const, data: { toolName: "mark_paid", summary: "将标记 #1 已付款", args: { orderId: 1 }, opId: "1" } };

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

describe("POST /chat/confirm-operation", () => {
  const OP = 1;
  // seed() stores a pending op and returns its opId; post() auto-includes the current
  // opId so a happy-path click matches. Pass an explicit `opId` to override (stale test).
  let curOpId = "";
  const seed = (op: Parameters<typeof setPendingOp>[1]) => { curOpId = setPendingOp(OP, op); };
  const post = async (app: ReturnType<typeof chatRoutes>, body: Record<string, unknown> | string = {}) =>
    app.request("/confirm-operation", {
      method: "POST",
      headers: await json(),
      body: typeof body === "string" ? body : JSON.stringify({ opId: curOpId, ...body }),
    });

  it("record_orders submits one immutable reconciliation and merges only new-customer addresses", async () => {
    const preview = {
      mode: "snapshot" as const, operationKey: "op-key", scope: [{ date: "2026-07-07", occasion: "lunch" as const }], expectedFingerprint: "fp",
      candidates: [
        { customer: 5, quantity: 1, occasion: "lunch" as const, date: "2026-07-07", offering: 10, unitPriceCents: 3000, totalCents: 3000 },
        { newCustomer: { displayName: "大龙猫" }, quantity: 1, occasion: "lunch" as const, date: "2026-07-07", offering: 10, unitPriceCents: 3000, totalCents: 3000 },
      ],
      rows: [],
    };
    seed({ toolName: "record_orders", summary: "完整接龙", args: preview });
    const reconcileOrders = vi.fn(async () => ({ ok: true as const, created: [{ orderId: 90 }], updated: [], canceled: [], unchanged: [{ orderId: 80 }] }));
    const cms = {
      ...mockCms(),
      reconcileOrders,
    } as AgentCms;
    const app = chatRoutes(SECRET, { cms });
    const res = await post(app, { items: [{}, { address: "26B" }] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string; ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.reply).toContain("新增 1、更新 0、取消 0、不变 1");
    expect(reconcileOrders).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      operationKey: "op-key",
      candidates: [expect.objectContaining({ customer: 5 }), expect.objectContaining({ newCustomer: { displayName: "大龙猫", address: "26B" } })],
    }));
    expect(getPendingOp(OP)).toBeUndefined();
  });

  it("normalizes a blank new-customer address to missing", async () => {
    const preview = {
      mode: "snapshot" as const, operationKey: "op-blank-address", scope: [{ date: "2026-07-07", occasion: "lunch" as const }], expectedFingerprint: "fp",
      candidates: [{ newCustomer: { displayName: "大龙猫" }, quantity: 1, occasion: "lunch" as const, date: "2026-07-07", offering: 10, unitPriceCents: 3000, totalCents: 3000 }],
      rows: [],
    };
    seed({ toolName: "record_orders", summary: "完整接龙", args: preview });
    const reconcileOrders = vi.fn(async () => ({ ok: true as const, created: [{ orderId: 90 }], updated: [], canceled: [], unchanged: [] }));
    const app = chatRoutes(SECRET, { cms: { ...mockCms(), reconcileOrders } as AgentCms });

    expect((await post(app, { items: [{ address: "   " }] })).status).toBe(200);
    expect(reconcileOrders).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      candidates: [expect.objectContaining({ newCustomer: { displayName: "大龙猫", address: undefined } })],
    }));
  });

  it("keeps the pending card active when reconciliation fails", async () => {
    const preview = { mode: "snapshot" as const, operationKey: "op", scope: [{ date: "2026-07-07", occasion: "lunch" as const }], expectedFingerprint: "fp", candidates: [], rows: [] };
    seed({ toolName: "record_orders", summary: "完整接龙", args: preview });
    const cms = {
      ...mockCms(),
      reconcileOrders: vi.fn(async () => { throw new Error("net"); }),
    } as AgentCms;
    const app = chatRoutes(SECRET, { cms });
    const res = await post(app);
    expect(res.status).toBe(502);
    expect(getPendingOp(OP)?.toolName).toBe("record_orders");
    clearPendingOp(OP);
  });

  it("clears a stale reconciliation card and asks for a fresh preview", async () => {
    const preview = { mode: "snapshot" as const, operationKey: "op", scope: [{ date: "2026-07-07", occasion: "lunch" as const }], expectedFingerprint: "old", candidates: [], rows: [] };
    seed({ toolName: "record_orders", summary: "完整接龙", args: preview });
    const cms = { ...mockCms(), reconcileOrders: vi.fn(async () => { throw new CmsHttpError(409, "reconcile", "stale-preview"); }) } as AgentCms;
    const res = await post(chatRoutes(SECRET, { cms }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "stale-preview" });
    expect(getPendingOp(OP)).toBeUndefined();
  });

  it("clears a reconciliation card that would overwrite paid or delivered work", async () => {
    const preview = { mode: "snapshot" as const, operationKey: "op", scope: [{ date: "2026-07-07", occasion: "lunch" as const }], expectedFingerprint: "fp", candidates: [], rows: [] };
    seed({ toolName: "record_orders", summary: "完整接龙", args: preview });
    const cms = { ...mockCms(), reconcileOrders: vi.fn(async () => { throw new CmsHttpError(409, "reconcile", "settled-order"); }) } as AgentCms;
    const res = await post(chatRoutes(SECRET, { cms }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "settled-order", message: expect.stringMatching(/已付款或已送达/) });
    expect(getPendingOp(OP)).toBeUndefined();
  });

  it("keeps a pending operation when dispatch returns a non-success reply", async () => {
    seed({ toolName: "not-implemented", summary: "未知", args: {} });
    const res = await post(chatRoutes(SECRET, { cms: mockCms() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(getPendingOp(OP)?.toolName).toBe("not-implemented");
    clearPendingOp(OP);
  });

  it("mark_paid marks the order paid on confirm (#126)", async () => {
    seed({ toolName: "mark_paid", summary: "将标记 #45 已付款", args: { orderId: 45 } });
    const updateOrder = vi.fn(async () => ({}) as never);
    const app = chatRoutes(SECRET, { cms: { ...mockCms(), updateOrder } as AgentCms });
    const res = await post(app, {});
    expect(res.status).toBe(200);
    expect(updateOrder).toHaveBeenCalledWith(expect.any(String), 45, expect.objectContaining({ paymentStatus: "paid" }));
    expect(((await res.json()) as { reply: string }).reply).toContain("#45");
  });

  it("add_dish creates the offering on confirm (#126)", async () => {
    seed({ toolName: "add_dish", summary: "将添加 蒜蓉粉丝虾", args: { name: "蒜蓉粉丝虾", mainIngredient: "虾", category: "meat" } });
    const createOffering = vi.fn(async () => ({ id: 77, name: "蒜蓉粉丝虾" }) as never);
    const app = chatRoutes(SECRET, { cms: { ...mockCms(), createOffering } as AgentCms });
    const res = await post(app, {});
    expect(res.status).toBe(200);
    expect(createOffering).toHaveBeenCalledWith(expect.any(String), { name: "蒜蓉粉丝虾", mainIngredient: "虾", category: "meat" });
  });

  it("409 when the submitted opId is stale (older card clicked after a newer op, Codex P1)", async () => {
    seed({ toolName: "mark_paid", summary: "旧 #45", args: { orderId: 45 } });
    const staleId = curOpId;
    seed({ toolName: "cancel_order", summary: "新 #46", args: { orderId: 46 } }); // overwrites
    const app = chatRoutes(SECRET, { cms: mockCms() });
    const res = await app.request("/confirm-operation", {
      method: "POST", headers: await json(), body: JSON.stringify({ opId: staleId }),
    });
    expect(res.status).toBe(409); // the older mark_paid card must NOT cancel #46
    expect(getPendingOp(OP)?.toolName).toBe("cancel_order"); // pending untouched
  });

  it("404 when no op is pending", async () => {
    clearPendingOp(OP);
    const app = chatRoutes(SECRET, { cms: mockCms() });
    expect((await post(app, {})).status).toBe(404);
  });

  it("401 without a token", async () => {
    const app = chatRoutes(SECRET, { cms: mockCms() });
    expect((await app.request("/confirm-operation", { method: "POST" })).status).toBe(401);
  });

  it("rejects a non-JSON body (no opId ⇒ can't prove freshness)", async () => {
    seed({ toolName: "add_dish", summary: "x", args: { name: "x" } });
    const app = chatRoutes(SECRET, { cms: mockCms() });
    const res = await app.request("/confirm-operation", { method: "POST", headers: await auth(), body: "not-json" });
    expect(res.status).toBe(409); // body parse → null → opId mismatch → stale
    clearPendingOp(OP);
  });

  it("502 when dispatch throws (service write fails)", async () => {
    seed({ toolName: "add_dish", summary: "x", args: { name: "x" } });
    const cms = { ...mockCms(), createOffering: vi.fn(() => { throw new Error("net"); }) } as AgentCms;
    const app = chatRoutes(SECRET, { cms });
    expect((await post(app, {})).status).toBe(502);
    clearPendingOp(OP);
  });

  it("still 200 when the best-effort outcome persist throws", async () => {
    seed({ toolName: "add_dish", summary: "x", args: { name: "x" } });
    const createChatMessage = vi.fn(async () => { throw new Error("cms down"); });
    const app = chatRoutes(SECRET, { cms: { ...mockCms(), createOffering: vi.fn(async () => ({ id: 1, name: "x" })) } as AgentCms, createChatMessage });
    const res = await post(app, {});
    expect(res.status).toBe(200); // dispatch already succeeded; persist is best-effort
    clearPendingOp(OP);
  });
});

describe("dispatchPendingOp", () => {
  // Direct unit test of each opType branch with a mock AgentServices — avoids the
  // per-case cms-domain mocking the HTTP route would need. Covers ok/fail paths.
  const ok = { ok: true as const };
  const fail = (error: string) => ({ ok: false as const, error });
  const svc = (over: Partial<AgentServices> = {}): AgentServices =>
    ({
      previewOrders: vi.fn(),
      recordOrders: vi.fn(async () => ({ recorded: [], needsConfirmation: [], failed: [] })),
      createCustomersAndOrders: vi.fn(async () => ({ created: [], failed: [] })),
      confirmOrder: vi.fn(async () => ok),
      cancelOrder: vi.fn(async () => ok),
      markPaid: vi.fn(async () => ok),
      markUnpaid: vi.fn(async () => ok),
      getTodaySummary: vi.fn(),
      getTodayOrders: vi.fn(),
      getTodayDelivery: vi.fn(),
      generateMenu: vi.fn(async () => ({ ok: true as const, plans: [] })),
      swapDish: vi.fn(async () => ({ ok: true as const, plan: {} as never })),
      publishMenu: vi.fn(async () => ({ ok: true as const, publishText: "T" })),
      getMenu: vi.fn(),
      getDishPool: vi.fn(),
      createOffering: vi.fn(async () => ({ id: 1, name: "x" })),
      operatorId: 1,
      ...over,
    }) as AgentServices;
  const op = (toolName: string, args: Record<string, unknown> = {}) => ({ opId: "1", toolName, args, summary: "" });
  const run = (s: AgentServices, toolName: string, args: Record<string, unknown> = {}, body: { items?: unknown } | null = null) =>
    dispatchPendingOp(s, op(toolName, args), body);

  it("confirm_order: ok and fail", async () => {
    expect(await run(svc(), "confirm_order", { orderId: 5 })).toContain("已确认订单 #5");
    const s = svc({ confirmOrder: vi.fn(async () => fail("nope")) });
    expect(await run(s, "confirm_order", { orderId: 5 })).toBe("确认失败：nope");
  });

  it("cancel_order: ok and fail", async () => {
    expect(await run(svc(), "cancel_order", { orderId: 5 })).toContain("已取消订单 #5");
    const s = svc({ cancelOrder: vi.fn(async () => fail("nope")) });
    expect(await run(s, "cancel_order", { orderId: 5 })).toBe("取消失败：nope");
  });

  it("mark_unpaid: ok, and not-implemented when the method is absent", async () => {
    expect(await run(svc(), "mark_unpaid", { orderId: 5 })).toContain("已回退订单 #5");
    const s = svc({ markUnpaid: undefined });
    expect(await run(s, "mark_unpaid", { orderId: 5 })).toBe("回退失败：not implemented");
  });

  it("generate_menu: ok lists dishes, pool-too-small, and other fail", async () => {
    const plans = [
      { occasion: "lunch", dishes: [{ name: "菜1" }, { name: "菜2" }] },
      { occasion: "dinner", dishes: [{ name: "菜3" }] },
    ] as never;
    const s = svc({ generateMenu: vi.fn(async () => ({ ok: true as const, plans })) });
    expect(await run(s, "generate_menu", { targets: [] })).toBe("排好了：\n午餐：菜1、菜2\n晚餐：菜3");
    const sPool = svc({ generateMenu: vi.fn(async () => ({ ok: false as const, reason: "pool-too-small" })) });
    expect(await run(sPool, "generate_menu")).toBe("菜品池不够。");
    const sFail = svc({ generateMenu: vi.fn(async () => ({ ok: false as const, reason: "generate failed" })) });
    expect(await run(sFail, "generate_menu")).toBe("生成失败：generate failed");
  });

  it("swap_dish: ok and fail", async () => {
    expect(await run(svc(), "swap_dish", { planId: 1, dishId: 2 })).toBe("已换好。");
    const s = svc({ swapDish: vi.fn(async () => ({ ok: false as const, error: "nope" })) });
    expect(await run(s, "swap_dish", { planId: 1, dishId: 2 })).toBe("换菜失败：nope");
  });

  it("publish_menu: ok returns the copied text and fail", async () => {
    const s = svc({ publishMenu: vi.fn(async () => ({ ok: true as const, publishText: "#接龙 …" })) });
    expect(await run(s, "publish_menu", { planId: 1 })).toBe("菜单已发布，文案已复制，去群粘贴：\n\n#接龙 …");
    const s2 = svc({ publishMenu: vi.fn(async () => ({ ok: false as const, error: "nope" })) });
    expect(await run(s2, "publish_menu", { planId: 1 })).toBe("发布失败：nope");
  });

  it("record_orders forwards the immutable preview and summarizes the atomic result", async () => {
    const preview = {
      mode: "snapshot" as const, operationKey: "op", scope: [{ date: "2026-07-07", occasion: "lunch" as const }], expectedFingerprint: "fp", rows: [],
      candidates: [{ newCustomer: { displayName: "新客", address: "原地址" }, date: "2026-07-07", occasion: "lunch" as const, quantity: 1, offering: 9, unitPriceCents: 3000, totalCents: 3000 }],
    };
    const reconcileOrderSnapshot = vi.fn(async () => ({ ok: true as const, created: [{ orderId: 1 }], updated: [{ orderId: 2, beforeQuantity: 1, afterQuantity: 2 }], canceled: [{ orderId: 3 }], unchanged: [{ orderId: 4 }] }));
    expect(await run(svc({ reconcileOrderSnapshot }), "record_orders", preview)).toBe("已按最新完整接龙更新：新增 1、更新 1、取消 1、不变 1。");
    expect(reconcileOrderSnapshot).toHaveBeenCalledWith(expect.objectContaining({ operationKey: "op", candidates: [expect.objectContaining({ newCustomer: { displayName: "新客", address: "原地址" } })] }));
  });

  it("mark_paid: ok and fail", async () => {
    expect(await run(svc(), "mark_paid", { orderId: 5 })).toContain("已标记订单 #5");
    expect(await run(svc({ markPaid: vi.fn(async () => fail("nope")) }), "mark_paid", { orderId: 5 })).toBe("标记失败：nope");
  });

  it("classifies operation replies for card success state", () => {
    expect(operationReplySucceeded("已按最新完整接龙更新：新增 1、更新 0、取消 0、不变 0。")).toBe(true);
    expect(operationReplySucceeded("失败：A（记单失败）")).toBe(false);
  });

  it("generate_menu: force=true and planned preview ids are forwarded", async () => {
    const g = vi.fn(async () => ({ ok: true as const, plans: [] })) as never;
    const plannedItems = [{ date: "2026-07-08", occasion: "lunch", offerings: [9, 8, 7] }];
    await run(svc({ generateMenu: g }), "generate_menu", { targets: [{ date: "2026-07-08", occasion: "lunch" }], force: true, plannedItems });
    expect(g).toHaveBeenCalledWith(expect.anything(), true, plannedItems);
  });

  it("swap_dish: forwards a specified replacementId", async () => {
    const sw = vi.fn(async () => ({ ok: true as const, plan: {} as never })) as never;
    await run(svc({ swapDish: sw }), "swap_dish", { planId: 1, dishId: 2, replacementId: 9 });
    expect(sw).toHaveBeenCalledWith(1, 2, 9, false);
  });

  it("add_dish", async () => {
    const s = svc({ createOffering: vi.fn(async () => ({ id: 9, name: "虾" })) });
    expect(await run(s, "add_dish", { name: "虾" })).toBe("加好了：虾（#9）。");
  });

  it("default: unknown opType", async () => {
    expect(await run(svc(), "bogus")).toBe("未知操作：bogus");
  });
});
