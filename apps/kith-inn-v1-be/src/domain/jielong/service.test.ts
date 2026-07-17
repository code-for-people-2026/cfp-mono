import { describe, expect, it, vi } from "vitest";
import type { CmsJielongOrderCreate, Order } from "@cfp/kith-inn-v1-shared";
import { commitJielong, previewJielong } from "./service";

const TEXT = "2026-07-20 午餐\n1. 王阿姨 2份\n2. 李叔 1份";
const binding = { sellerId: 7, mealSlotId: 11, unitPriceCents: 3000 };
const order = (input: CmsJielongOrderCreate): Order => ({
  id: input.lineNumber + 30, sellerId: 7, totalCents: input.quantity * input.unitPriceCents, ...input
});

describe("jielong preview and commit", () => {
  it("binds canonical text, owner, slot and price without writing", () => {
    const preview = previewJielong(TEXT, binding);
    expect(preview).toMatchObject({ totalCents: 9000, lines: [
      { lineNumber: 2, displayName: "王阿姨", quantity: 2, unitPriceCents: 3000, totalCents: 6000 },
      { lineNumber: 3, displayName: "李叔", quantity: 1, unitPriceCents: 3000, totalCents: 3000 }
    ] });
    expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);
    for (const changed of [
      { ...binding, sellerId: 8 }, { ...binding, mealSlotId: 12 }, { ...binding, unitPriceCents: 3100 }
    ]) expect(previewJielong(TEXT, changed).previewHash).not.toBe(preview.previewHash);
  });

  it("retries sequentially, rejects stale/tampered previews, and preserves completed idempotency", async () => {
    const stored = new Map<number, Order>();
    const persist = async (input: CmsJielongOrderCreate) => {
      const doc = order(input); stored.set(input.lineNumber, doc); return doc;
    };
    const deps = {
      findOrder: vi.fn(async (_slot: string | number, _hash: string, line: number) => stored.get(line) ?? null),
      createOrder: vi.fn(persist), getUnitPriceCents: vi.fn(async () => 3000)
    };
    const preview = previewJielong(TEXT, binding);
    const input = { text: TEXT, previewHash: preview.previewHash, confirmed: true as const };
    await expect(commitJielong(input, binding, deps)).resolves.toMatchObject({
      previewHash: preview.previewHash, results: [{ status: "created" }, { status: "created" }]
    });
    deps.getUnitPriceCents.mockClear();
    deps.getUnitPriceCents.mockRejectedValueOnce(new Error("price offline"));
    await expect(commitJielong(input, binding, deps)).resolves.toMatchObject({
      results: [{ status: "existing" }, { status: "existing" }]
    });
    expect(deps.getUnitPriceCents).not.toHaveBeenCalled();
    await expect(commitJielong({ ...input, text: TEXT.replace("李叔", "赵叔") }, binding, deps))
      .rejects.toMatchObject({ code: "preview-hash-mismatch" });
    await expect(commitJielong({ ...input, text: "2026-07-20 午餐\n\n李叔 1份" }, binding, deps))
      .rejects.toMatchObject({ code: "preview-hash-mismatch" });

    stored.clear(); deps.createOrder.mockClear(); deps.getUnitPriceCents.mockReset().mockResolvedValue(3000);
    deps.createOrder.mockImplementationOnce(persist).mockRejectedValueOnce(new Error("offline"));
    await expect(commitJielong(input, binding, deps)).rejects.toThrow("offline");
    await expect(commitJielong(input, binding, deps)).resolves.toMatchObject({
      results: [{ status: "existing" }, { status: "created" }]
    });
    stored.clear(); deps.createOrder.mockClear(); deps.getUnitPriceCents.mockResolvedValue(3100);
    await expect(commitJielong(input, binding, deps))
      .rejects.toMatchObject({ code: "preview-hash-mismatch" });
    expect(deps.createOrder).not.toHaveBeenCalled();
  });
});
