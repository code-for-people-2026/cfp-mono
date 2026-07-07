import { describe, expect, it, vi } from "vitest";
import type { ChatResult } from "../lib/llm/chatWithTools";
import type { AgentServices } from "./tools";
import { runAgent, trimContext } from "./run";

/** A scripted chat mock: returns each ChatResult in sequence, then a bare text. */
const scriptedChat = (responses: ChatResult[]) => {
  let i = 0;
  return vi.fn(async (): Promise<ChatResult> => responses[i++] ?? { content: "（scripted exhausted）", toolCalls: [] });
};

const mockServices = (over: Partial<AgentServices> = {}): AgentServices => ({
  previewOrders:
    over.previewOrders ?? vi.fn(async (items: { customerName: string }[]) => ({ date: "2026-07-07", isNew: items.map(() => false) })),
  recordOrders:
    over.recordOrders ??
    vi.fn(async () => ({ recorded: [{ name: "王燕萍", orderId: 45 }], needsConfirmation: [], failed: [] })),
  createCustomersAndOrders:
    over.createCustomersAndOrders ?? vi.fn(async () => ({ created: [{ name: "大龙猫", orderId: 46 }], failed: [] })),
  confirmOrder: over.confirmOrder ?? vi.fn(async () => ({ ok: true as const })),
  cancelOrder: over.cancelOrder ?? vi.fn(async () => ({ ok: true as const })),
  markPaid: over.markPaid ?? vi.fn(async () => ({ ok: true as const })),
  markDelivered: over.markDelivered ?? vi.fn(async () => ({ ok: true as const, count: 2 })),
  getTodaySummary:
    over.getTodaySummary ??
    vi.fn(async () => ({ unconfirmedOrders: 1, pendingDeliveries: 2, unpaidOrders: 3, recentOrders: "#45 王燕萍" })),
  getTodayOrders: over.getTodayOrders ?? vi.fn(async () => []),
  getTodayDelivery: over.getTodayDelivery ?? vi.fn(async () => ({ totalPending: 0, groups: [] })),
  generateMenu: over.generateMenu ?? vi.fn(async () => ({ ok: true as const, plans: [] })),
  swapDish: over.swapDish ?? vi.fn(async () => ({ ok: true as const, plan: {} as never })),
  publishMenu: over.publishMenu ?? vi.fn(async () => ({ ok: true as const, publishText: "test" })),
  getMenu: over.getMenu ?? vi.fn(async () => []),
  getDishPool: over.getDishPool ?? vi.fn(async () => []),
  createOffering: over.createOffering ?? vi.fn(async () => ({ id: 1, name: "test" })),
  previewOrder: over.previewOrder ?? vi.fn(async () => ({ displayName: "王燕萍", quantity: 1, occasion: "lunch" })),
  previewDelivered: over.previewDelivered ?? vi.fn(async () => 1),
  previewMenuTargets: over.previewMenuTargets ?? vi.fn(async () => ({ ok: true as const, lines: ["午餐：菜1、菜2"] })),
  previewSwap: over.previewSwap ?? vi.fn(async () => ({ ok: true as const, oldName: "旧菜", newName: "新菜" })),
  previewPublish: over.previewPublish ?? vi.fn(async () => ({ ok: true as const, publishText: "#接龙 test" })),
  operatorId: 1,
});

describe("runAgent", () => {
  it("record_orders previews a confirm card without writing (#126)", async () => {
    const chat = scriptedChat([
      { content: null, toolCalls: [{ id: "c1", name: "record_orders", args: { items: [{ customerName: "王燕萍", quantity: 2, occasion: "lunch" }] } }] },
      { content: "记好了，王燕萍午餐2份。", toolCalls: [] },
    ]);
    const s = mockServices();
    const out = await runAgent({ userText: "记 王燕萍 午餐2份", history: [], services: s, deps: { chat } });
    // Preview mode: classify (previewOrders) but do NOT write — execution waits for the confirm click.
    expect(s.previewOrders).toHaveBeenCalled();
    expect(s.recordOrders).not.toHaveBeenCalled();
    expect(out.reply).toBe("记好了，王燕萍午餐2份。");
    expect(out.card?.type).toBe("operation-confirm");
  });

  it("record_orders confirm card flags new customers for address entry (#126 US1)", async () => {
    const chat = scriptedChat([
      { content: null, toolCalls: [{ id: "c1", name: "record_orders", args: { items: [{ customerName: "大龙猫", quantity: 1, occasion: "dinner" }] } }] },
      { content: "新顾客大龙猫，点下面确认填地址哦。", toolCalls: [] },
    ]);
    const s = mockServices({ previewOrders: vi.fn(async () => ({ date: "2026-07-07", isNew: [true] })) });
    const out = await runAgent({ userText: "接龙", history: [], services: s, deps: { chat } });
    expect(out.reply).toBe("新顾客大龙猫，点下面确认填地址哦。");
    // Merged card: operation-confirm carrying items + isNew (FE renders address inputs for new).
    expect(out.card?.type).toBe("operation-confirm");
    const data = (out.card as { data: { toolName: string; args: Record<string, unknown> } }).data;
    expect(data.toolName).toBe("record_orders");
    expect(data.args.isNew).toEqual([true]);
    expect(s.recordOrders).not.toHaveBeenCalled(); // still preview-only
  });

  it("record_orders still emits a confirm card for known-only customers (#126)", async () => {
    const chat = scriptedChat([
      { content: null, toolCalls: [{ id: "c1", name: "record_orders", args: { items: [{ customerName: "王燕萍", quantity: 1, occasion: "lunch" }] } }] },
      { content: "记好了。", toolCalls: [] },
    ]);
    const out = await runAgent({ userText: "x", history: [], services: mockServices(), deps: { chat } });
    // Every write op gates behind a confirm card now — known-only included.
    expect(out.card?.type).toBe("operation-confirm");
  });

  it("passes an orders card through when get_orders is called (#98)", async () => {
    const chat = scriptedChat([
      { content: null, toolCalls: [{ id: "c1", name: "get_orders", args: {} }] },
      { content: "看下面卡片。", toolCalls: [] },
    ]);
    const s = mockServices({
      getTodayOrders: vi.fn(async () => [{ id: 1, status: "draft", customer: { displayName: "王燕萍" }, date: "2026-06-29", paymentStatus: "unpaid", items: [] }] as never),
    });
    const out = await runAgent({ userText: "订单怎么样", history: [], services: s, deps: { chat } });
    expect(out.card?.type).toBe("orders");
    expect((out.card as { data: { orders: unknown[] } }).data.orders).toHaveLength(1);
  });

  it("returns the model's text directly when no tool is called (plain question / scope-out)", async () => {
    const chat = scriptedChat([{ content: "这个我帮不上，经营上的事尽管吩咐。", toolCalls: [] }]);
    const out = await runAgent({ userText: "明天天气怎么样", history: [], services: mockServices(), deps: { chat } });
    expect(out).toEqual({ reply: "这个我帮不上，经营上的事尽管吩咐。" });
  });

  it("falls back to a today-summary after maxSteps exhaustion (always tool-calling)", async () => {
    const chat = vi.fn(async (): Promise<ChatResult> => ({
      content: null,
      toolCalls: [{ id: "c", name: "get_today_summary", args: {} }],
    }));
    const s = mockServices();
    const out = await runAgent({ userText: "x", history: [], services: s, deps: { chat } });
    expect(out.reply).toContain("没完全处理过来");
    expect(s.getTodaySummary).toHaveBeenCalled();
  });

  it("runs a write tool (preview) and a read tool (direct) in one step (#126)", async () => {
    const chat = scriptedChat([
      {
        content: null,
        toolCalls: [
          { id: "c1", name: "record_orders", args: { items: [{ customerName: "桃子", quantity: 1, occasion: "dinner" }] } },
          { id: "c2", name: "get_today_summary", args: {} },
        ],
      },
      { content: "都办好了。", toolCalls: [] },
    ]);
    const s = mockServices();
    await runAgent({ userText: "x", history: [], services: s, deps: { chat } });
    // Write tool previews (no write); read tool executes directly.
    expect(s.previewOrders).toHaveBeenCalled();
    expect(s.recordOrders).not.toHaveBeenCalled();
    expect(s.getTodaySummary).toHaveBeenCalled();
  });

  it("preserves a write-confirm card when a read card follows in the same turn (Codex P2)", async () => {
    const chat = scriptedChat([
      {
        content: null,
        toolCalls: [
          { id: "c1", name: "record_orders", args: { items: [{ customerName: "王燕萍", quantity: 1, occasion: "lunch" }] } },
          { id: "c2", name: "get_orders", args: {} },
        ],
      },
      { content: "记好了，看看订单。", toolCalls: [] },
    ]);
    const s = mockServices({
      getTodayOrders: vi.fn(async () => [{ id: 1, status: "draft", customer: { displayName: "王燕萍" }, date: "2026-06-29", paymentStatus: "unpaid", items: [] }] as never),
    });
    const out = await runAgent({ userText: "x", history: [], services: s, deps: { chat } });
    // get_orders emits an orders card AFTER record_orders' operation-confirm card,
    // but the pending write must stay visible — don't cede to the read card.
    expect(out.card?.type).toBe("operation-confirm");
  });

  it("reports an unknown tool gracefully", async () => {
    const chat = scriptedChat([
      { content: null, toolCalls: [{ id: "c1", name: "no_such_tool", args: {} }] },
      { content: "好了。", toolCalls: [] },
    ]);
    const out = await runAgent({ userText: "x", history: [], services: mockServices(), deps: { chat } });
    expect(out).toEqual({ reply: "好了。" }); // loop continues after the tool-error message
  });

  it("falls back to today-summary when the LLM call itself throws (outage, Codex)", async () => {
    const chat = vi.fn(async () => { throw new Error("DeepSeek down"); });
    const s = mockServices();
    const out = await runAgent({ userText: "x", history: [], services: s, deps: { chat } });
    expect(out.reply).toContain("没完全处理过来");
    expect(s.getTodaySummary).toHaveBeenCalled();
  });
});

describe("trimContext", () => {
  it("keeps only the most recent N*2 messages", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, content: String(i) }));
    expect(trimContext(history, 3)).toHaveLength(6);
    expect(trimContext(history, 3)[0]!.content).toBe("14"); // last 6 = indices 14..19
  });
});
