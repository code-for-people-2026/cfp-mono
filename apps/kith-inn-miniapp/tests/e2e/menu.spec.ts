import { expect, test, type Page } from "@playwright/test";
import { CategorySchema, DishBatchInputSchema, GenerateInputSchema, MenuPreviewSchema, WeekPlanSchema, WeekWriteInputSchema,
  type Dish, type MenuPreview, type WeekPlan } from "@cfp/kith-inn-contracts";

const monday = "2026-09-21", timestamp = "2026-09-21T00:00:00Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const lunch = (page: Page) => page.locator(".meal-block:visible").first();
const lunchDishes = (page: Page) => page.locator(".day-column").first().locator(".meal-cells").first();

// Controlled API transport and stored H5 session, not real WeChat or PostgreSQL evidence.
async function openWeek(page: Page, viaPool = false, dishCount = 4) {
  const items: Dish[] = CategorySchema.options.flatMap((category, c) => Array.from({ length: dishCount }, (_, i) => ({
    id: id(c * 10 + i + 1), name: `${{ meat: "荤", vegetable: "素", soup: "汤" }[category]}菜${i + 1}`,
    category, active: true, version: 1, createdAt: timestamp, updatedAt: timestamp,
  })));
  const state = { items: viaPool ? [] as Dish[] : items, saved: null as WeekPlan | null, generated: null as MenuPreview | null,
    writes: [] as { body: string; key: string }[], generations: 0, reads: 0, failure: "" };
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
    if (url.pathname.endsWith("/dishes")) {
      if (method === "POST") {
        const input = DishBatchInputSchema.parse(request.postDataJSON());
        state.items = input.items.map((dish) => ({ ...items.find((item) => item.name === dish.name)!, ...dish }));
      }
      return route.fulfill({ status: method === "POST" ? 201 : 200, headers, json: { items: state.items } });
    }
    if (url.pathname.endsWith("/weeks")) return route.fulfill({ headers, json: { items: state.saved ? [{
      weekStart: monday, version: state.saved.version, confirmedAt: state.saved.confirmedAt, updatedAt: state.saved.updatedAt
    }] : [], nextBefore: null } });
    if (method === "GET") {
      state.reads++;
      if (state.failure === "read") { state.failure = ""; return error(503, "INTERNAL_ERROR"); }
      if (state.failure === "invalid") { state.failure = ""; return route.fulfill({ headers, json: { ...state.saved, meals: [] } }); }
      return state.saved ? route.fulfill({ headers, json: state.saved }) : error(404, "NOT_FOUND");
    }
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
  if (viaPool) {
    await page.clock.setFixedTime(new Date(timestamp));
    await page.goto("/");
    await button(page, "建立我的菜品池").click();
    await page.locator('textarea[placeholder="每行一道菜，例如：红烧排骨"]').fill(items.map((dish) => dish.name).join("\n"));
    await button(page, "自动分成荤 / 素 / 汤").click();
    for (const dish of items.filter((dish) => dish.category === "meat")) {
      await button(page, `更改${dish.name}分类，当前素`).click();
      await button(page, `更改${dish.name}分类，当前汤`).click();
    }
    await button(page, "确认加入菜品池").click();
    await expect(page.locator(".dish-card")).toHaveCount(12);
    await button(page, "下一步：安排本周菜单").click();
  } else await page.goto(`/#/pages/week/index?weekStart=${monday}`);
  await expect(button(page, "生成本周菜单")).toBeVisible();
  return state;
}
async function generate(page: Page) {
  await button(page, "生成本周菜单").click();
  await expect(page.locator(".day-column")).toHaveCount(7);
}
async function replaceLunch(page: Page) {
  await button(page, "周一午餐：荤菜1").click();
  await button(page, "自己选").click();
  await button(page, "荤菜3").click(); await button(page, "应用这次替换").click();
}

async function confirmWeek(page: Page) {
  await button(page, "确认周菜单").click();
  await expect(page.locator(".readonly-board")).toBeVisible();
  await expect(page.locator(".readonly-board .dish-cell button")).toHaveCount(0);
  await button(page, "保存本周菜单").click();
}

// Intercept only the browser clipboard boundary; this is not WeChat clipboard evidence.
async function clipboard(page: Page, fail = false) {
  await page.evaluate((fail) => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text: string) => {
      if (fail) throw new Error("controlled clipboard failure");
      document.documentElement.dataset.copied = text;
    }
  } }); }, fail);
}
const preview = (page: Page) => page.getByRole("button", { name: /^(预览本餐文字|去复制菜单)$/ });
const closeCopy = (page: Page) => button(page, "关闭菜单文字").click();

test("从空菜池建立到排周菜单、换菜去汤、保存回看、复制重试及改菜再复制", async ({ page }) => {
  const state = await openWeek(page, true);
  await page.locator(".setting-row").last().getByRole("checkbox").last().uncheck();
  await generate(page);
  expect(state.generated!.meals).toHaveLength(14);
  expect(state.generated!.meals[13]).toMatchObject({ enabled: false, meat: [], vegetable: [], soup: [] });
  await expect(page.locator(".board-title")).toHaveText("7 天 13 餐菜单");
  await replaceLunch(page);
  await lunch(page).getByRole("button", { name: "去掉本餐汤", exact: true }).click();
  await confirmWeek(page);
  await expect(page.getByText("周菜单已保存并确认", { exact: true })).toBeVisible();
  const saved = state.saved!;
  expect(saved.meals[0]!.meat[0]!.name).toBe("荤菜3");
  expect(saved.meals[0]!.soupOmitted).toBe(true);
  expect(saved.meals.slice(1)).toEqual(state.generated!.meals.slice(1));
  await button(page, "历史").click();
  await expect(page.locator(".history-app")).toBeVisible();
  await expect(lunchDishes(page)).toContainText("荤菜3");
  await expect(lunchDishes(page)).not.toContainText("汤菜1");
  await button(page, "调整这一周").click();
  await expect(preview(page)).toBeVisible();
  await expect(page.getByText(/旧消息不会自动更新|自行通知邻居/)).toHaveCount(0);
  const reads = state.reads;
  await preview(page).click();
  await expect(page.locator(".copy-preview")).toHaveText("2026年9月21日（周一）午餐\n荤：荤菜3、荤菜2\n素：素菜1、素菜2");
  expect(state.reads).toBe(reads + 1);
  await expect(page.locator(".copy-screen")).toBeVisible();
  await expect(page.locator(".week-plans:visible")).toHaveCount(0);
  await clipboard(page, true); await button(page, "复制菜单文字").click();
  await expect(page.getByText("复制失败，文字已保留，请重试复制。", { exact: true })).toBeVisible();
  const text = await page.locator(".copy-preview").textContent();
  await clipboard(page); await button(page, "复制菜单文字").click();
  await expect(page.getByText("已复制，请到微信粘贴发送", { exact: true })).toBeVisible();
  expect(await page.locator("html").getAttribute("data-copied")).toBe(text);
  expect(state.saved).toEqual(saved); expect(state.writes).toHaveLength(1);
  await closeCopy(page);
  await expect(button(page, "去复制菜单")).toBeEnabled();
  await page.getByRole("button", { name: /^(继续编辑|查看并调整这一周)$/ }).click();
  await button(page, "周一午餐：荤菜3").click();
  await button(page, "自己选").click();
  await button(page, "荤菜4").click(); await button(page, "应用这次替换").click(); await preview(page).click();
  await button(page, "保存后预览").click();
  await expect(page.locator(".copy-preview")).toContainText("荤菜4");
  await button(page, "复制菜单文字").click();
  await expect(page.locator("html")).toHaveAttribute("data-copied", /荤菜4/);
  expect(state.writes).toHaveLength(2);
  await closeCopy(page);
  await page.getByRole("button", { name: "查看并调整这一周", exact: true }).click();
  await expect(page.locator(".day-column").last().locator(".meal-cells").last()).toContainText("不安排");
});

test("修改结构取消与缺菜失败都保留换菜去汤草稿", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await replaceLunch(page);
  await lunch(page).getByRole("button", { name: "去掉本餐汤", exact: true }).click();
  await expect(lunch(page).getByRole("button", { name: "恢复本餐汤", exact: true })).toBeVisible();
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
  await confirmWeek(page);
  await expect(button(page, "重试原保存请求")).toBeVisible();
  await expect(button(page, "保存本周菜单")).toBeDisabled();
  await expect(button(page, "返回编辑")).toBeDisabled();
  await expect(button(page, "历史")).toBeDisabled();
  await expect(page.locator(".readonly-board")).toBeVisible();
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
  await button(page, "查看并调整这一周").click();
  await expect(lunchDishes(page)).toContainText("荤菜1");
  await expect(lunchDishes(page)).not.toContainText("荤菜3");
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
  await button(page, "全部").click();
  await expect(lunchDishes(page)).toContainText("汤菜2");
  await expect(lunchDishes(page)).toContainText("汤菜3");
  await button(page, "保存调整").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  expect(state.saved!.meals[0]).toMatchObject({ soupOmitted: false, soup: [{ name: "汤菜2" }, { name: "汤菜3" }] });
  expect(state.saved!.meals.slice(1)).toEqual(state.generated!.meals.slice(1));
});


test("无本地修改仍重新读保存快照，读取异常不提供旧文字，重试后获取新版本", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await button(page, "保存调整").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  state.saved!.meals[0]!.meat[0]!.name = "另一会话保存的菜";
  state.saved!.version++;
  for (const failure of ["", "read", "invalid"]) {
    state.failure = failure; const reads = state.reads;
    await preview(page).click();
    if (failure) {
      await expect(page.locator(".copy-screen")).toContainText("读取已保存菜单失败");
      await expect(page.locator(".copy-preview")).toHaveCount(0);
      await expect(button(page, "复制菜单文字")).toHaveCount(0);
      await button(page, "重新读取本餐文字").click();
    }
    await expect(page.locator(".copy-preview")).toContainText("另一会话保存的菜");
    expect(state.reads).toBe(reads + (failure ? 2 : 1));
    await closeCopy(page);
  }
  expect(state.writes).toHaveLength(1); expect(state.saved!.version).toBe(2);
});

test("未保存复制须保存或明确放弃，取消和读取失败保留草稿", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await button(page, "保存调整").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  await replaceLunch(page); const reads = state.reads;
  await preview(page).click();
  await expect(button(page, "保存后预览")).toBeVisible(); expect(state.reads).toBe(reads);
  await button(page, "晚餐").click(); await button(page, "午餐").click();
  expect(state.reads).toBe(reads); await expect(page.locator(".copy-preview")).toHaveCount(0);
  await button(page, "放弃修改后预览").click(); await page.locator(".taro-model__cancel").filter({ hasText: /^继续编辑$/ }).click();
  expect(state.reads).toBe(reads);
  await closeCopy(page); await expect(lunch(page)).toContainText("荤菜3"); await preview(page).click();
  state.failure = "read";
  await button(page, "放弃修改后预览").click(); await page.getByText("放弃修改", { exact: true }).click();
  await expect(page.locator(".copy-screen")).toContainText("读取已保存菜单失败");
  await expect(button(page, "复制菜单文字")).toHaveCount(0);
  await closeCopy(page); await expect(lunch(page)).toContainText("荤菜3"); await preview(page).click();
  await button(page, "放弃修改后预览").click(); await page.getByText("放弃修改", { exact: true }).click();
  await expect(page.locator(".copy-preview")).toContainText("荤菜1");
  await expect(page.locator(".copy-preview")).not.toContainText("荤菜3"); expect(state.writes).toHaveLength(1);
});

test("保存后预览响应丢失不复制草稿，原请求重试成功后才重新读取", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await preview(page).click();
  state.failure = "lost"; await button(page, "保存后预览").click();
  await expect(button(page, "重试原保存请求")).toBeVisible();
  await expect(button(page, "复制菜单文字")).toHaveCount(0);
  await closeCopy(page); await expect(lunch(page)).toContainText("荤菜1");
  await button(page, "重试原保存请求").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  await preview(page).click(); await expect(page.locator(".copy-preview")).toContainText("荤菜1");
  expect(state.writes).toHaveLength(2); expect(state.writes[0]).toEqual(state.writes[1]);
  expect(state.saved!.version).toBe(1);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`确认后可见下一步、独立复制并返回编辑 ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const state = await openWeek(page); await generate(page);
    await confirmWeek(page);
    await expect(page.getByText("周菜单已保存并确认", { exact: true })).toBeVisible();
    const next = button(page, "去复制菜单");
    // No scroll or click before this assertion: confirming must reveal the next action.
    await expect(next).toBeInViewport({ ratio: 1 });
    await expect(next).toHaveClass(/secondary/);
    const reads = state.reads, saved = JSON.stringify(state.saved);
    await next.click();
    await expect(page.locator(".copy-screen")).toBeVisible();
    await expect(page.locator(".app-heading")).toHaveText("复制菜单");
    await expect(page.locator(".week-plans:visible")).toHaveCount(0);
    await expect(page.locator(".copy-preview")).toContainText("2026年9月21日（周一）午餐");
    expect(state.reads).toBe(reads + 1);
    await expect(button(page, "复制菜单文字")).toBeInViewport({ ratio: 1 });
    await clipboard(page); await button(page, "复制菜单文字").click();
    await expect(page.getByText("已复制，请到微信粘贴发送", { exact: true })).toBeVisible();
    expect(JSON.stringify(state.saved)).toBe(saved); expect(state.writes).toHaveLength(1);
    await closeCopy(page);
    await expect(page.locator(".copy-screen")).toHaveCount(0);
    await expect(next).toBeInViewport({ ratio: 1 });
    await next.click(); await expect(page.locator(".copy-preview")).toBeVisible();
    await page.getByRole("button", { name: /^(继续编辑|查看并调整这一周)$/ }).click();
    await expect(page.locator(".copy-screen")).toHaveCount(0);
    await expect(button(page, "确认周菜单")).toBeVisible();
    await expect(page.getByText(/旧消息不会自动更新|自行通知邻居/)).toHaveCount(0);
  });
}

test("复制日期和午晚餐仅提供已安排餐次，每次切换重读保存菜单", async ({ page }) => {
  const state = await openWeek(page);
  const rows = page.locator(".setting-row");
  for (const day of [1, 3, 4, 5, 6]) {
    await rows.nth(day).getByRole("checkbox").first().uncheck();
    await rows.nth(day).getByRole("checkbox").last().uncheck();
  }
  await rows.nth(2).getByRole("checkbox").first().uncheck();
  await generate(page); await confirmWeek(page);
  await button(page, "去复制菜单").click();
  await expect(page.locator(".copy-preview")).toContainText("2026年9月21日（周一）午餐");
  const reads = state.reads;
  state.saved!.meals[1]!.meat[0]!.name = "刚保存的晚餐菜";
  state.saved!.version++;
  await button(page, "晚餐").click();
  await expect(page.locator(".copy-preview")).toContainText("2026年9月21日（周一）晚餐");
  await expect(page.locator(".copy-preview")).toContainText("刚保存的晚餐菜");
  expect(state.reads).toBe(reads + 1);
  state.saved!.meals[5]!.meat[0]!.name = "周三新菜";
  state.saved!.version++;
  const date = page.getByLabel("选择日期");
  await expect(date.locator("option")).toHaveText(["周一 · 2026-09-21", "周三 · 2026-09-23"]);
  await date.selectOption("2");
  await expect(page.locator(".copy-preview")).toContainText("2026年9月23日（周三）晚餐");
  await expect(page.locator(".copy-preview")).toContainText("周三新菜");
  expect(state.reads).toBe(reads + 2);
  await expect(button(page, "午餐")).toHaveCount(0);
  await expect(button(page, "晚餐")).toBeVisible();
  expect(state.writes).toHaveLength(1); expect(state.saved!.version).toBe(3);
});

test("最新快照停餐后移到剩余日期等待重读，整周停餐仍能返回编辑", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  await expect(button(page, "去复制菜单")).toBeVisible();
  state.saved!.meals = state.saved!.meals.map((meal, index) => index === 5 ? meal : {
    ...meal, enabled: false, soupOmitted: false, meat: [], vegetable: [], soup: []
  });
  state.saved!.version++;
  const reads = state.reads;
  await button(page, "去复制菜单").click();
  await expect(page.locator(".copy-screen")).toContainText("这餐已改为不安排，请选择其他餐次后重新预览。");
  await expect(page.getByLabel("选择日期")).toHaveValue("2");
  await expect(page.getByLabel("选择日期").locator("option")).toHaveText(["周三 · 2026-09-23"]);
  await expect(button(page, "午餐")).toHaveCount(0);
  await expect(page.locator(".copy-preview")).toHaveCount(0);
  await expect(button(page, "复制菜单文字")).toHaveCount(0);
  await button(page, "晚餐").click();
  await expect(page.locator(".copy-preview")).toContainText("2026年9月23日（周三）晚餐");
  expect(state.reads).toBe(reads + 2);
  state.saved!.meals[5] = { ...state.saved!.meals[5]!, enabled: false, soupOmitted: false, meat: [], vegetable: [], soup: [] };
  state.saved!.version++;
  await button(page, "晚餐").click();
  await expect(page.locator(".copy-screen")).toContainText("本周没有已安排的餐次，请返回周菜单调整。");
  await expect(page.locator(".copy-preview")).toHaveCount(0);
  await expect(button(page, "复制菜单文字")).toHaveCount(0);
  await page.getByRole("button", { name: /^(继续编辑|查看并调整这一周)$/ }).click();
  await expect(page.locator(".copy-screen")).toHaveCount(0);
  await expect(button(page, "修改周设置")).toBeVisible();
  expect(state.reads).toBe(reads + 3); expect(state.writes).toHaveLength(1);
});

test("两列七天表按选中菜位换菜，导航取消保留调整，重新进入历史刷新", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openWeek(page); await generate(page);
  const carousel = page.locator(".day-carousel"), columns = page.locator(".day-column");
  const dimensions = await carousel.evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth, column: node.firstElementChild!.getBoundingClientRect().width }));
  expect(Math.abs(dimensions.column * 2 + 8 - dimensions.width)).toBeLessThan(2);
  expect(dimensions.scroll).toBeGreaterThan(dimensions.width * 2);
  await columns.last().getByRole("button", { name: "周日晚餐：荤菜2", exact: true }).click();
  await button(page, "自己选").click(); await button(page, "荤菜3").click(); await button(page, "应用这次替换").click();
  await expect(lunch(page)).toContainText("当前选择 · 周日 晚餐 · 荤菜");
  await expect(button(page, "周日晚餐：荤菜3")).toHaveAttribute("aria-pressed", "true");
  await button(page, "换一道").click(); await button(page, "应用这次替换").click();
  await expect(lunch(page)).toContainText("周日 晚餐");
  await button(page, "历史").click(); await page.locator(".taro-model__cancel").click();
  await expect(page.locator(".day-column")).toHaveCount(7);
  await confirmWeek(page);
  await expect(button(page, "去复制菜单")).toBeVisible();
  expect(state.saved!.meals.slice(0, 13)).toEqual(state.generated!.meals.slice(0, 13));
  expect(state.saved!.meals[13]!.meat[0]).toEqual(state.generated!.meals[13]!.meat[0]);
  await button(page, "历史").click();
  await expect(page.locator(".history-app .week-range")).toContainText("已确认");
  await button(page, "排菜单").click(); await page.getByRole("button", { name: /^(继续编辑|查看并调整这一周)$/ }).click();
  await button(page, "保存调整").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  await button(page, "历史").click();
  await expect(page.locator(".history-app .week-range")).toContainText("已保存");
});

test("零荤菜默认全部，停餐仍可选择且不出现替换按钮", async ({ page }) => {
  await openWeek(page);
  await page.locator(".structure-fields input").first().fill("0");
  await page.locator(".setting-row").first().getByRole("checkbox").last().uncheck();
  await generate(page);
  await expect(button(page, "全部")).toHaveAttribute("aria-pressed", "true");
  await button(page, "荤菜").click();
  await expect(page.getByRole("button", { name: "无荤菜 · 查看全部", exact: true })).toHaveCount(13);
  await page.getByRole("button", { name: "无荤菜 · 查看全部", exact: true }).first().click();
  await button(page, "周一晚餐：不安排").click();
  await expect(lunch(page)).toContainText("本餐不安排");
  await expect(button(page, "换一道")).toHaveCount(0);
  await expect(preview(page)).toHaveCount(0);
});

test("每餐20道与60字菜名不撑破两列，完整菜名可在选中区和总览读取", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openWeek(page, false, 10);
  const longName = "家常香菇土豆炖牛肉".repeat(6).slice(0, 60);
  state.items[0]!.name = longName;
  for (const [i, count] of [10, 10, 0].entries()) await page.locator(".structure-fields input").nth(i).fill(String(count));
  await generate(page); await button(page, "全部").click();
  await expect(lunchDishes(page).locator(".dish-cell")).toHaveCount(20);
  await expect(page.locator(".selected-name")).toHaveText(longName);
  const geometry = await page.locator(".week-app").evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  expect(geometry.scroll).toBe(geometry.width);
  await button(page, "确认周菜单").click();
  await expect(page.locator(".readonly-board")).toContainText(longName);
  const fullName = await page.locator(".readonly-board .dish-cell").first().evaluate((node) => ({ height: node.clientHeight, textHeight: node.firstElementChild!.getBoundingClientRect().height }));
  expect(fullName.textHeight).toBeLessThanOrEqual(fullName.height);
  const frame = await page.locator(".flow-scroll").boundingBox(), dock = await page.locator(".flow-dock").boundingBox();
  expect(frame!.y + frame!.height).toBeLessThanOrEqual(dock!.y + 1);
  await button(page, "保存本周菜单").click();
  await expect(button(page, "去复制菜单")).toBeVisible();
  expect(state.saved!.meals[0]!.meat).toHaveLength(10);
  expect(state.saved!.meals[0]!.vegetable).toHaveLength(10);
  await page.getByRole("button", { name: /^(继续编辑|查看并调整这一周)$/ }).click(); await button(page, "全部").click();
  await button(page, "取消编辑").click();
  await expect(button(page, "去复制菜单")).toBeInViewport({ ratio: 1 });
});


test("候选面板打开后切换菜位，不会把新选择写回旧餐次", async ({ page }) => {
  const state = await openWeek(page); await generate(page);
  await button(page, "自己选").click();
  await expect(page.locator(".weekly-menu-board")).toHaveCount(0);
  await button(page, "返回编辑").click();
  await button(page, "周二午餐：荤菜2").click();
  await expect(page.locator(".swap-screen")).toHaveCount(0);
  await button(page, "自己选").click(); await button(page, "荤菜3").click(); await button(page, "应用这次替换").click();
  await button(page, "保存调整").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  expect(state.saved!.meals[0]).toEqual(state.generated!.meals[0]);
  expect(state.saved!.meals[2]!.meat.map((dish) => dish.name)).toEqual(["荤菜1", "荤菜3"]);
});

test("检查页只读且未写入，返回首页或编辑保留草稿，最终保存只有一次PUT", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await replaceLunch(page);
  await button(page, "确认周菜单").click();
  await expect(page.locator(".review-hero")).toContainText("未保存");
  await expect(page.locator(".readonly-board .action-button.dish-cell")).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
  await button(page, "返回编辑").click(); await expect(lunch(page)).toContainText("荤菜3");
  await button(page, "返回本周菜单").click();
  await expect(page.locator(".state-badge")).toHaveText("未保存");
  await button(page, "继续调整菜单").click(); await expect(lunch(page)).toContainText("荤菜3");
  await confirmWeek(page);
  await expect(button(page, "去复制菜单")).toBeVisible();
  expect(state.writes).toHaveLength(1); expect(JSON.parse(state.writes[0]!.body).confirm).toBe(true);
});

test("独立候选搜索与取消不改菜单，应用时重新校验停用或改类菜", async ({ page }) => {
  const state = await openWeek(page); await generate(page);
  await button(page, "换一道").click();
  await expect(page.locator(".swap-heading")).toContainText("周一午餐");
  await expect(page.locator(".weekly-menu-board")).toHaveCount(0);
  await button(page, "返回编辑").click(); await expect(lunch(page)).toContainText("荤菜1");
  for (const category of ["meat", "vegetable"] as const) {
    await button(page, "自己选").click();
    await expect(button(page, "荤菜1")).toHaveCount(0); await expect(button(page, "荤菜2")).toHaveCount(0);
    await page.locator(".candidate-search input").fill("菜3");
    await button(page, "荤菜3").click();
    state.items.find((dish) => dish.name === "荤菜3")!.category = category;
    state.items.find((dish) => dish.name === "荤菜3")!.active = category !== "meat";
    await button(page, "应用这次替换").click();
    await expect(page.locator(".alert")).toContainText("没有其他可用的同类菜");
    await button(page, "返回编辑").click(); await expect(lunch(page)).toContainText("荤菜1");
    state.items.find((dish) => dish.name === "荤菜3")!.category = "meat";
    state.items.find((dish) => dish.name === "荤菜3")!.active = true;
  }
  expect(state.writes).toHaveLength(0);
});

test("历史在本入口切已保存周并分页，失败保留当前周，重入刷新最新", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  await expect(button(page, "去复制菜单")).toBeVisible();
  const weeks = [monday, "2026-09-14", "2026-09-07"].map((weekStart, index) => WeekPlanSchema.parse({ ...state.saved, weekStart, id: id(700 + index),
    meals: state.saved!.meals.map((meal, i) => ({ ...meal, date: new Date(Date.parse(`${weekStart}T00:00:00Z`) + Math.floor(i / 2) * 86400000).toISOString().slice(0, 10) })) }));
  let failOlder = true, pages = 0;
  await page.route("**/api/kith-inn/weeks**", async (route) => {
    const url = new URL(route.request().url());
    const headers = { "access-control-allow-origin": "*" };
    if (route.request().method() !== "GET") return route.fallback();
    if (url.pathname.endsWith("/weeks")) {
      pages++;
      const older = url.searchParams.has("before");
      return route.fulfill({ headers, json: { items: weeks.slice(older ? 2 : 0, older ? 3 : 2).map(({ weekStart, version, confirmedAt, updatedAt }) => ({ weekStart, version, confirmedAt, updatedAt })), nextBefore: older ? null : "2026-09-14" } });
    }
    if (url.pathname.endsWith("2026-09-07") && failOlder) { failOlder = false; return route.fulfill({ status: 503, headers, json: { error: { code: "INTERNAL_ERROR", message: "受控读取失败", requestId: id(999) } } }); }
    return route.fulfill({ headers, json: weeks.find((week) => url.pathname.endsWith(week.weekStart)) });
  });
  await button(page, "历史").click();
  await expect(button(page, "历史")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".history-app .week-range")).toContainText(monday);
  await expect(button(page, "下一保存周")).toBeDisabled();
  await button(page, "上一保存周").click(); await expect(page.locator(".week-range")).toContainText("2026-09-14");
  await button(page, "上一保存周").click(); await expect(page.locator(".alert")).toBeVisible();
  await expect(page.locator(".week-range")).toContainText("2026-09-14");
  await button(page, "上一保存周").click(); await expect(page.locator(".week-range")).toContainText("2026-09-07");
  await expect(button(page, "上一保存周")).toBeDisabled(); expect(pages).toBe(2);
  await button(page, "排菜单").click(); await button(page, "历史").click();
  await expect(page.locator(".history-app .week-range")).toContainText(monday); expect(pages).toBe(3);
});

test("修改周设置后复制不静默覆盖，取消与读取失败保留设置草稿", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  await button(page, "查看并调整这一周").click(); await button(page, "修改周设置").click();
  await page.locator(".structure-fields input").first().fill("3");
  await page.locator(".setting-row").first().getByRole("checkbox").last().uncheck();
  await button(page, "返回本周菜单").click(); const reads = state.reads;
  await button(page, "去复制菜单").click();
  await expect(button(page, "返回周设置")).toBeVisible();
  await expect(button(page, "保存后预览")).toHaveCount(0);
  await expect(page.locator(".copy-preview")).toHaveCount(0); expect(state.reads).toBe(reads);
  await button(page, "放弃修改后预览").click(); await page.locator(".taro-model__cancel").click();
  await button(page, "返回周设置").click();
  await expect(page.locator(".structure-fields input").first()).toHaveValue("3");
  await expect(page.locator(".setting-row").first().getByRole("checkbox").last()).not.toBeChecked();
  await button(page, "返回本周菜单").click(); await button(page, "去复制菜单").click();
  state.failure = "read";
  await button(page, "放弃修改后预览").click(); await page.getByText("放弃修改", { exact: true }).click();
  await expect(page.locator(".copy-screen")).toContainText("读取已保存菜单失败");
  await button(page, "返回周设置").click(); await expect(page.locator(".structure-fields input").first()).toHaveValue("3");
  expect(state.writes).toHaveLength(1); expect(state.saved!.structure.meat).toBe(2);
});

test("编辑检查历史的鼠标与触摸滑动停稳后对齐两天，末尾周末完整可达", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openWeek(page); await generate(page);
  const scroll = page.locator(".day-scroll");
  const aligned = async (last = false) => {
    await expect.poll(() => scroll.evaluate((node, end) => {
      const columns = [...node.querySelectorAll(".day-column")], bounds = node.getBoundingClientRect();
      const pair = end ? columns.slice(-2) : columns.filter((column) => Math.abs(column.getBoundingClientRect().left - bounds.left) < 1).flatMap((column) => [column, column.nextElementSibling!]);
      return pair.length === 2 && Math.abs(pair[0]!.getBoundingClientRect().left - bounds.left) < 1 && Math.abs(pair[1]!.getBoundingClientRect().right - bounds.right) < 1;
    }, last)).toBe(true);
  };
  const drag = async () => { const box = (await scroll.boundingBox())!; await page.mouse.move(box.x + 240, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 130, box.y + 80, { steps: 12 }); await page.mouse.up(); };
  const edge = (await scroll.boundingBox())!;
  await page.mouse.move(edge.x + 2, edge.y + 20); await page.mouse.down(); await page.mouse.move(edge.x - 1, edge.y + 20); await page.mouse.up();
  await page.mouse.move(edge.x + 150, edge.y + 20); await expect(scroll).not.toHaveClass(/dragging/); await aligned();
  await drag(); await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(100); await aligned();
  await expect(button(page, "周一午餐：荤菜1")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "周二午餐：荤菜1")).toHaveAttribute("aria-pressed", "false");
  const cdp = await context.newCDPSession(page); await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const box = (await scroll.boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 240, y: box.y + 20 }] });
  for (let step = 1; step <= 8; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 240 - step * 20, y: box.y + 20 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(250); await aligned();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 200, y: box.y + 20 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 90, y: box.y + 20 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); await aligned();
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }); await cdp.detach();
  const weekend = async () => { await scroll.hover(); await page.mouse.wheel(2500, 0); await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(700); await aligned(true); };
  await weekend(); await button(page, "确认周菜单").click(); await weekend();
  await button(page, "保存本周菜单").click(); await button(page, "历史").click(); await weekend();
  await button(page, "调整这一周").click(); await expect(page.getByText(/旧消息不会自动更新|自行通知邻居/)).toHaveCount(0);
  await button(page, "预览本餐文字").click(); await expect(page.getByText(/微信消息不会自动更新|自行通知邻居/)).toHaveCount(0);
});
