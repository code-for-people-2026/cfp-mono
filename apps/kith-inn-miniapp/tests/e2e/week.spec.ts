import { expect, test, type Page } from "@playwright/test";
import { CategorySchema, GenerateInputSchema, MenuPreviewSchema, WeekPlanSchema, WeekWriteInputSchema,
  type Dish, type MenuPreview, type WeekPlan } from "@cfp/kith-inn-contracts";

const monday = "2026-09-21", timestamp = "2026-09-21T00:00:00Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const lunch = (page: Page) => page.locator(".meal-block:visible").first();

// Controlled API transport and stored H5 session, not real WeChat or PostgreSQL evidence.
async function openWeek(page: Page) {
  const items: Dish[] = CategorySchema.options.flatMap((category, c) => Array.from({ length: 4 }, (_, i) => ({
    id: id(c * 10 + i + 1), name: `${{ meat: "荤", vegetable: "素", soup: "汤" }[category]}菜${i + 1}`,
    category, active: true, version: 1, createdAt: timestamp, updatedAt: timestamp,
  })));
  const state = { items, saved: null as WeekPlan | null, generated: null as MenuPreview | null,
    writes: [] as { body: string; key: string }[], generations: 0, failure: "" };
  const receipts = new Map<string, WeekPlan>();
  await page.addInitScript(() => localStorage.setItem("kith-inn:session:v1:https://kith-inn.test", JSON.stringify({
    data: { token: "t".repeat(43), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }
  })));
  await page.route("**/api/kith-inn/**", async (route) => {
    const request = route.request(), method = request.method(), url = new URL(request.url());
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PUT,OPTIONS" };
    const error = (status: number, code: string, details?: unknown) => route.fulfill({ status, headers,
      json: { error: { code, message: "受控错误", requestId: id(999), ...(details ? { details } : {}) } } });
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith("/dishes")) return route.fulfill({ headers, json: { items: state.items } });
    if (url.pathname.endsWith("/weeks")) return route.fulfill({ headers, json: { items: state.saved ? [{
      weekStart: monday, version: state.saved.version, confirmedAt: state.saved.confirmedAt, updatedAt: state.saved.updatedAt
    }] : [], nextBefore: null } });
    if (method === "GET") return state.saved ? route.fulfill({ headers, json: state.saved }) : error(404, "NOT_FOUND");
    if (url.pathname.endsWith("/generate")) {
      state.generations++;
      const input = GenerateInputSchema.parse(request.postDataJSON());
      if (state.failure === "shortage") { state.failure = ""; return error(422, "INSUFFICIENT_DISHES", {
        shortages: [{ category: "meat", required: input.structure.meat, available: 1 }]
      }); }
      state.generated = MenuPreviewSchema.parse({ weekStart: monday, structure: input.structure,
        meals: input.meals.map((meal) => ({ ...meal, soupOmitted: false, ...Object.fromEntries(CategorySchema.options.map((category) =>
          [category, meal.enabled ? items.filter((dish) => dish.category === category).slice(0, input.structure[category])
            .map((dish) => ({ dishId: dish.id, name: dish.name })) : []])) })) });
      return route.fulfill({ headers, json: state.generated });
    }
    const key = request.headers()["idempotency-key"]!;
    state.writes.push({ body: request.postData()!, key });
    const input = WeekWriteInputSchema.parse(request.postDataJSON());
    if (state.failure === "conflict") { state.failure = ""; return error(409, "VERSION_CONFLICT", { currentVersion: state.saved!.version }); }
    if (receipts.has(key)) return route.fulfill({ headers, json: receipts.get(key) });
    state.saved = WeekPlanSchema.parse({ structure: input.structure,
      id: id(500), weekStart: monday, version: input.baseVersion + 1,
      confirmedAt: input.confirm ? timestamp : null, createdAt: timestamp, updatedAt: timestamp,
      meals: input.meals.map((meal) => ({ ...meal, ...Object.fromEntries(CategorySchema.options.map((category) =>
        [category, meal[category].map((dishId) => ({ dishId, name: items.find((dish) => dish.id === dishId)!.name }))])) })) });
    receipts.set(key, state.saved);
    if (state.failure === "lost") { state.failure = ""; return route.abort("failed"); }
    return route.fulfill({ headers, json: state.saved });
  });
  await page.goto(`/#/pages/week/index?weekStart=${monday}`);
  await expect(button(page, "生成本周菜单")).toBeVisible();
  return state;
}
async function generate(page: Page) {
  await button(page, "生成本周菜单").click();
  await expect(page.locator(".day-plan")).toHaveCount(7);
  await page.locator(".day-toggle:visible").first().click();
}
async function replaceLunch(page: Page) {
  await lunch(page).getByRole("button", { name: "选择其他菜：荤菜1", exact: true }).click();
  await button(page, "荤菜3").click();
}

test("生成14餐位置并跳过指定餐，局部换菜去汤后确认，从历史重开保留结果", async ({ page }) => {
  const state = await openWeek(page);
  await page.locator(".setting-row").last().getByRole("checkbox").last().uncheck();
  await generate(page);
  expect(state.generated!.meals).toHaveLength(14);
  expect(state.generated!.meals[13]).toMatchObject({ enabled: false, meat: [], vegetable: [], soup: [] });
  await expect(page.locator(".state-badge")).toHaveText("13 餐已安排");
  await replaceLunch(page);
  await lunch(page).getByRole("button", { name: "去掉本餐汤", exact: true }).click();
  await button(page, "确认周菜单").click();
  await expect(page.getByText("周菜单已保存并确认", { exact: true })).toBeVisible();
  const saved = state.saved!;
  expect(saved.meals[0]!.meat[0]!.name).toBe("荤菜3");
  expect(saved.meals[0]!.soupOmitted).toBe(true);
  expect(saved.meals.slice(1)).toEqual(state.generated!.meals.slice(1));
  await button(page, "历史菜单").click();
  await page.getByRole("button", { name: /2026-09-21 这一周/ }).click();
  await expect(page.getByText("周菜单已确认", { exact: true })).toBeVisible();
  await page.locator(".day-toggle:visible").first().click();
  await expect(lunch(page)).toContainText("荤菜3");
  await expect(lunch(page)).not.toContainText("汤菜1");
  expect(state.writes).toHaveLength(1);
});

test("修改结构取消与缺菜失败都保留换菜去汤草稿", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await replaceLunch(page);
  await lunch(page).getByRole("button", { name: "去掉本餐汤", exact: true }).click();
  const previous = await page.locator(".week-plans").textContent();
  await button(page, "修改周设置").click();
  await page.locator(".structure-fields input").first().fill("3");
  await button(page, "按新设置重新生成").click();
  await page.getByText("取消", { exact: true }).click();
  expect(state.generations).toBe(1);
  expect(await page.locator(".week-plans").textContent()).toBe(previous);
  state.failure = "shortage";
  await button(page, "按新设置重新生成").click();
  await page.getByText("确认重排", { exact: true }).click();
  await expect(page.locator(".alert")).toContainText("荤需3道，现有1道");
  expect(await page.locator(".week-plans").textContent()).toBe(previous);
  await button(page, "取消设置，保留原菜单").click();
  await button(page, "保存调整").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  expect(state.saved!.structure.meat).toBe(2);
  expect(state.saved!.meals[0]).toMatchObject({ soupOmitted: true, meat: [{ name: "荤菜3" }, { name: "荤菜2" }] });
});

test("保存已提交但响应丢失时冻结草稿，并使用原键原正文安全重试", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await replaceLunch(page);
  state.failure = "lost";
  await button(page, "确认周菜单").click();
  await expect(button(page, "重试原保存请求")).toBeVisible();
  await expect(button(page, "保存调整")).toBeDisabled();
  await expect(button(page, "取消编辑")).toBeDisabled();
  await expect(button(page, "历史菜单")).toBeDisabled();
  await expect(lunch(page).getByRole("button", { name: "选择其他菜：荤菜3", exact: true })).toBeDisabled();
  await button(page, "重试原保存请求").click();
  await expect(page.getByText("周菜单已保存并确认", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1]).toEqual(state.writes[0]);
  expect(state.saved!.version).toBe(1);
});

test("409冲突保留草稿，读取只供核对，明确确认后载入服务器内容", async ({ page }) => {
  const state = await openWeek(page); await generate(page);
  await button(page, "保存调整").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  await replaceLunch(page);
  state.saved = { ...state.saved!, version: 2 };
  state.failure = "conflict";
  await button(page, "保存调整").click();
  await expect(button(page, "读取服务器菜单核对")).toBeVisible();
  await expect(lunch(page)).toContainText("荤菜3");
  await expect(button(page, "保存调整")).toBeDisabled();
  await button(page, "读取服务器菜单核对").click();
  await expect(page.locator(".recovery")).toContainText("版本2");
  await expect(lunch(page)).toContainText("荤菜3");
  await button(page, "核对完成，载入服务器版本").click();
  await page.getByText("取消", { exact: true }).click();
  await expect(lunch(page)).toContainText("荤菜3");
  await button(page, "核对完成，载入服务器版本").click();
  await page.getByText("确定", { exact: true }).click();
  await expect(lunch(page)).toContainText("荤菜1");
  await expect(lunch(page)).not.toContainText("荤菜3");
  expect(state.writes).toHaveLength(2);
});

test("原汤停用后须选齐全部汤才恢复，取消和未选齐不改变去汤状态", async ({ page }) => {
  const state = await openWeek(page);
  await page.locator(".structure-fields input").last().fill("2");
  await generate(page);
  await button(page, "保存调整").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  await lunch(page).getByRole("button", { name: "去掉本餐汤", exact: true }).click();
  state.items.find((dish) => dish.name === "汤菜1")!.active = false;
  await lunch(page).getByRole("button", { name: "恢复本餐汤", exact: true }).click();
  await expect(page.getByText("重新选齐 2 道汤", { exact: true })).toBeVisible();
  await page.locator(".candidate-sheet").getByRole("button", { name: "取消", exact: true }).click();
  await expect(lunch(page)).not.toContainText("汤菜2");
  await lunch(page).getByRole("button", { name: "恢复本餐汤", exact: true }).click();
  await button(page, "汤菜2").click();
  await expect(button(page, "选齐并恢复汤")).toBeDisabled();
  await button(page, "汤菜3").click();
  await button(page, "选齐并恢复汤").click();
  await expect(lunch(page)).toContainText("汤菜2");
  await expect(lunch(page)).toContainText("汤菜3");
  await button(page, "保存调整").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  expect(state.saved!.meals[0]).toMatchObject({ soupOmitted: false, soup: [{ name: "汤菜2" }, { name: "汤菜3" }] });
  expect(state.saved!.meals.slice(1)).toEqual(state.generated!.meals.slice(1));
});
