import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReconciliationError } from "../domain/orders/reconciliation";
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
  previewOrderReconciliation: vi.fn(async () => ({
    mode: "snapshot" as const,
    operationKey: "op-1",
    scope: [{ date: "2026-07-13", occasion: "lunch" as const }],
    expectedFingerprint: "fp-1",
    candidates: [{ customer: 12, date: "2026-07-13", occasion: "lunch" as const, quantity: 2, offering: 9, unitPriceCents: 3000, totalCents: 6000 }],
    rows: [{ kind: "create" as const, customerName: "王燕萍", date: "2026-07-13", occasion: "lunch" as const, afterQuantity: 2, affectsConfirmed: false }],
  })),
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
    expect(result.text).toContain("以本次为准");
    expect(getPendingOp(OPERATOR)?.args).toMatchObject({ expectedFingerprint: "fp-1", operationKey: "op-1" });
  });

  it.each([
    ["add" as const, "加", { kind: "add" as const, beforeQuantity: 1, changeQuantity: 2, afterQuantity: 3 }, "当前 1 份 + 2 份 → 共 3 份"],
    ["set" as const, "改成", { kind: "set" as const, beforeQuantity: 3, afterQuantity: 2 }, "当前 3 份 → 改成 2 份"],
  ])("emits an executable %s increment card with an explicit calculation", async (operation, operationEvidence, row, expected) => {
    const svc = services({
      parseOrders: vi.fn(async () => ({ ...parsed, mode: "increment" as const, operation, operationEvidence })),
      previewOrderReconciliation: vi.fn(async () => ({
        mode: "increment" as const,
        operation,
        operationKey: `op-${operation}`,
        scope: [{ date: "2026-07-13", occasion: "lunch" as const }],
        expectedFingerprint: "fp",
        candidates: [{ customer: 12, date: "2026-07-13", occasion: "lunch" as const, quantity: 2, offering: 9, unitPriceCents: 3000, totalCents: 6000 }],
        rows: [{ ...row, customerName: "王燕萍", date: "2026-07-13", occasion: "lunch" as const, affectsConfirmed: false }],
      })),
    });
    const result = await recordTool.execute(svc, { rawText: "7月13日午餐，加王燕萍2份" });
    expect(result.card?.type).toBe("operation-confirm");
    expect(result.text).toContain(expected);
    expect(getPendingOp(OPERATOR)?.args).toMatchObject({ mode: "increment", operation });
  });

  it("fails closed without a card when deterministic issues exist", async () => {
    const svc = services({ parseOrders: vi.fn(async () => ({ ...parsed, issues: [{ code: "weekday-mismatch" as const, message: "日期和周几不一致" }] })) });
    const result = await recordTool.execute(svc, { rawText: "冲突接龙" });
    expect(result).toEqual({ text: expect.stringContaining("日期和周几不一致") });
    expect(getPendingOp(OPERATOR)).toBeUndefined();
    expect(svc.previewOrderReconciliation).not.toHaveBeenCalled();
  });

  it("fails closed when parsing or customer preview fails", async () => {
    expect(await recordTool.execute(services({ parseOrders: vi.fn(async () => { throw new Error("model down"); }) }), { rawText: "x" })).toEqual({ text: expect.stringContaining("解析") });
    expect(await recordTool.execute(services({ previewOrderReconciliation: vi.fn(async () => { throw new Error("cms down"); }) }), { rawText: "x" })).toEqual({ text: expect.stringContaining("顾客") });
    expect(getPendingOp(OPERATOR)).toBeUndefined();
  });

  it("explains why settled orders cannot be changed by a full snapshot", async () => {
    const error = new ReconciliationError("settled-order", "王燕萍的订单已付款或已送达，请单独处理");
    const result = await recordTool.execute(services({ previewOrderReconciliation: vi.fn(async () => { throw error; }) }), { rawText: "x" });
    expect(result).toEqual({ text: expect.stringMatching(/已付款或已送达.*单独处理/) });
    expect(getPendingOp(OPERATOR)).toBeUndefined();
  });

  it("surfaces other reconciliation validation errors", async () => {
    const error = new ReconciliationError("ambiguous-customer", "存在多个同名顾客，请先区分后再发");
    const result = await recordTool.execute(services({ previewOrderReconciliation: vi.fn(async () => { throw error; }) }), { rawText: "x" });
    expect(result).toEqual({ text: "存在多个同名顾客，请先区分后再发" });
    expect(getPendingOp(OPERATOR)).toBeUndefined();
  });

  it("rejects an empty raw text", async () => {
    const svc = services();
    expect(await recordTool.execute(svc, { rawText: " " })).toEqual({ text: "没看到要记的接龙或补单。" });
    expect(svc.parseOrders).not.toHaveBeenCalled();
  });
});
