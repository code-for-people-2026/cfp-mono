import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPendingOp, getPendingOp } from "./pendingOps";
import { AGENT_TOOLS, type AgentServices } from "./tools";

const OPERATOR = 91;
const recordTool = AGENT_TOOLS.find((tool) => tool.def.function.name === "record_orders")!;
const parsed = {
  mode: "snapshot" as const,
  scope: [{ date: "2026-07-13", occasion: "lunch" as const, dateEvidence: "7.13号星期一午餐" }],
  items: [{ customerName: "王燕萍", date: "2026-07-13", occasion: "lunch" as const, quantity: 2, evidence: "王燕萍2份" }],
  unknownSegments: [],
  issues: [],
};

const services = (over: Partial<AgentServices> = {}) => ({
  operatorId: OPERATOR,
  parseOrders: vi.fn(async () => parsed),
  previewOrders: vi.fn(async () => ({ isNew: [false] })),
  ...over,
}) as AgentServices;

describe("record_orders production tool", () => {
  beforeEach(() => clearPendingOp(OPERATOR));

  it("declares one required rawText argument", () => {
    expect(recordTool.def.function.parameters).toMatchObject({
      properties: { rawText: { type: "string" } },
      required: ["rawText"],
    });
  });

  it("passes raw text to the parser and creates a dated server-side preview", async () => {
    const svc = services();
    const result = await recordTool.execute(svc, { rawText: "原样接龙" });
    expect(svc.parseOrders).toHaveBeenCalledWith("原样接龙");
    expect(result.card?.type).toBe("operation-confirm");
    expect(result.text).toContain("2026-07-13");
    expect(result.text).toContain("仅新增草稿");
    expect(getPendingOp(OPERATOR)?.args).toMatchObject({ items: parsed.items, isNew: [false], inputMode: "snapshot" });
  });

  it("does not emit an executable card for increments before reconciliation is wired", async () => {
    const svc = services({
      parseOrders: vi.fn(async () => ({ ...parsed, mode: "increment" as const, operation: "add" as const, operationEvidence: "加" })),
    });
    const result = await recordTool.execute(svc, { rawText: "7月13日午餐，加王燕萍2份" });
    expect(result.card).toBeUndefined();
    expect(result.text).toContain("还不能安全修改已有订单");
    expect(svc.previewOrders).not.toHaveBeenCalled();
    expect(getPendingOp(OPERATOR)).toBeUndefined();
  });

  it("fails closed without a card when deterministic issues exist", async () => {
    const svc = services({ parseOrders: vi.fn(async () => ({ ...parsed, issues: [{ code: "weekday-mismatch" as const, message: "日期和周几不一致" }] })) });
    const result = await recordTool.execute(svc, { rawText: "冲突接龙" });
    expect(result).toEqual({ text: expect.stringContaining("日期和周几不一致") });
    expect(getPendingOp(OPERATOR)).toBeUndefined();
    expect(svc.previewOrders).not.toHaveBeenCalled();
  });

  it("fails closed when parsing or customer preview fails", async () => {
    expect(await recordTool.execute(services({ parseOrders: vi.fn(async () => { throw new Error("model down"); }) }), { rawText: "x" })).toEqual({ text: expect.stringContaining("解析") });
    expect(await recordTool.execute(services({ previewOrders: vi.fn(async () => { throw new Error("cms down"); }) }), { rawText: "x" })).toEqual({ text: expect.stringContaining("顾客") });
    expect(getPendingOp(OPERATOR)).toBeUndefined();
  });

  it("rejects an empty raw text", async () => {
    const svc = services();
    expect(await recordTool.execute(svc, { rawText: " " })).toEqual({ text: "没看到要记的接龙或补单。" });
    expect(svc.parseOrders).not.toHaveBeenCalled();
  });
});
