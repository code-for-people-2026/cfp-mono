import { expect, test, type Page } from "@playwright/test";
import { CategorySchema, DishBatchInputSchema, GenerateInputSchema, MenuPreviewSchema, WeekPlanSchema, WeekWriteInputSchema,
  type Dish, type MenuPreview, type WeekPlan } from "@cfp/kith-inn-contracts";

const monday = "2026-09-21", timestamp = "2026-09-21T00:00:00Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const lunch = (page: Page) => page.locator(".meal-block:visible").first();
const lunchDishes = (page: Page) => page.locator(".day-column").first().locator(".meal-cells").first();
const copyText = (page: Page) => page.getByRole("textbox", { name: "接龙说明", exact: true });
const copyExample = (page: Page) => page.getByRole("textbox", { name: "填写示例", exact: true });

// Controlled API transport and stored H5 session, not real WeChat or PostgreSQL evidence.
async function openWeek(page: Page, viaPool = false, dishCount = 4, today = timestamp) {
  await page.clock.setFixedTime(new Date(today));
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
  await button(page, "荤菜3").click(); await button(page, "保存这次替换").click();
}

async function confirmWeek(page: Page) {
  await button(page, "确认菜单").click();
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
const preview = (page: Page) => page.getByRole("button", { name: /^复制(?:午餐|晚餐)菜单$/, exact: true });
async function home(page: Page) {
  if (await page.locator(".copy-screen").count()) await closeCopy(page);
  await expect(page.locator(".main-nav button").first()).toBeEnabled();
  if (await button(page, "返回编辑").count()) await button(page, "返回编辑").click();
  if (await button(page, "返回安排").count()) await button(page, "返回安排").click();
  if (await button(page, "返回本周菜单").count()) await button(page, "返回本周菜单").click();
}
async function enterEdit(page: Page) { await page.getByRole("button", { name: /^(继续调整菜单|查看并调整这一周)$/ }).click(); }
async function openPreview(page: Page) { await home(page); await preview(page).click(); }
async function expandSettings(page: Page) {
  for (const name of ["修改安排餐次", "修改每餐搭配"]) {
    const toggle = button(page, name);
    if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  }
}
async function settings(page: Page) { await home(page); await enterEdit(page); await button(page, "返回安排").click(); await expandSettings(page); }
async function saveDraft(page: Page) {
  await home(page);
  if (await page.getByText("菜单尚未保存", { exact: true }).count()) {
    await enterEdit(page); await confirmWeek(page); await enterEdit(page); return;
  }
  await preview(page).click(); await button(page, "保存后预览").click();
  await expect.poll(async () => await page.locator(".alert").count() + await copyText(page).count()).toBeGreaterThan(0);
  await closeCopy(page); await enterEdit(page);
}

const soupToggle = (page: Page) => page.getByRole("checkbox", { name: "本餐做汤", exact: true });
async function openMondayMeal(page: Page) {
  await home(page); await preview(page).click();
  await page.locator(".copy-screen select").selectOption("0"); await button(page, "午餐").click();
}
const closeCopy = (page: Page) => button(page, "关闭菜单文字").click();

test("从空菜池建立到排周菜单、换菜去汤、保存回看、复制重试及改菜再复制", async ({ page }) => {
  const state = await openWeek(page, true);
  await expandSettings(page); await page.locator(".setting-row").last().getByRole("checkbox").last().uncheck();
  await generate(page);
  expect(state.generated!.meals).toHaveLength(14);
  expect(state.generated!.meals[13]).toMatchObject({ enabled: false, meat: [], vegetable: [], soup: [] });
  await expect(page.locator(".board-title")).toHaveText("7 天 13 餐菜单");
  await expect(button(page, "确认菜单")).toHaveText("确认菜单");
  await replaceLunch(page);
  await confirmWeek(page);
  await expect(page.locator(".week-toolbar .state-badge")).toHaveText("已确认");
  await openMondayMeal(page); await soupToggle(page).click(); await button(page, "保存本餐调整").click();
  await expect(page.getByText("本餐调整已保存", { exact: true })).toBeVisible();
  const saved = state.saved!;
  expect(saved.meals[0]!.meat[0]!.name).toBe("荤菜3");
  expect(saved.meals[0]!.soupOmitted).toBe(true);
  expect(saved.meals.slice(1)).toEqual(state.generated!.meals.slice(1));
  await button(page, "历史").click();
  await expect(page.locator(".history-app")).toBeVisible();
  await expect(lunchDishes(page)).toContainText("荤菜3");
  await expect(lunchDishes(page)).not.toContainText("汤菜1");
  await button(page, "排菜单").click(); await enterEdit(page);
  await expect(button(page, "返回安排")).toBeVisible();
  await expect(page.getByText(/旧消息不会自动更新|自行通知邻居/)).toHaveCount(0);
  const reads = state.reads;
  await openPreview(page);
  await expect(copyText(page)).toHaveValue("9.21号星期一午餐预定接龙（30元）\n1.荤菜3\n2.荤菜2\n3.素菜1\n4.素菜2");
  expect(state.reads).toBe(reads + 1);
  await expect(page.locator(".copy-screen")).toBeVisible();
  await expect(page.locator(".week-plans:visible")).toHaveCount(0);
  await clipboard(page, true); await button(page, "复制接龙说明").click();
  await expect(page.getByText("复制失败，文字已保留，请重试复制。", { exact: true })).toBeVisible();
  const text = await copyText(page).inputValue();
  await clipboard(page); await button(page, "复制接龙说明").click();
  await expect(button(page, "复制接龙说明")).toHaveText("✓ 已复制");
  expect(await page.locator("html").getAttribute("data-copied")).toBe(text);
  expect(state.saved).toEqual(saved); expect(state.writes).toHaveLength(2);
  await closeCopy(page);
  await expect(preview(page)).toBeEnabled();
  await page.getByRole("button", { name: /^(继续编辑|查看并调整这一周)$/ }).click();
  await button(page, "周一午餐：荤菜3").click();
  await button(page, "自己选").click();
  await button(page, "荤菜4").click(); await button(page, "保存这次替换").click(); await openPreview(page);
  await button(page, "保存后预览").click();
  await expect(copyText(page)).toHaveValue(/荤菜4/);
  await button(page, "复制接龙说明").click();
  await expect(page.locator("html")).toHaveAttribute("data-copied", /荤菜4/);
  expect(state.writes).toHaveLength(3);
  await closeCopy(page);
  await page.getByRole("button", { name: "查看并调整这一周", exact: true }).click();
  await expect(page.locator(".day-column").last().locator(".meal-cells").last()).toContainText("不安排");
});

test("修改结构取消与缺菜失败都保留换菜去汤草稿", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  await openMondayMeal(page); await soupToggle(page).click(); await button(page, "保存本餐调整").click();
  await expect(page.getByText("本餐调整已保存", { exact: true })).toBeVisible();
  await home(page); await enterEdit(page); await replaceLunch(page); await button(page, "全部").click();
  await expect(lunchDishes(page)).toContainText("本餐不做汤");
  await button(page, "周一午餐：本餐不做汤").click();
  await expect(page.locator(".selected-name")).toHaveText("本餐不做汤");
  await expect(lunch(page).getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /去掉本餐汤|恢复本餐汤/ })).toHaveCount(0);
  await expect(soupToggle(page)).toHaveCount(0);

  await settings(page);
  await expandSettings(page); await page.locator(".structure-fields input").first().fill("3");
  await button(page, "重新生成菜单").click();
  await page.getByText("取消", { exact: true }).click();
  expect(state.generations).toBe(1);

  state.failure = "shortage";
  await button(page, "重新生成菜单").click();
  await page.getByText("确认重排", { exact: true }).click();
  await expect(page.locator(".alert")).toContainText("荤需3道，现有1道");

  await button(page, "取消修改，继续调整").click();
  await saveDraft(page);
  await expect(button(page, "确认菜单")).toBeVisible();
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
  await expect(page.locator(".week-toolbar .state-badge")).toHaveText("已确认");
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1]).toEqual(state.writes[0]);
  expect(state.saved!.version).toBe(1);
});

test("409冲突保留草稿，读取只供核对，明确确认后载入服务器内容", async ({ page }) => {
  const state = await openWeek(page); await generate(page);
  await saveDraft(page);
  await expect(button(page, "确认菜单")).toBeVisible();
  await replaceLunch(page);
  state.saved = { ...state.saved!, version: 2 };
  state.failure = "conflict";
  await saveDraft(page);
  await expect(button(page, "读取服务器菜单核对")).toBeVisible();
  await expect(lunch(page)).toContainText("荤菜3");
  await expect(button(page, "确认菜单")).toBeDisabled();
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
  await expandSettings(page); await page.locator(".structure-fields input").last().fill("2");
  await generate(page);
  await saveDraft(page);
  await expect(button(page, "确认菜单")).toBeVisible();
  await openMondayMeal(page); await soupToggle(page).click();
  state.items.find((dish) => dish.name === "汤菜1")!.active = false;
  await soupToggle(page).click();
  await expect(page.getByText("重新选齐 2 道汤", { exact: true })).toBeVisible();
  await page.locator(".candidate-sheet").getByRole("button", { name: "取消", exact: true }).click();
  await expect(copyText(page)).not.toHaveValue(/汤菜2/);
  await soupToggle(page).click();
  await button(page, "汤菜2").click();
  await expect(button(page, "选齐并恢复汤")).toBeDisabled();
  await button(page, "汤菜3").click();
  await button(page, "选齐并恢复汤").click();
  await expect(copyText(page)).toHaveValue(/汤菜2/);
  await expect(copyText(page)).toHaveValue(/汤菜3/);
  await button(page, "保存本餐调整").click();
  await expect(page.getByText("本餐调整已保存", { exact: true })).toBeVisible();
  expect(state.saved!.meals[0]).toMatchObject({ soupOmitted: false, soup: [{ name: "汤菜2" }, { name: "汤菜3" }] });
  expect(state.saved!.meals.slice(1)).toEqual(state.generated!.meals.slice(1));
});


test("无本地修改仍重新读保存快照，读取异常不提供旧文字，重试后获取新版本", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await saveDraft(page);
  await expect(button(page, "确认菜单")).toBeVisible();
  state.saved!.meals[0]!.meat[0]!.name = "另一会话保存的菜";
  state.saved!.version++;
  for (const failure of ["", "read", "invalid"]) {
    state.failure = failure; const reads = state.reads;
    await openPreview(page);
    if (failure) {
      await expect(page.locator(".copy-screen")).toContainText("读取已保存菜单失败");
      await expect(copyText(page)).toHaveCount(0);
      await expect(button(page, "复制接龙说明")).toHaveCount(0);
      await button(page, "重新读取本餐文字").click();
    }
    await expect(copyText(page)).toHaveValue(/另一会话保存的菜/);
    expect(state.reads).toBe(reads + (failure ? 2 : 1));
    await closeCopy(page);
  }
  expect(state.writes).toHaveLength(1); expect(state.saved!.version).toBe(2);
});

test("未保存复制须保存或明确放弃，取消和读取失败保留草稿", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await saveDraft(page);
  await expect(button(page, "确认菜单")).toBeVisible();
  await replaceLunch(page); const reads = state.reads;
  await openPreview(page);
  await expect(button(page, "保存后预览")).toBeVisible(); expect(state.reads).toBe(reads);
  await button(page, "晚餐").click(); await button(page, "午餐").click();
  expect(state.reads).toBe(reads); await expect(copyText(page)).toHaveCount(0);
  await button(page, "历史").click(); await page.getByText("继续编辑", { exact: true }).click();
  await expect(page.locator(".copy-screen")).toBeVisible(); expect(state.writes).toHaveLength(1);
  await button(page, "放弃修改后预览").click(); await page.locator(".taro-model__cancel").filter({ hasText: /^继续编辑$/ }).click();
  expect(state.reads).toBe(reads);
  await closeCopy(page); await enterEdit(page); await expect(lunch(page)).toContainText("荤菜3"); await openPreview(page);
  state.failure = "read";
  await button(page, "放弃修改后预览").click(); await page.getByText("放弃修改", { exact: true }).click();
  await expect(page.locator(".copy-screen")).toContainText("读取已保存菜单失败");
  await expect(button(page, "复制接龙说明")).toHaveCount(0);
  await closeCopy(page); await enterEdit(page); await expect(lunch(page)).toContainText("荤菜3"); await openPreview(page);
  await button(page, "放弃修改后预览").click(); await page.getByText("放弃修改", { exact: true }).click();
  await expect(copyText(page)).toHaveValue(/荤菜1/);
  await expect(copyText(page)).not.toHaveValue(/荤菜3/); expect(state.writes).toHaveLength(1);
});

test("保存后预览响应丢失不复制草稿，原请求重试成功后才重新读取", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  await enterEdit(page); await replaceLunch(page); await openPreview(page);
  state.failure = "lost"; await button(page, "保存后预览").click();
  await expect(button(page, "重试原保存请求")).toBeVisible();
  await expect(button(page, "历史")).toBeDisabled();
  await expect(button(page, "复制接龙说明")).toHaveCount(0);
  await closeCopy(page); await expect(button(page, "继续调整菜单")).toBeDisabled();
  await button(page, "重试原保存请求").click();
  await expect(page.getByText("菜单已保存，可继续调整或确认", { exact: true })).toBeVisible();
  await openPreview(page); await expect(copyText(page)).toHaveValue(/荤菜3/);
  expect(state.writes).toHaveLength(3); expect(state.writes[1]).toEqual(state.writes[2]);
  expect(state.saved!.version).toBe(2);
});

test("接龙说明与填写示例独立编辑复制，未复制修改互不丢失且不写菜单", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page); await openPreview(page);
  const saved = structuredClone(state.saved), writes = state.writes.length;
  const original = await copyText(page).inputValue();
  await expect(copyExample(page)).toHaveValue("1份午餐");
  await copyText(page).fill(" \n ");
  await expect(copyText(page)).toBeVisible();
  await expect(copyText(page)).toHaveValue(" \n ");
  await expect(button(page, "复制接龙说明")).toBeDisabled();
  await expect(button(page, "复制示例")).toBeEnabled();

  const edited = original.replace("30元", "35元").replace("荤菜1", "香煎鸡翅") + "\n取餐请自备餐盒";
  await copyText(page).fill(edited);
  await copyExample(page).fill("   ");
  await expect(copyExample(page)).toHaveValue("   ");
  await expect(button(page, "复制示例")).toBeDisabled();
  await expect(button(page, "复制接龙说明")).toBeEnabled();
  const example = "邻居姓名   2份午餐（自取）";
  await copyExample(page).fill(example);
  // Every route away from a modified template must give the user a chance to keep it.
  for (const leave of [
    () => button(page, "晚餐").click(),
    () => page.locator(".copy-screen select").selectOption("1"),
    () => closeCopy(page),
    () => button(page, "历史").click(),
    () => soupToggle(page).click(),
  ]) {
    await leave();
    await expect(page.getByText("放弃文案修改？", { exact: true })).toBeVisible();
    await page.locator(".taro-model__cancel").filter({ hasText: /^继续编辑$/ }).click();
    await expect(copyText(page)).toHaveValue(edited);
    await expect(copyExample(page)).toHaveValue(example);
    await expect(button(page, "午餐")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".copy-screen select")).toHaveValue("0");
    await expect(soupToggle(page)).toBeChecked();
  }

  await button(page, "晚餐").click();
  await page.locator(".taro-model__confirm").filter({ hasText: /^放弃修改$/ }).click();
  await expect(copyText(page)).toHaveValue(original.replace("星期一午餐预定", "星期一晚餐预定"));
  await expect(copyExample(page)).toHaveValue("1份晚餐");
  const dinnerText = edited.replace("星期一午餐预定", "星期一晚餐预定");
  const dinnerExample = example.replace("午餐", "晚餐");
  await copyText(page).fill(dinnerText);
  await copyExample(page).fill(dinnerExample);
  await clipboard(page, true); await button(page, "复制接龙说明").click();
  await expect(page.getByText("复制失败，文字已保留，请重试复制。", { exact: true })).toBeVisible();
  await expect(copyText(page)).toHaveValue(dinnerText);
  await expect(copyExample(page)).toHaveValue(dinnerExample);
  await clipboard(page); await button(page, "复制接龙说明").click();
  await expect(button(page, "复制接龙说明")).toHaveText("✓ 已复制");
  await expect(page.locator("html")).toHaveAttribute("data-copied", dinnerText);
  await expect(page.getByText("已复制，粘贴到微信接龙的说明栏", { exact: true })).toBeVisible();

  // Copying the description acknowledges only that field; the example still needs protection.
  await closeCopy(page);
  await expect(page.getByText("放弃文案修改？", { exact: true })).toBeVisible();
  await page.locator(".taro-model__cancel").click();
  await expect(copyExample(page)).toHaveValue(dinnerExample);
  await clipboard(page, true); await button(page, "复制示例").click();
  await expect(page.getByText("复制失败，文字已保留，请重试复制。", { exact: true })).toBeVisible();
  await expect(copyExample(page)).toHaveValue(dinnerExample);
  await clipboard(page); await button(page, "复制示例").click();
  await expect(button(page, "复制示例")).toHaveText("✓ 已复制");
  await expect(page.locator("html")).toHaveAttribute("data-copied", dinnerExample);
  await expect(page.getByText("已复制，粘贴到微信接龙的示例栏", { exact: true })).toBeVisible();
  await expect(copyText(page)).toHaveValue(dinnerText);

  // Copying an example again must not acknowledge a newer edit to the description.
  const revisedText = dinnerText + "\n晚上六点取餐";
  await copyText(page).fill(revisedText);
  await button(page, "复制示例").click();
  await expect(page.locator("html")).toHaveAttribute("data-copied", dinnerExample);
  await closeCopy(page);
  await expect(page.getByText("放弃文案修改？", { exact: true })).toBeVisible();
  await page.locator(".taro-model__cancel").click();
  await expect(copyText(page)).toHaveValue(revisedText);
  await expect(copyExample(page)).toHaveValue(dinnerExample);
  await button(page, "复制接龙说明").click();
  await expect(page.locator("html")).toHaveAttribute("data-copied", revisedText);
  await closeCopy(page);
  await expect(page.locator(".copy-screen")).toHaveCount(0);
  await expect(page.locator(".taro-model:visible")).toHaveCount(0);
  expect(state.saved).toEqual(saved); expect(state.writes).toHaveLength(writes);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`确认后可见下一步、独立复制并返回编辑 ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = await openWeek(page); await generate(page);
    await confirmWeek(page);
    await expect(page.locator(".week-toolbar .state-badge")).toHaveText("已确认");
    const next = preview(page);
    // No scroll or click before this assertion: confirming must reveal the next action.
    await expect(next).toBeInViewport({ ratio: 1 });
    await expect(next).toHaveClass(/primary/);
    const reads = state.reads, saved = JSON.stringify(state.saved);
    await next.click();
    await expect(page.locator(".copy-screen")).toBeVisible();
    await expect(page.locator(".app-heading")).toHaveText("复制菜单");
    await expect(button(page, "继续编辑")).toHaveCount(0);
    await expect(page.locator(".main-nav")).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".main-nav button")).toHaveText(["排菜单", "菜品池", "历史"]);
    await page.screenshot({ path: testInfo.outputPath("copy-navigation.png") });
    await expect(page.locator(".week-plans:visible")).toHaveCount(0);
    await expect(copyText(page)).toHaveValue(/9\.21号星期一午餐预定接龙（30元）/);
    expect(state.reads).toBe(reads + 1);
    await expect(button(page, "复制接龙说明")).toBeInViewport({ ratio: 1 });
    await clipboard(page); await button(page, "复制接龙说明").click();
    await expect(button(page, "复制接龙说明")).toHaveText("✓ 已复制");
    await expect(page.getByText("已复制，请到微信粘贴发送", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("copy-success-button.png") });
    await expect(button(page, "复制接龙说明")).toHaveText("复制接龙说明", { timeout: 4000 });
    expect(JSON.stringify(state.saved)).toBe(saved); expect(state.writes).toHaveLength(1);
    await closeCopy(page);
    await expect(page.locator(".copy-screen")).toHaveCount(0);
    await expect(next).toBeInViewport({ ratio: 1 });
    await next.click(); await expect(copyText(page)).toBeVisible();
    await closeCopy(page);
    await page.getByRole("button", { name: /^(继续编辑|查看并调整这一周)$/ }).click();
    await expect(page.locator(".copy-screen")).toHaveCount(0);
    await expect(button(page, "确认菜单")).toBeVisible();
    await expect(page.getByText(/旧消息不会自动更新|自行通知邻居/)).toHaveCount(0);
  });
}

test("首页预览默认今天午餐，切换晚餐保持复制目标，历史日期不误标今天", async ({ page }) => {
  const state = await openWeek(page, false, 4, "2026-09-23T08:00:00Z"); await generate(page); await confirmWeek(page);
  state.saved!.structure.vegetable = 0;
  state.saved!.meals.forEach((meal) => { meal.vegetable = []; });
  state.saved!.meals[4]!.meat[0]!.name = "周三午餐菜";
  state.saved!.meals[5]!.meat[0]!.name = "周三晚餐菜";
  state.saved!.meals[5]!.soupOmitted = true;
  await page.reload();
  const card = page.locator(".home-meal-card"), dishes = card.locator(".home-meal-dishes");
  await expect(card.getByLabel("选择日期")).toHaveValue("2");
  await expect(card.locator("option:checked")).toHaveText("今天 · 9月23日 周三");
  await expect(card.getByRole("button", { name: "午餐", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dishes).toContainText("周三午餐菜"); await expect(dishes).toContainText("汤菜1");
  await expect(dishes.locator(".home-meal-category")).toHaveText(["荤", "汤"]);
  await expect(button(page, "复制午餐菜单")).toBeVisible();
  await expect(page.locator(".plan-state, .rule-card")).toHaveCount(0);
  await expect(button(page, "去复制菜单")).toHaveCount(0);
  await card.getByRole("button", { name: "晚餐", exact: true }).click();
  await expect(dishes).toContainText("周三晚餐菜"); await expect(dishes).not.toContainText("周三午餐菜");
  await expect(dishes).toContainText("本餐不做汤"); await expect(dishes).not.toContainText("汤菜1");
  await button(page, "复制晚餐菜单").click();
  await expect(copyText(page)).toHaveValue(/9\.23号星期三晚餐预定接龙（30元）/);
  await expect(copyText(page)).toHaveValue(/周三晚餐菜/);
  await expect(copyText(page)).not.toHaveValue(/汤菜1/);
  await closeCopy(page); await expect(button(page, "复制晚餐菜单")).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-10-05T08:00:00Z")); await page.reload();
  await expect(card.getByLabel("选择日期")).toHaveValue("0");
  await expect(card.locator("option:checked")).toHaveText("9月21日 周一");
  await expect(card).not.toContainText("今天");
  expect(state.writes).toHaveLength(1);
});

test("复制日期和午晚餐仅提供已安排餐次，每次切换重读保存菜单", async ({ page }) => {
  const state = await openWeek(page);
  await expandSettings(page); const rows = page.locator(".setting-row");
  for (const day of [1, 3, 4, 5, 6]) {
    await rows.nth(day).getByRole("checkbox").first().uncheck();
    await rows.nth(day).getByRole("checkbox").last().uncheck();
  }
  await rows.nth(2).getByRole("checkbox").first().uncheck();
  await generate(page); await confirmWeek(page);
  await preview(page).click();
  await expect(copyText(page)).toHaveValue(/9\.21号星期一午餐预定接龙（30元）/);
  const reads = state.reads;
  state.saved!.meals[1]!.meat[0]!.name = "刚保存的晚餐菜";
  state.saved!.version++;
  await button(page, "晚餐").click();
  await expect(copyText(page)).toHaveValue(/9\.21号星期一晚餐预定接龙（30元）/);
  await expect(copyText(page)).toHaveValue(/刚保存的晚餐菜/);
  expect(state.reads).toBe(reads + 1);
  state.saved!.meals[5]!.meat[0]!.name = "周三新菜";
  state.saved!.version++;
  const date = page.getByLabel("选择日期");
  await expect(date.locator("option")).toHaveText(["周一 · 2026-09-21", "周三 · 2026-09-23"]);
  await date.selectOption("2");
  await expect(copyText(page)).toHaveValue(/9\.23号星期三晚餐预定接龙（30元）/);
  await expect(copyText(page)).toHaveValue(/周三新菜/);
  expect(state.reads).toBe(reads + 2);
  await expect(button(page, "午餐")).toHaveCount(0);
  await expect(button(page, "晚餐")).toBeVisible();
  expect(state.writes).toHaveLength(1); expect(state.saved!.version).toBe(3);
});

test("最新快照停餐后移到剩余日期等待重读，整周停餐仍能返回编辑", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  await expect(preview(page)).toBeVisible();
  state.saved!.meals = state.saved!.meals.map((meal, index) => index === 5 ? meal : {
    ...meal, enabled: false, soupOmitted: false, meat: [], vegetable: [], soup: []
  });
  state.saved!.version++;
  const reads = state.reads;
  await preview(page).click();
  await expect(page.locator(".copy-screen")).toContainText("这餐已改为不安排，请选择其他餐次后重新预览。");
  await expect(page.getByLabel("选择日期")).toHaveValue("2");
  await expect(page.getByLabel("选择日期").locator("option")).toHaveText(["周三 · 2026-09-23"]);
  await expect(button(page, "午餐")).toHaveCount(0);
  await expect(copyText(page)).toHaveCount(0);
  await expect(button(page, "复制接龙说明")).toHaveCount(0);
  await button(page, "晚餐").click();
  await expect(copyText(page)).toHaveValue(/9\.23号星期三晚餐预定接龙（30元）/);
  expect(state.reads).toBe(reads + 2);
  state.saved!.meals[5] = { ...state.saved!.meals[5]!, enabled: false, soupOmitted: false, meat: [], vegetable: [], soup: [] };
  state.saved!.version++;
  await button(page, "晚餐").click();
  await expect(page.locator(".copy-screen")).toContainText("本周没有已安排的餐次，请返回周菜单调整。");
  await expect(copyText(page)).toHaveCount(0);
  await expect(button(page, "复制接龙说明")).toHaveCount(0);
  await closeCopy(page);
  await page.getByRole("button", { name: /^(继续编辑|查看并调整这一周)$/ }).click();
  await expect(page.locator(".copy-screen")).toHaveCount(0);
  await expect(button(page, "返回安排")).toBeVisible();
  expect(state.reads).toBe(reads + 3); expect(state.writes).toHaveLength(1);
});

test("两天半七天表按选中菜位换菜，导航取消保留调整，重新进入历史刷新", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openWeek(page); await generate(page);
  await expect(page.locator(".selected-dish button")).toHaveText(["换一道", "自己选"]);
  await expect(page.locator(".selection-label")).toHaveText("周一午饭 · 荤菜");
  await expect(page.locator(".board-date")).toHaveText("9月21日—27日");
  await expect(page.getByRole("button", { name: /预览本餐文字|保存调整|修改周设置|取消编辑|去掉本餐汤/ })).toHaveCount(0);
  await expect(button(page, "确认菜单")).toHaveText("确认菜单");
  await expect(button(page, "确认菜单").locator("img")).toHaveCount(0);
  const card = (await page.locator(".selected-dish").boundingBox())!, dock = (await page.locator(".flow-dock").boundingBox())!;
  expect(card.height).toBeGreaterThanOrEqual(95); expect(card.height).toBeLessThanOrEqual(98);
  expect(dock.height).toBe(72); expect(card.y + card.height).toBeLessThan(dock.y);
  const scrollbar = await page.locator(".day-scroll").evaluate((node) => node.getBoundingClientRect().height - node.firstElementChild!.getBoundingClientRect().height);
  expect(scrollbar).toBeLessThan(1);
  const carousel = page.locator(".day-carousel"), columns = page.locator(".day-column");
  const dimensions = await carousel.evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth, column: node.firstElementChild!.getBoundingClientRect().width }));
  expect(Math.abs(dimensions.column * 2.5 + 16 - dimensions.width)).toBeLessThan(2);
  expect(dimensions.scroll).toBeGreaterThan(dimensions.width * 2);
  await columns.last().getByRole("button", { name: "周日晚餐：荤菜2", exact: true }).click();
  await button(page, "自己选").click(); await button(page, "荤菜3").click(); await button(page, "保存这次替换").click();
  await expect(lunch(page)).toContainText("周日晚饭 · 荤菜");
  await expect(button(page, "周日晚餐：荤菜3")).toHaveAttribute("aria-pressed", "true");
  await button(page, "换一道").click(); await button(page, "保存这次替换").click();
  await expect(lunch(page)).toContainText("周日晚饭");
  await button(page, "历史").click(); await page.locator(".taro-model__cancel").click();
  await expect(page.locator(".day-column")).toHaveCount(7);
  await confirmWeek(page);
  await expect(preview(page)).toBeVisible();
  expect(state.saved!.meals.slice(0, 13)).toEqual(state.generated!.meals.slice(0, 13));
  expect(state.saved!.meals[13]!.meat[0]).toEqual(state.generated!.meals[13]!.meat[0]);
  await button(page, "历史").click();
  await expect(page.locator(".history-app .week-range")).toHaveText("9月21日—27日");
  await button(page, "排菜单").click(); await page.getByRole("button", { name: /^(继续编辑|查看并调整这一周)$/ }).click();
  await replaceLunch(page); await saveDraft(page);
  await expect(button(page, "确认菜单")).toBeVisible();
  await button(page, "历史").click();
  await expect(page.locator(".history-app .week-range")).toHaveText("9月21日—27日");
});

test("拖动日期松手后逐帧平滑吸附，再次拖动可接管且不误选", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWeek(page); await generate(page);
  const scroll = page.locator(".day-scroll"), box = (await scroll.boundingBox())!;
  const step = await scroll.evaluate((node) => {
    const columns = node.querySelectorAll(".day-column");
    return columns[1]!.getBoundingClientRect().left - columns[0]!.getBoundingClientRect().left;
  });
  const x = box.x + box.width - 24, y = box.y + 65, distance = step * 0.55;
  const drag = async () => {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - distance, y, { steps: 8 });
  };
  await drag();
  const releasedAt = await scroll.evaluate((node) => node.scrollLeft);
  expect(Math.abs(releasedAt - step)).toBeGreaterThan(20);
  const samples = await scroll.evaluateHandle((node) => {
    const frames = [node.scrollLeft]; let stopped = false;
    const sample = () => { frames.push(node.scrollLeft); if (!stopped) requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
    return { frames, stop: () => { stopped = true; return frames; } };
  });
  await page.mouse.up();
  await expect.poll(() => scroll.evaluate((node, target) => Math.abs(node.scrollLeft - target), step)).toBeLessThan(1);
  const frames = await samples.evaluate((trace) => trace.stop()); await samples.dispose();
  const intermediate = new Set(frames.filter((left) => left > releasedAt + 1 && left < step - 1).map(Math.round));
  expect(intermediate.size, `松手位置 ${releasedAt}，目标 ${step}，逐帧位置 ${frames.join(",")}`).toBeGreaterThanOrEqual(3);
  expect(Math.max(...frames.slice(1).map((left, index) => Math.abs(left - frames[index]!)))).toBeLessThan((step - releasedAt) * 0.9);

  await drag();
  const beforeSecondRelease = await scroll.evaluate((node) => node.scrollLeft);
  const takeover = await scroll.evaluateHandle((node) => {
    const state = { down: -1 };
    node.addEventListener("pointerdown", () => { state.down = node.scrollLeft; }, { capture: true, once: true });
    return state;
  });
  await page.mouse.up(); await page.mouse.down();
  const grabbedAt = await takeover.evaluate((state) => state.down); await takeover.dispose();
  expect(grabbedAt).toBeGreaterThanOrEqual(beforeSecondRelease - 1);
  expect(grabbedAt).toBeLessThan(step * 2 - 1);
  await page.mouse.move(x - distance + step * 0.3, y, { steps: 2 });
  await expect.poll(() => scroll.evaluate((node, target) => Math.abs(node.scrollLeft - target), grabbedAt - step * 0.3)).toBeLessThan(2);
  await page.mouse.up();
  const takeoverTarget = Math.round((grabbedAt - step * 0.3) / step) * step;
  await expect.poll(() => scroll.evaluate((node, target) => Math.abs(node.scrollLeft - target), takeoverTarget)).toBeLessThan(1);
  await expect(page.locator(".selection-label")).toHaveText("周一午饭 · 荤菜");
  await expect(button(page, "周一午餐：荤菜1")).toHaveAttribute("aria-pressed", "true");
});

test("横向滚到周末后选菜和切换筛选保持当前日期位置", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWeek(page); await generate(page);
  const scroll = page.locator(".day-scroll");
  await scroll.hover(); await page.mouse.wheel(2500, 0);
  await expect.poll(() => scroll.evaluate((node) => Math.abs(node.scrollWidth - node.clientWidth - node.scrollLeft))).toBeLessThan(1);
  const position = await scroll.evaluate((node) => node.scrollLeft);
  expect(position).toBeGreaterThan(0);
  const preserved = async () => {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(() => scroll.evaluate((node, left) => Math.abs(node.scrollLeft - left), position)).toBeLessThan(1);
  };
  await button(page, "周六午餐：荤菜1").click();
  await expect(page.locator(".selection-label")).toHaveText("周六午饭 · 荤菜");
  await expect(page.locator(".selected-name")).toHaveText("荤菜1");
  await preserved();
  await button(page, "全部").click(); await expect(button(page, "全部")).toHaveAttribute("aria-pressed", "true");
  await preserved();
  await button(page, "周日午餐：荤菜2").click();
  await expect(page.locator(".selection-label")).toHaveText("周日午饭 · 荤菜");
  await expect(page.locator(".selected-name")).toHaveText("荤菜2");
  await preserved();
});

test("零荤菜默认全部，停餐仍可选择且不出现替换按钮", async ({ page }) => {
  const state = await openWeek(page);
  await expandSettings(page); await page.locator(".structure-fields input").first().fill("0");
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
  await confirmWeek(page); await button(page, "历史").click();
  await expect(button(page, "全部")).toHaveAttribute("aria-pressed", "true");
  await expect(lunchDishes(page).locator(".dish-cell")).toHaveCount(3);
  await button(page, "荤菜").click();
  await expect(page.getByRole("button", { name: "无荤菜 · 查看全部", exact: true })).toHaveCount(13);
  await expect(button(page, "周一晚餐：不安排")).toBeDisabled();
  await page.getByRole("button", { name: "无荤菜 · 查看全部", exact: true }).first().click();
  await expect(button(page, "全部")).toHaveAttribute("aria-pressed", "true");
  await expect(lunchDishes(page).locator(".dish-cell")).toHaveCount(3);
  expect(state.writes).toHaveLength(1);
});

test("每餐20道与60字菜名不撑破两天半，完整菜名可在选中区和总览读取", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openWeek(page, false, 10);
  const longName = "家常香菇土豆炖牛肉".repeat(6).slice(0, 60);
  state.items[0]!.name = longName;
  await expandSettings(page);
  for (const [i, count] of [10, 10, 0].entries()) await page.locator(".structure-fields input").nth(i).fill(String(count));
  await generate(page); await button(page, "全部").click();
  await expect(lunchDishes(page).locator(".dish-cell")).toHaveCount(20);
  await expect(page.locator(".selected-name")).toHaveText(longName);
  const geometry = await page.locator(".week-app").evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  expect(geometry.scroll).toBe(geometry.width);
  await button(page, "确认菜单").click();
  await expect(page.locator(".readonly-board")).toContainText(longName);
  const fullName = await page.locator(".readonly-board .dish-cell").first().evaluate((node) => ({ height: node.clientHeight, textHeight: node.firstElementChild!.getBoundingClientRect().height }));
  expect(fullName.textHeight).toBeLessThanOrEqual(fullName.height);
  const frame = await page.locator(".flow-scroll").boundingBox(), dock = await page.locator(".flow-dock").boundingBox();
  expect(frame!.y + frame!.height).toBeLessThanOrEqual(dock!.y + 1);
  await button(page, "保存本周菜单").click();
  await expect(preview(page)).toBeVisible();
  expect(state.saved!.meals[0]!.meat).toHaveLength(10);
  expect(state.saved!.meals[0]!.vegetable).toHaveLength(10);
  await page.getByRole("button", { name: /^(继续编辑|查看并调整这一周)$/ }).click(); await button(page, "全部").click();
  await home(page);
  await expect(preview(page)).toBeInViewport({ ratio: 1 });
});


test("候选面板打开后切换菜位，不会把新选择写回旧餐次", async ({ page }) => {
  const state = await openWeek(page); await generate(page);
  await button(page, "自己选").click();
  await expect(page.locator(".weekly-menu-board")).toHaveCount(0);
  await button(page, "返回编辑").click();
  await button(page, "周二午餐：荤菜2").click();
  await expect(page.locator(".swap-screen")).toHaveCount(0);
  await button(page, "自己选").click(); await button(page, "荤菜3").click(); await button(page, "保存这次替换").click();
  await saveDraft(page);
  await expect(button(page, "确认菜单")).toBeVisible();
  expect(state.saved!.meals[0]).toEqual(state.generated!.meals[0]);
  expect(state.saved!.meals[2]!.meat.map((dish) => dish.name)).toEqual(["荤菜1", "荤菜3"]);
});

test("检查页只读且未写入，返回首页或编辑保留草稿，最终保存只有一次PUT", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await replaceLunch(page);
  await button(page, "确认菜单").click();
  await expect(page.locator(".review-hero")).toContainText("确认后保存本周菜单");
  await expect(page.locator(".readonly-board .action-button.dish-cell")).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
  await button(page, "返回编辑").click(); await expect(lunch(page)).toContainText("荤菜3");
  await home(page);
  await expect(page.locator(".state-badge")).toHaveText("未保存");
  await button(page, "继续调整菜单").click(); await expect(lunch(page)).toContainText("荤菜3");
  await confirmWeek(page);
  await expect(preview(page)).toBeVisible();
  expect(state.writes).toHaveLength(1); expect(JSON.parse(state.writes[0]!.body).confirm).toBe(true);
});

test("独立候选搜索与取消不改菜单，应用时重新校验停用或改类菜", async ({ page }) => {
  const state = await openWeek(page); await generate(page);
  await button(page, "换一道").click();
  await expect(page.locator(".swap-heading")).toContainText("只换这一道");
  await expect(page.locator(".swap-name")).toHaveText("荤菜1");
  await expect(page.locator(".weekly-menu-board")).toHaveCount(0);
  await button(page, "返回编辑").click(); await expect(lunch(page)).toContainText("荤菜1");
  for (const category of ["meat", "vegetable"] as const) {
    await button(page, "自己选").click();
    await expect(button(page, "荤菜1")).toHaveCount(0); await expect(button(page, "荤菜2")).toHaveCount(0);
    await page.locator(".candidate-search input").fill("菜3");
    await button(page, "荤菜3").click();
    state.items.find((dish) => dish.name === "荤菜3")!.category = category;
    state.items.find((dish) => dish.name === "荤菜3")!.active = category !== "meat";
    await button(page, "保存这次替换").click();
    await expect(page.locator(".alert")).toContainText("没有其他可用的同类菜");
    await button(page, "返回编辑").click(); await expect(lunch(page)).toContainText("荤菜1");
    state.items.find((dish) => dish.name === "荤菜3")!.category = "meat";
    state.items.find((dish) => dish.name === "荤菜3")!.active = true;
  }
  expect(state.writes).toHaveLength(0);
});

test("历史在本入口切已保存周并分页，失败保留当前周，重入刷新最新", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  await expect(preview(page)).toBeVisible();
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
  await expect(page.locator(".history-app .week-range")).toContainText("9月21日—27日");
  await expect(button(page, "下一保存周")).toBeDisabled();
  await button(page, "上一保存周").click(); await expect(page.locator(".week-range")).toContainText("9月14日—20日");
  await button(page, "上一保存周").click(); await expect(page.locator(".alert")).toBeVisible();
  await expect(page.locator(".week-range")).toContainText("9月14日—20日");
  await button(page, "上一保存周").click(); await expect(page.locator(".week-range")).toContainText("9月7日—13日");
  await expect(button(page, "上一保存周")).toBeDisabled(); expect(pages).toBe(2);
  await button(page, "排菜单").click(); await button(page, "历史").click();
  await expect(page.locator(".history-app .week-range")).toContainText("9月21日—27日"); expect(pages).toBe(3);
});

test("返回安排可无损继续，改回原值不重生成，取消重排保留换菜", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  await enterEdit(page); await replaceLunch(page);
  await expect(page.locator(".flow-heading")).toContainText("调整菜单");
  await expect(page.getByRole("button", { name: /周设置|修改餐次和菜量/ })).toHaveCount(0);
  await expect(page.locator(".flow-heading").getByRole("button", { name: "返回安排", exact: true })).toBeVisible();
  await button(page, "返回安排").click();
  await expect(page.locator(".flow-heading")).toContainText("安排本周菜单");
  await expect(button(page, "继续调整菜单")).toBeVisible();
  await expect(button(page, "重新生成菜单")).toHaveCount(0);
  await expect(button(page, "取消修改，继续调整")).toHaveCount(0);
  await button(page, "继续调整菜单").click();
  await expect(page.locator(".selected-name")).toHaveText("荤菜3");
  expect(state.generations).toBe(1);

  await button(page, "返回安排").click(); await expandSettings(page);
  const meat = page.locator(".structure-fields input").first(), dinner = page.locator(".setting-row").first().getByRole("checkbox").last();
  await meat.fill("3"); await expect(button(page, "重新生成菜单")).toBeVisible();
  await meat.fill("2"); await dinner.uncheck(); await dinner.check();
  await expect(button(page, "继续调整菜单")).toBeVisible();
  await expect(button(page, "取消修改，继续调整")).toHaveCount(0);
  await button(page, "继续调整菜单").click();
  await expect(page.locator(".selected-name")).toHaveText("荤菜3");
  expect(state.generations).toBe(1);

  await button(page, "返回安排").click(); await expandSettings(page);
  await meat.fill("3"); await dinner.uncheck();
  await button(page, "重新生成菜单").click(); await page.locator(".taro-model__cancel").click();
  await expect(meat).toHaveValue("3"); await expect(dinner).not.toBeChecked();
  expect(state.generations).toBe(1);
  await button(page, "返回本周菜单").click(); await button(page, "继续调整菜单").click();
  await expect(page.locator(".flow-heading")).toContainText("安排本周菜单");
  await expect(meat).toHaveValue("3"); await expect(dinner).not.toBeChecked();
  await button(page, "取消修改，继续调整").click();
  await expect(page.locator(".selected-name")).toHaveText("荤菜3");
  await expect(button(page, "确认菜单")).toBeEnabled();
  await button(page, "返回安排").click(); await expandSettings(page);
  await expect(meat).toHaveValue("2"); await expect(dinner).toBeChecked();
  await button(page, "继续调整菜单").click();
  await expect(page.locator(".selected-name")).toHaveText("荤菜3");
  expect(state.writes).toHaveLength(1); expect(state.generations).toBe(1);
});

test("编辑检查历史统一露出两天半，末尾周末完整可达且渐变消失", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const state = await openWeek(page); await generate(page);
  const scroll = page.locator(".day-scroll");
  const aligned = async (last = false) => {
    await expect.poll(() => scroll.evaluate((node, end) => {
      const columns = [...node.querySelectorAll(".day-column")].map((column) => column.getBoundingClientRect()), bounds = node.getBoundingClientRect();
      const complete = columns.filter((column) => column.left >= bounds.left - 1 && column.right <= bounds.right + 1);
      if (complete.length !== 2) return false;
      if (end || Math.abs(node.scrollWidth - node.clientWidth - node.scrollLeft) < 1) {
        const partial = columns[4]!;
        return Math.abs(columns[6]!.right - bounds.right) < 1 && complete[0] === columns[5] && complete[1] === columns[6]
          && Math.abs((partial.right - bounds.left) / partial.width - 0.5) < 0.02;
      }
      const partial = columns[columns.indexOf(complete[1]!) + 1];
      return Math.abs(complete[0]!.left - bounds.left) < 1 && !!partial
        && Math.abs((bounds.right - partial.left) / partial.width - 0.5) < 0.02;
    }, last)).toBe(true);
  };
  const responsive = async () => {
    for (const width of [320, 390, 698]) {
      await page.setViewportSize({ width, height: 878 }); await aligned();
      await expect.poll(() => scroll.evaluate((node) => {
        const third = node.querySelectorAll(".day-column")[2]!.getBoundingClientRect();
        return (node.getBoundingClientRect().right - third.left) / third.width;
      })).toBeCloseTo(0.5, 1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.locator(".weekly-menu-grid").evaluate((node) => getComputedStyle(node, "::after").opacity)).toBe("1");
  };
  await responsive();
  const drag = async () => { const box = (await scroll.boundingBox())!; await page.mouse.move(box.x + 240, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 130, box.y + 80, { steps: 12 }); await page.mouse.up(); };
  const edge = (await scroll.boundingBox())!;
  await page.mouse.move(edge.x + 2, edge.y + 20); await page.mouse.down(); await page.mouse.move(edge.x - 1, edge.y + 20); await page.mouse.up();
  await page.mouse.move(edge.x + 150, edge.y + 20); await expect(scroll).not.toHaveClass(/dragging/); await aligned();
  await drag(); await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(100); await aligned();
  await expect(button(page, "周一午餐：荤菜1")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "周二午餐：荤菜1")).toHaveAttribute("aria-pressed", "false");
  const cdp = await context.newCDPSession(page); await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const box = (await scroll.boundingBox())!, beforeTouch = await scroll.evaluate((node) => node.scrollLeft);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 240, y: box.y + 20 }] });
  for (let step = 1; step <= 8; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 240 - step * 20, y: box.y + 20 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(beforeTouch + 50); await aligned();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 200, y: box.y + 20 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 90, y: box.y + 20 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); await aligned();
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }); await cdp.detach();
  const weekend = async () => {
    await scroll.hover(); await page.mouse.wheel(2500, 0);
    await expect.poll(() => scroll.evaluate((node) => Math.abs(node.scrollWidth - node.clientWidth - node.scrollLeft))).toBeLessThan(1);
    await aligned(true);
    await expect.poll(() => page.locator(".weekly-menu-grid").evaluate((node) => getComputedStyle(node, "::after").opacity)).toBe("0");
  };
  await weekend(); await button(page, "确认菜单").click(); await responsive(); await weekend();
  await expect(page.locator(".board-filter")).toHaveCount(0);
  await button(page, "保存本周菜单").click(); await button(page, "历史").click();
  await expect(button(page, "全部")).toHaveAttribute("aria-pressed", "true");
  await expect(lunchDishes(page).locator(".dish-cell")).toHaveCount(5);
  await responsive(); await weekend();
  const position = await scroll.evaluate((node) => node.scrollLeft), saved = structuredClone(state.saved);
  for (const [filter, rows] of [["荤菜", 2], ["全部", 5]] as const) {
    await button(page, filter).click();
    await expect(button(page, filter)).toHaveAttribute("aria-pressed", "true");
    await expect(lunchDishes(page).locator(".dish-cell")).toHaveCount(rows);
    await expect(page.locator(".readonly-board .dish-cell.action-button")).toHaveCount(0);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(() => scroll.evaluate((node, left) => Math.abs(node.scrollLeft - left), position)).toBeLessThan(1);
  }
  expect(state.saved).toEqual(saved); expect(state.writes).toHaveLength(1);
  await button(page, "排菜单").click(); await enterEdit(page); await expect(button(page, "返回安排")).toBeVisible();
  await expect(page.getByText(/旧消息不会自动更新|自行通知邻居/)).toHaveCount(0);
  await openPreview(page); await expect(page.getByText(/微信消息不会自动更新|自行通知邻居/)).toHaveCount(0);
});

test("单餐从今天的保存快照去汤，显式保存只改该餐，回看复制及恢复无需整周确认", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-09-23T08:00:00Z"));
  const state = await openWeek(page, false, 4, "2026-09-23T08:00:00Z"); await generate(page); await confirmWeek(page);
  await expect(preview(page)).toBeEnabled();
  const before = structuredClone(state.saved!);
  await preview(page).click();
  await expect(page.locator(".copy-screen select")).toHaveValue("2");
  await button(page, "晚餐").click();
  await expect(copyText(page)).toHaveValue(/9\.23号星期三晚餐预定接龙（30元）/);
  await expect(button(page, "保存本餐调整")).toHaveCount(0);
  await soupToggle(page).click();
  await expect(copyText(page)).not.toHaveValue(/汤菜1/);
  await expect(button(page, "复制接龙说明")).toBeDisabled();
  expect(state.writes).toHaveLength(1); expect(state.saved).toEqual(before);
  await button(page, "保存本餐调整").click();
  await expect(page.getByText("本餐调整已保存", { exact: true })).toBeVisible();
  await expect(page.locator(".meal-adjustment")).toBeVisible();
  await expect(button(page, "确认菜单")).toHaveCount(0);
  expect(state.saved!.meals).toEqual(before.meals.map((meal, i) => i === 5 ? { ...meal, soupOmitted: true } : meal));
  expect(state.saved!.structure).toEqual(before.structure); expect(state.saved!.confirmedAt).toBeNull();
  expect(JSON.parse(state.writes[1]!.body)).toMatchObject({ confirm: false, rebuild: false, baseVersion: before.version });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: testInfo.outputPath("single-meal-saved.png") });
  await expect(copyText(page)).toHaveValue("9.23号星期三晚餐预定接龙（30元）\n1.荤菜1\n2.荤菜2\n3.素菜1\n4.素菜2");
  await clipboard(page); await button(page, "复制接龙说明").click();
  await expect(page.locator("html")).toHaveAttribute("data-copied", /^9\.23号星期三晚餐预定接龙（30元）\n1\.荤菜1\n2\.荤菜2\n3\.素菜1\n4\.素菜2$/);
  await closeCopy(page); await preview(page).click(); await button(page, "晚餐").click();
  await expect(soupToggle(page)).not.toBeChecked();
  await soupToggle(page).click(); await button(page, "保存本餐调整").click();
  await expect(page.getByText("本餐调整已保存", { exact: true })).toBeVisible();
  expect(state.saved!.meals).toEqual(before.meals); expect(state.generations).toBe(1); expect(state.writes).toHaveLength(3);
});

test("单餐阻止混入未保存周和整周设置草稿，切餐取消与退出都不写入", async ({ page }) => {
  await page.clock.setFixedTime(new Date(timestamp));
  const state = await openWeek(page); await generate(page); await home(page);
  await expect(page.getByText("菜单尚未保存", { exact: true })).toBeVisible();
  await expect(page.locator(".home-meal-card")).toHaveCount(0);
  await expect(preview(page)).toHaveCount(0); await expect(soupToggle(page)).toHaveCount(0);
  await saveDraft(page); await replaceLunch(page); await home(page);
  await preview(page).click();
  await expect(soupToggle(page)).toHaveCount(0); await closeCopy(page);
  await button(page, "放弃本次调整").click(); await page.getByText("放弃修改", { exact: true }).click();
  await settings(page); await expandSettings(page); await page.locator(".structure-fields input").first().fill("3");
  await expect(preview(page)).toHaveCount(0);
  await button(page, "取消修改，继续调整").click();
  await openPreview(page); await soupToggle(page).click();
  await button(page, "晚餐").click(); await page.getByText("继续编辑", { exact: true }).click();
  await expect(button(page, "午餐")).toHaveAttribute("aria-pressed", "true");
  await expect(soupToggle(page)).not.toBeChecked();
  state.failure = "read";
  await button(page, "晚餐").click(); await page.getByText("放弃修改", { exact: true }).click();
  await expect(page.locator(".copy-screen")).toContainText("读取已保存菜单失败");
  await expect(button(page, "午餐")).toHaveAttribute("aria-pressed", "true");
  await expect(soupToggle(page)).not.toBeChecked();
  await button(page, "关闭菜单文字").click(); await page.getByText("继续编辑", { exact: true }).click();
  await expect(page.locator(".meal-adjustment")).toBeVisible();
  await button(page, "关闭菜单文字").click(); await page.getByText("放弃修改", { exact: true }).click();
  await preview(page).click(); await expect(soupToggle(page)).toBeChecked();
  await soupToggle(page).click(); await button(page, "晚餐").click(); await page.getByText("放弃修改", { exact: true }).click();
  await expect(button(page, "晚餐")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "保存本餐调整")).toHaveCount(0);
  expect(state.writes).toHaveLength(1); expect(state.saved!.meals).toEqual(state.generated!.meals);
});

for (const failure of ["lost", "conflict"]) test(`单餐保存${failure}不冒充成功，保护草稿及原请求`, async ({ page }) => {
  await page.clock.setFixedTime(new Date(timestamp));
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  await preview(page).click(); await soupToggle(page).click(); await button(page, "保存本餐调整").click();
  await expect(page.getByText("本餐调整已保存", { exact: true })).toBeVisible();
  const before = structuredClone(state.saved!);
  await soupToggle(page).click();
  await expect(page.getByText("本餐调整已保存", { exact: true })).toHaveCount(0);
  state.failure = failure; await button(page, "保存本餐调整").click();
  await expect(page.locator(".recovery")).toBeVisible();
  await expect(page.getByText("本餐调整已保存", { exact: true })).toHaveCount(0);
  await expect(button(page, "保存本餐调整")).toBeDisabled();
  await expect(copyText(page)).toHaveValue(/汤菜1/);
  if (failure === "lost") {
    await expect(button(page, "历史")).toBeDisabled(); await expect(button(page, "晚餐")).toBeDisabled();
    await button(page, "重试原保存请求").click();
    await expect(page.getByText("本餐调整已保存", { exact: true })).toBeVisible();
    expect(state.writes[3]).toEqual(state.writes[2]); expect(state.saved!.version).toBe(before.version + 1);
    expect(state.saved!.meals.slice(1)).toEqual(before.meals.slice(1));
  } else {
    expect(state.saved).toEqual(before);
    await button(page, "读取服务器菜单核对").click();
    await expect(page.locator(".recovery")).toContainText("版本2");
    await expect(soupToggle(page)).toBeChecked();
    await button(page, "核对完成，载入服务器版本").click(); await page.getByText("取消", { exact: true }).click();
    await expect(soupToggle(page)).toBeChecked();
    await button(page, "核对完成，载入服务器版本").click(); await page.getByText("确定", { exact: true }).click();
    await closeCopy(page); await preview(page).click(); await expect(soupToggle(page)).not.toBeChecked();
    expect(state.writes).toHaveLength(3);
  }
  expect(state.generations).toBe(1);
});

test("单餐过滤停餐并回退首个启用餐，失效汤须选齐后显式保存且不改其他餐", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-01T08:00:00Z"));
  const state = await openWeek(page, false, 4, "2026-10-01T08:00:00Z"); await expandSettings(page); await page.locator(".structure-fields input").last().fill("2");
  await page.locator(".setting-row").first().getByRole("checkbox").first().uncheck();
  await page.locator(".setting-row").nth(1).getByRole("checkbox").first().uncheck();
  await page.locator(".setting-row").nth(1).getByRole("checkbox").last().uncheck();
  await generate(page); await confirmWeek(page); const before = structuredClone(state.saved!);
  await preview(page).click();
  await expect(page.locator(".copy-screen select")).toHaveValue("0");
  await expect(page.locator(".copy-screen option")).toHaveCount(6); await expect(button(page, "午餐")).toHaveCount(0);
  await expect(button(page, "晚餐")).toHaveAttribute("aria-pressed", "true");
  await soupToggle(page).click(); await button(page, "保存本餐调整").click();
  await expect(page.getByText("本餐调整已保存", { exact: true })).toBeVisible();
  state.items.find((dish) => dish.name === "汤菜1")!.active = false;
  await soupToggle(page).click(); await button(page, "汤菜2").click();
  await expect(button(page, "选齐并恢复汤")).toBeDisabled(); await expect(button(page, "保存本餐调整")).toHaveCount(0);
  await page.locator(".candidate-sheet").getByRole("button", { name: "取消", exact: true }).click();
  await expect(copyText(page)).not.toHaveValue(/汤菜2/);
  await soupToggle(page).click(); await button(page, "汤菜2").click(); await button(page, "汤菜3").click();
  let release!: () => void;
  const response = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/kith-inn/dishes", async (route) => { await response; await route.fallback(); });
  await button(page, "选齐并恢复汤").click();
  await expect(page.locator(".candidate-sheet").getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(button(page, "关闭菜单文字")).toBeDisabled();
  release(); await expect(page.locator(".candidate-sheet")).toHaveCount(0);
  await expect(copyText(page)).toHaveValue(/汤菜3/);
  expect(state.writes).toHaveLength(2);
  await button(page, "保存本餐调整").click(); await expect(page.getByText("本餐调整已保存", { exact: true })).toBeVisible();
  expect(state.saved!.meals).toEqual(before.meals.map((meal, i) => i === 1 ? { ...meal, soup: [{ dishId: id(22), name: "汤菜2" }, { dishId: id(23), name: "汤菜3" }] } : meal));
  expect(state.generations).toBe(1); expect(state.saved!.structure).toEqual(before.structure);
});

test("单餐无汤和整周停餐没有无效去汤或保存入口", async ({ page }) => {
  const state = await openWeek(page); await expandSettings(page); await page.locator(".structure-fields input").last().fill("0");
  await generate(page); await confirmWeek(page); await preview(page).click();
  await expect(page.getByText("本餐未安排汤", { exact: true })).toBeVisible();
  await expect(soupToggle(page)).toHaveCount(0); await expect(button(page, "保存本餐调整")).toHaveCount(0);
  await button(page, "关闭菜单文字").click();
  state.saved = { ...state.saved!, meals: state.saved!.meals.map((meal) => ({ ...meal, enabled: false, meat: [], vegetable: [], soup: [] })) };
  await preview(page).click();
  await expect(page.getByText("本周没有已安排的餐次，请返回周菜单调整。", { exact: true })).toBeVisible();
  await expect(page.locator(".copy-screen select")).toHaveCount(0); await expect(button(page, "保存本餐调整")).toHaveCount(0);
  await button(page, "关闭菜单文字").click();
  await expect(page.locator(".schedule-home .muted")).toHaveText("本周没有已安排的餐次");
  await expect(page.locator(".home-meal-card")).toHaveCount(0); await expect(preview(page)).toHaveCount(0);
  expect(state.writes).toHaveLength(1); expect(state.generations).toBe(1);
});


test("首页没有保存操作，草稿返回编辑保存，查看或还原原菜不改变确认", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  await expect(page.locator(".state-badge")).toHaveText("已确认");
  await expect(button(page, "保存调整")).toHaveCount(0);
  const saved = structuredClone(state.saved);
  await enterEdit(page); await home(page);
  await expect(button(page, "保存调整")).toHaveCount(0);
  await enterEdit(page); await replaceLunch(page); await home(page);
  await expect(button(page, "保存调整")).toHaveCount(0);
  await expect(page.locator(".week-toolbar .state-badge")).toHaveText("未保存");
  await expect(page.locator(".home-meal-dishes")).toContainText("荤菜1");
  await expect(page.locator(".home-meal-dishes")).not.toContainText("荤菜3");
  await expect(button(page, "继续调整菜单")).toBeEnabled();
  await enterEdit(page); await button(page, "自己选").click(); await button(page, "荤菜1").click();
  await button(page, "保存这次替换").click(); await home(page);
  await expect(button(page, "保存调整")).toHaveCount(0);
  await expect(page.locator(".state-badge")).toHaveText("已确认");
  expect(state.saved).toEqual(saved); expect(state.writes).toHaveLength(1);
  await enterEdit(page); await replaceLunch(page); await home(page);
  await button(page, "继续调整菜单").click(); await confirmWeek(page);
  await expect(page.locator(".week-toolbar .state-badge")).toHaveText("已确认");
  await home(page); await expect(button(page, "保存调整")).toHaveCount(0);
  await expect(page.locator(".state-badge")).toHaveText("已确认");
  await expect(page.locator(".home-meal-dishes")).toContainText("荤菜3");
  await expect(page.locator(".hint").filter({ hasText: /菜单已保存/ })).toHaveCount(0);
  expect(state.writes).toHaveLength(2); expect(state.saved!.confirmedAt).not.toBeNull();
});


test("历史复用需确认，取消不写入，选择隔周复制为草稿后确认保存", async ({ page }) => {
  const state = await openWeek(page); await generate(page); await confirmWeek(page);
  const original = structuredClone(state.saved!);
  let next: WeekPlan | null = null, writes = 0;
  await page.route("**/api/kith-inn/weeks/2026-10-05", async (route) => {
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,PUT,OPTIONS" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (route.request().method() === "GET") return next ? route.fulfill({ headers, json: next }) : route.fulfill({ status: 404, headers, json: { error: { code: "NOT_FOUND", message: "未保存", requestId: id(999) } } });
    const input = WeekWriteInputSchema.parse(route.request().postDataJSON());
    writes++;
    expect(input.baseVersion).toBe(next?.version ?? 0);
    expect(input.structure).toEqual(original.structure);
    input.meals.forEach((meal, i) => {
      expect(meal.vegetable).toEqual(original.meals[i]!.vegetable.map((dish) => dish.dishId));
      expect(meal.soup).toEqual(original.meals[i]!.soup.map((dish) => dish.dishId));
    });
    next = WeekPlanSchema.parse({ ...original, weekStart: "2026-10-05", version: input.baseVersion + 1,
      meals: original.meals.map((meal, i) => ({ ...meal, date: input.meals[i]!.date })) });
    return route.fulfill({ headers, json: next });
  });
  await button(page, "历史").click();
  await expect(button(page, "调整这一周")).toHaveCount(0);
  await expect(button(page, "重新读取")).toHaveCount(0);
  await button(page, "复制这周菜单").click(); await button(page, "下一个目标周").click();
  await button(page, "下一个目标周").click(); await expect(page.locator(".flow-dock")).toContainText("2026-10-12");
  await button(page, "上一个目标周").click();
  await button(page, "复制到所选周").click(); await page.locator(".taro-model__cancel").click();
  await expect(page.locator(".history-app")).toBeVisible(); expect(writes).toBe(0);
  await button(page, "荤菜").click(); await expect(button(page, "荤菜")).toHaveAttribute("aria-pressed", "true");
  await button(page, "复制这周菜单").click(); await button(page, "下一个目标周").click(); await button(page, "复制到所选周").click(); await page.locator(".taro-model__confirm").click();
  await expect(button(page, "返回安排")).toBeVisible();
  await expect(page.locator(".board-head")).toContainText("10月5日—11日");
  expect(writes).toBe(0); expect(state.saved).toEqual(original);
  await confirmWeek(page); expect(writes).toBe(1);
  await button(page, "历史").click(); await button(page, "复制这周菜单").click(); await button(page, "下一个目标周").click(); await button(page, "复制到所选周").click();
  await expect(page.getByText("2026-10-05 起的一周。目标周已有菜单，复制后会进入新草稿，确认保存才会替换目标周菜单。", { exact: true })).toBeVisible();
  await page.locator(".taro-model__cancel").click(); expect(writes).toBe(1);
});


test("生成前餐次收起搭配展开，修改后摘要同步且生成按钮固定可见", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openWeek(page);
  await expect(page.locator(".setting-row")).toHaveCount(0);
  await expect(page.locator(".structure-fields")).toBeVisible();
  await expect(page.locator(".plan-state")).toHaveCount(0);
  await expect(page.locator(".settings-summary").first()).toContainText("每天午餐、晚餐，共 14 餐");
  const generateButton = button(page, "生成本周菜单");
  const box = await generateButton.boundingBox(), nav = await page.locator(".main-nav").boundingBox();
  expect(box!.y).toBeGreaterThan(0); expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y);
  await button(page, "修改安排餐次").click();
  await page.locator(".setting-row").last().getByRole("checkbox").last().uncheck();
  await button(page, "修改安排餐次").click();
  await expect(page.locator(".settings-summary").first()).toContainText("共 13 餐");
  await page.locator(".structure-fields input").first().fill("3");
  await button(page, "修改每餐搭配").click();
  await expect(page.locator(".settings-summary").last()).toContainText("3 荤 · 2 素 · 1 汤");
  await generate(page);
  expect(state.generated!.structure.meat).toBe(3);
  expect(state.generated!.meals[13]!.enabled).toBe(false);
});
