import { afterEach, describe, expect, it, vi } from "vitest";
import type { CmsJielongOrderCreate, MealSlot, SellerSnapshot } from "@cfp/kith-inn-v1-shared";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { CmsMealSlotError } from "../lib/cms/mealSlots";
import { CmsOrderError } from "../lib/cms/orders";
import { CmsSellerError } from "../lib/cms/seller";
import { jielongRoutes, type JielongDeps } from "./jielong";

const SECRET = "v1-secret";
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; vi.unstubAllGlobals(); });
const text = "2026-07-20 午餐\n王阿姨 2份";
const seller: SellerSnapshot = { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" };
const slot: MealSlot = { id: 11, sellerId: 7, date: "2026-07-20", occasion: "lunch", menuItems: [],
  orderStatus: "closed", orderDeadline: "2026-07-01T00:00:00.000Z", priceCents: null,
  generatedAt: "2026-07-10T00:00:00.000Z" };
const imported = (input: CmsJielongOrderCreate) => ({
  id: 32, sellerId: 7, totalCents: input.quantity * input.unitPriceCents, ...input
});
function deps(overrides: Partial<JielongDeps> = {}): JielongDeps {
  return { listMealSlots: vi.fn(async () => [slot]), getSeller: vi.fn(async () => seller),
    findOrder: vi.fn(async () => null), createOrder: vi.fn(async (_token, input) => imported(input)), ...overrides };
}
const post = (app: ReturnType<typeof jielongRoutes>, path: string, body: unknown) => app.request(path, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body)
});

describe("merchant jielong routes", () => {
  it("previews closed/expired slots read-only and validates auth/input", async () => {
    const injected = deps(); const app = jielongRoutes(SECRET, injected);
    expect((await app.request("/preview", { method: "POST" })).status).toBe(401);
    expect((await post(app, "/preview", "{")).status).toBe(400);
    expect((await post(app, "/preview", { text: "bad" })).status).toBe(422);
    const response = await post(app, "/preview", { text });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ totalCents: 6000, lines: [{ lineNumber: 2 }] });
    expect(injected.listMealSlots).toHaveBeenCalledWith(token, { from: "2026-07-20", to: "2026-07-20" });
    expect(injected.findOrder).not.toHaveBeenCalled(); expect(injected.createOrder).not.toHaveBeenCalled();
    expect((await post(jielongRoutes(SECRET, deps({ listMealSlots: vi.fn(async () => []) })),
      "/preview", { text })).status).toBe(404);
    expect((await post(jielongRoutes(SECRET, deps({ listMealSlots: vi.fn(async () => [slot, { ...slot, id: 12 }]) })),
      "/preview", { text })).status).toBe(409);
  });

  it("requires confirmation, rechecks price, commits, and sanitizes failures", async () => {
    const injected = deps(); const app = jielongRoutes(SECRET, injected);
    const preview = await (await post(app, "/preview", { text })).json() as { previewHash: string };
    expect((await post(app, "/commit", { text, previewHash: preview.previewHash, confirmed: false })).status).toBe(422);
    const committed = await post(app, "/commit", { text, previewHash: preview.previewHash, confirmed: true });
    expect(committed.status).toBe(200);
    await expect(committed.json()).resolves.toMatchObject({ results: [{ lineNumber: 2, status: "created", orderId: 32 }] });
    expect(injected.createOrder).toHaveBeenCalledWith(token, expect.objectContaining({ source: "jielong-import",
      customerProfileId: null, customerOpenid: null, address: null, previewHash: preview.previewHash }));
    const changed = jielongRoutes(SECRET, deps({ getSeller: vi.fn(async () => ({ ...seller, defaultPriceCents: 3100 })) }));
    const stale = await post(changed, "/commit", { text, previewHash: preview.previewHash, confirmed: true });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: "preview-hash-mismatch" });
    const failed = jielongRoutes(SECRET, deps({ listMealSlots: vi.fn(async () => { throw new Error("secret"); }) }));
    const failure = await post(failed, "/preview", { text });
    expect(failure.status).toBe(502);
    expect(JSON.stringify(await failure.json())).not.toContain("secret");
    for (const [error, status] of [
      [new CmsMealSlotError(404, "slot-missing", "不存在"), 404],
      [new CmsSellerError(500, "seller-failed", "失败"), 502],
      [new CmsOrderError(422, "order-invalid", "无效"), 422]
    ] as const) {
      const mapped = jielongRoutes(SECRET, deps({ listMealSlots: vi.fn(async () => { throw error; }) }));
      expect((await post(mapped, "/preview", { text })).status).toBe(status);
    }
  });

  it("wires the default CMS clients with service authorization", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const fetch = vi.fn<typeof globalThis.fetch>(async (request, init) => {
      const url = String(request);
      if (url.endsWith("/seller")) return Response.json({ doc: seller });
      if (url.includes("/meal-slots?")) return Response.json({ docs: [slot] });
      if (init?.method !== "POST") return Response.json({ doc: null });
      const input = JSON.parse(String(init.body)) as CmsJielongOrderCreate;
      const doc = { ...input } as Record<string, unknown>;
      delete doc.previewHash; delete doc.lineNumber; delete doc.customerOpenid;
      return Response.json({ doc: { id: 32, sellerId: 7, totalCents: 6000, ...doc } }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetch);
    const app = jielongRoutes(SECRET);
    const preview = await (await post(app, "/preview", { text })).json() as { previewHash: string };
    expect((await post(app, "/commit", { text, previewHash: preview.previewHash, confirmed: true })).status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("previewHash="), expect.objectContaining({
      headers: expect.objectContaining({ "x-kith-inn-v1-internal": "internal" })
    }));
  });
});
