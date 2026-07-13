import { beforeEach, describe, expect, it, vi } from "vitest";

const internal = vi.hoisted(() => ({
  operatorScope: vi.fn(),
  ownedBy: vi.fn(async () => true),
}));

vi.mock("@/lib/internal", () => internal);

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/internal/menu-plans/upsert", () => {
  it("normalizes calendar dates before Payload lookup and SQLite persistence", async () => {
    const find = vi.fn()
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [] });
    const create = vi.fn(async ({ collection, data }: {
      collection: string;
      data: Record<string, unknown>;
    }) => collection === "service_slots"
      ? { id: 31, ...data }
      : { id: 41, ...data });
    internal.operatorScope.mockResolvedValue({ sellerId: 7, payload: { find, create } });

    const response = await POST(new Request("http://cms.test/api/internal/menu-plans/upsert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{
        date: "2026-07-13",
        occasion: "lunch",
        offerings: [11, 12],
        status: "draft",
      }]),
    }));

    expect(response.status).toBe(200);
    expect(find).toHaveBeenNthCalledWith(1, expect.objectContaining({
      collection: "service_slots",
      where: { and: [
        { seller: { equals: 7 } },
        { date: { equals: "2026-07-13T00:00:00.000Z" } },
        { occasion: { equals: "lunch" } },
      ] },
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      collection: "service_slots",
      data: expect.objectContaining({ date: "2026-07-13T00:00:00.000Z" }),
    }));
  });
});
