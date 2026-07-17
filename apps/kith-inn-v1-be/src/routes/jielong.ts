import { jielongCommitInputSchema, jielongPreviewInputSchema } from "@cfp/kith-inn-v1-shared/api";
import { parseJielongText } from "@cfp/kith-inn-v1-shared";
import type { CmsJielongOrderCreate, MealSlot, Order, SellerSnapshot } from "@cfp/kith-inn-v1-shared";
import { Hono, type Context } from "hono";
import { commitJielong, JielongServiceError, previewJielong } from "../domain/jielong/service";
import { CmsMealSlotError, listMealSlots as listMealSlotsFn } from "../lib/cms/mealSlots";
import { CmsOrderError, createJielongOrder, findJielongOrder } from "../lib/cms/orders";
import { CmsSellerError, getSeller as getSellerFn } from "../lib/cms/seller";
import { operatorAuth, type AppVars } from "../middleware/operatorAuth";

export type JielongDeps = {
  listMealSlots: (token: string, range: { from: string; to: string }) => Promise<MealSlot[]>;
  getSeller: (token: string) => Promise<SellerSnapshot>;
  findOrder: (token: string, mealSlotId: string | number, hash: string, line: number) => Promise<Order | null>;
  createOrder: (token: string, input: CmsJielongOrderCreate) => Promise<Order>;
};
const defaultDeps: JielongDeps = {
  listMealSlots: (token, range) => listMealSlotsFn(token, range),
  getSeller: (token) => getSellerFn(token),
  findOrder: (token, slot, hash, line) => findJielongOrder(token, slot, hash, line),
  createOrder: (token, input) => createJielongOrder(token, input)
};

async function bodyOf(c: Context) {
  try { return { ok: true as const, value: await c.req.json() }; }
  catch { return { ok: false as const }; }
}
function dependencyError(c: Context, error: unknown) {
  if (error instanceof JielongServiceError) return c.json({ error: error.code, message: error.message }, 409);
  if (error instanceof CmsMealSlotError || error instanceof CmsSellerError || error instanceof CmsOrderError) {
    const status = ([401, 403, 404, 409, 422] as const).includes(error.status as 401)
      ? error.status as 401 | 403 | 404 | 409 | 422 : 502;
    return c.json({ error: error.code, message: error.message }, status);
  }
  return c.json({ error: "cms-unavailable", message: "接龙服务暂不可用" }, 502);
}

export function jielongRoutes(secret: string, deps: JielongDeps = defaultDeps) {
  const app = new Hono<AppVars>();
  app.use("*", operatorAuth(secret));
  const handle = async (c: Context<AppVars>, commit: boolean) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = (commit ? jielongCommitInputSchema : jielongPreviewInputSchema).safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-jielong-input", message: "接龙参数无效" }, 422);
    let target;
    try { target = parseJielongText(parsed.data.text).target; }
    catch { return c.json({ error: "invalid-jielong-text", message: "接龙文本格式无效" }, 422); }
    const token = c.get("operatorToken");
    try {
      const [slots, seller] = await Promise.all([
        deps.listMealSlots(token, { from: target.date, to: target.date }), deps.getSeller(token)
      ]);
      const matches = slots.filter((candidate) => candidate.date === target.date && candidate.occasion === target.occasion);
      if (matches.length === 0) return c.json({ error: "meal-slot-not-found", message: "餐次不存在" }, 404);
      if (matches.length > 1) return c.json({ error: "meal-slot-ambiguous", message: "餐次不唯一" }, 409);
      const slot = matches[0]!;
      const binding = { sellerId: c.get("sellerId"), mealSlotId: slot.id,
        unitPriceCents: slot.priceCents ?? seller.defaultPriceCents };
      if (!commit) return c.json(previewJielong(parsed.data.text, binding));
      return c.json(await commitJielong(jielongCommitInputSchema.parse(body.value), binding, {
        findOrder: (mealSlotId, hash, line) => deps.findOrder(token, mealSlotId, hash, line),
        createOrder: (input) => deps.createOrder(token, input)
      }));
    } catch (error) { return dependencyError(c, error); }
  };
  app.post("/preview", (c) => handle(c, false));
  app.post("/commit", (c) => handle(c, true));
  return app;
}
