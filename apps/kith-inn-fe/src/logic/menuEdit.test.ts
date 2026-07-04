import type { MenuPlanView } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { generatePlans, loadPlans, OCCASION_LABEL, plansByOccasion, publishPlan, swapDish, type Req } from "./menuEdit";

type ReqOptions = Parameters<Req>[0];
const plan = (occasion: "lunch" | "dinner", over: Partial<MenuPlanView> = {}): MenuPlanView => ({
  planId: 501,
  date: "2026-07-08",
  occasion,
  status: "draft",
  dishes: [],
  ...over,
});

describe("plansByOccasion / OCCASION_LABEL", () => {
  it("splits a day's plans into lunch/dinner", () => {
    const { lunch, dinner } = plansByOccasion([plan("lunch"), plan("dinner", { planId: 502 })]);
    expect(lunch?.planId).toBe(501);
    expect(dinner?.planId).toBe(502);
  });

  it("absent meals are undefined", () => {
    expect(plansByOccasion([])).toEqual({});
    expect(plansByOccasion([plan("lunch")]).dinner).toBeUndefined();
  });

  it("OCCASION_LABEL maps to 中文", () => {
    expect(OCCASION_LABEL.lunch).toBe("午餐");
    expect(OCCASION_LABEL.dinner).toBe("晚餐");
  });
});

const rec = (resp: { statusCode: number; data: unknown }): { req: Req; cap: { v?: ReqOptions } } => {
  const cap: { v?: ReqOptions } = {};
  const req = vi.fn(async (o: ReqOptions) => {
    cap.v = o;
    return resp;
  }) as unknown as Req;
  return { req, cap };
};

describe("loadPlans", () => {
  it("GETs /menu/plans?date= with Bearer, returns plans[]", async () => {
    const { req, cap } = rec({ statusCode: 200, data: { plans: [plan("lunch")] } });
    await expect(loadPlans("t", "2026-07-08", req)).resolves.toEqual([plan("lunch")]);
    expect(cap.v?.url).toMatch(/\/menu\/plans\?date=2026-07-08$/);
    expect(cap.v?.header).toMatchObject({ Authorization: "Bearer t" });
  });

  it("throws on non-200", async () => {
    const req = vi.fn(async () => ({ statusCode: 401, data: {} })) as unknown as Req;
    await expect(loadPlans("t", "x", req)).rejects.toThrow();
  });

  it("accepts a {from,to} range query → range URL", async () => {
    const { req, cap } = rec({ statusCode: 200, data: { plans: [] } });
    await loadPlans("t", { from: "2026-07-06", to: "2026-07-10" }, req);
    expect(cap.v?.url).toMatch(/\/menu\/plans\?from=2026-07-06&to=2026-07-10$/);
  });

  it("returns [] when plans absent in body", async () => {
    const req = vi.fn(async () => ({ statusCode: 200, data: {} })) as unknown as Req;
    await expect(loadPlans("t", "x", req)).resolves.toEqual([]);
  });
});

describe("generatePlans", () => {
  it("POSTs /menu/generate, returns ok+plans", async () => {
    const { req, cap } = rec({ statusCode: 200, data: { plans: [plan("lunch")] } });
    const r = await generatePlans("t", [{ date: "2026-07-08", occasion: "lunch" }], req);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plans).toHaveLength(1);
    expect(cap.v?.method).toBe("POST");
    expect(cap.v?.data).toEqual({ targets: [{ date: "2026-07-08", occasion: "lunch" }], force: false });
  });

  it("409 → reason plan-published", async () => {
    const req = vi.fn(async () => ({ statusCode: 409, data: { error: "plan-published" } })) as unknown as Req;
    expect((await generatePlans("t", [{ date: "x", occasion: "lunch" }], req)).ok).toBe(false);
  });

  it("body ok:false → pool-too-small reason", async () => {
    const req = vi.fn(async () => ({ statusCode: 200, data: { ok: false, reason: "pool-too-small" } })) as unknown as Req;
    const r = await generatePlans("t", [{ date: "x", occasion: "lunch" }], req);
    expect(r.ok).toBe(false);
  });

  it("500 → throws (non-2xx non-409)", async () => {
    const req = vi.fn(async () => ({ statusCode: 500, data: {} })) as unknown as Req;
    await expect(generatePlans("t", [{ date: "x", occasion: "lunch" }], req)).rejects.toThrow();
  });

  it("ok:false without reason → pool-too-small fallback", async () => {
    const req = vi.fn(async () => ({ statusCode: 200, data: { ok: false } })) as unknown as Req;
    const r = await generatePlans("t", [{ date: "x", occasion: "lunch" }], req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("pool-too-small");
  });

  it("200 with no plans field → ok:true plans []", async () => {
    const req = vi.fn(async () => ({ statusCode: 200, data: {} })) as unknown as Req;
    const r = await generatePlans("t", [{ date: "x", occasion: "lunch" }], req);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plans).toEqual([]);
  });
});

describe("swapDish", () => {
  it("POSTs /menu/plans/:id/swap, returns plan + warning", async () => {
    const { req, cap } = rec({ statusCode: 200, data: { plan: plan("lunch"), warning: "会和近期主料重复" } });
    const r = await swapDish("t", 501, { dishId: "m1", replacementId: "m2" }, req);
    expect(r.warning).toBe("会和近期主料重复");
    expect(cap.v?.url).toMatch(/\/menu\/plans\/501\/swap$/);
    expect(cap.v?.data).toEqual({ dishId: "m1", replacementId: "m2" });
  });

  it("throws on non-2xx", async () => {
    const req = vi.fn(async () => ({ statusCode: 409, data: { error: "plan-published" } })) as unknown as Req;
    await expect(swapDish("t", 501, { dishId: "m1" }, req)).rejects.toThrow();
  });
});

describe("publishPlan", () => {
  it("POSTs /menu/plans/:id/publish, returns publishText", async () => {
    const { req, cap } = rec({ statusCode: 200, data: { publishText: "【桃子】7月8日…" } });
    await expect(publishPlan("t", 501, req)).resolves.toEqual({ publishText: "【桃子】7月8日…" });
    expect(cap.v?.url).toMatch(/\/menu\/plans\/501\/publish$/);
    expect(cap.v?.method).toBe("POST");
  });

  it("throws on non-2xx", async () => {
    const req = vi.fn(async () => ({ statusCode: 502, data: {} })) as unknown as Req;
    await expect(publishPlan("t", 501, req)).rejects.toThrow();
  });
});
