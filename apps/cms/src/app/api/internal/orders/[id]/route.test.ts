import { beforeEach, describe, expect, it, vi } from "vitest";

const internal = vi.hoisted(() => ({
  lockOrderReconciliationWrites: vi.fn(async () => undefined),
  operatorScope: vi.fn(),
  withTransaction: vi.fn(async (_payload: unknown, work: (req: unknown) => Promise<unknown>) => work({})),
}));

vi.mock("@/lib/internal", () => internal);

import { PATCH } from "./route";

const originalOrder = {
  id: 90,
  seller: 7,
  customer: 5,
  status: "draft",
  address: "1D-201",
  paymentStatus: "unpaid",
  note: "少辣",
};

function payloadWith(order: Record<string, unknown> | undefined = originalOrder) {
  const find = vi.fn(async () => ({ docs: order ? [order] : [] }));
  const update = vi.fn(async ({ id, data }: { id: string; data: Record<string, unknown> }) => ({ ...order, id, ...data }));
  return { find, update };
}

function request(body: unknown) {
  return new Request("http://cms.test/api/internal/orders/90", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "90" }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/internal/orders/:id", () => {
  it("passes every ordinary field to Payload", async () => {
    const payload = payloadWith();
    internal.operatorScope.mockResolvedValue({ sellerId: 7, payload });
    const data = {
      paymentStatus: "paid",
      paymentMethod: "wechat",
      paidAt: "2026-07-13T08:00:00.000Z",
      date: "2026-07-14",
      occasion: "dinner",
      note: "放门口",
    };

    const response = await PATCH(request(data), context);

    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith(expect.objectContaining({
      collection: "orders",
      id: "90",
      data,
      overrideAccess: true,
    }));
  });

  it("strips snapshot, ownership, lifecycle, and unknown fields from a mixed body", async () => {
    const payload = payloadWith();
    internal.operatorScope.mockResolvedValue({ sellerId: 7, payload });

    const response = await PATCH(request({
      address: "9Z-999",
      status: "confirmed",
      customer: 99,
      seller: 99,
      unknown: "forged",
      note: "放门口",
    }), context);

    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith(expect.objectContaining({ data: { note: "放门口" } }));
    await expect(response.json()).resolves.toMatchObject({
      address: "1D-201",
      status: "draft",
      customer: 5,
      seller: 7,
      note: "放门口",
    });
  });

  it("returns 400 when the body only contains forbidden or unknown fields", async () => {
    const payload = payloadWith();
    internal.operatorScope.mockResolvedValue({ sellerId: 7, payload });

    const response = await PATCH(request({
      address: "9Z-999",
      status: "confirmed",
      customer: 99,
      seller: 99,
      unknown: "forged",
    }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "no updatable fields" });
    expect(payload.update).not.toHaveBeenCalled();
  });

  it("rejects historical or unknown payment states", async () => {
    const payload = payloadWith();
    internal.operatorScope.mockResolvedValue({ sellerId: 7, payload });

    const response = await PATCH(request({ paymentStatus: "reconciled" }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "paymentStatus must be unpaid or paid" });
    expect(payload.update).not.toHaveBeenCalled();
  });

  it("clears arrival metadata when the manual mark is revoked", async () => {
    const payload = payloadWith();
    internal.operatorScope.mockResolvedValue({ sellerId: 7, payload });

    const response = await PATCH(request({
      paymentStatus: "unpaid",
      paidAt: "2026-07-13T08:00:00.000Z",
      paymentMethod: "wechat",
    }), context);

    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { paymentStatus: "unpaid", paidAt: null, paymentMethod: null },
    }));
  });
});
