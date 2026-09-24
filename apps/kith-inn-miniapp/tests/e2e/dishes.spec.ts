import { expect, test, type Page } from "@playwright/test";
import type { Dish, DishBatchInput, DishUpdateInput } from "@cfp/kith-inn-contracts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const timestamp = "2026-09-20T00:00:00Z";
const seed: Dish = { id: id(1), name: "红烧排骨", category: "meat", active: true, version: 1, createdAt: timestamp, updatedAt: timestamp };
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

// Controlled H5 transport and stored session; this does not exercise real WeChat or a database.
async function openPool(page: Page, initial: Dish[] = []) {
  const state = { items: [...initial], writes: [] as { method: string; body: string; key: string }[], failure: "", failNextRead: false };
  const deletions = new Map<string, { id: string }>();
  await page.addInitScript(() => localStorage.setItem("kith-inn:session:v1:https://kith-inn.test", JSON.stringify({
    data: { token: "t".repeat(43), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }
  })));
  await page.route("**/api/kith-inn/dishes**", async (route) => {
    const request = route.request(), method = request.method();
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS" };
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (method === "GET") {
      if (state.failNextRead) {
        state.failNextRead = false;
        return route.fulfill({ status: 503, headers,
          json: { error: { code: "SERVICE_UNAVAILABLE", message: "受控读取错误", requestId: id(999) } } });
      }
      return route.fulfill({ json: { items: state.items }, headers });
    }
    state.writes.push({ method, body: request.postData()!, key: request.headers()["idempotency-key"]! });
    const failure = state.failure; state.failure = "";
    if (failure === "abort") return route.abort("failed");
    if (failure && failure !== "lost-delete") return route.fulfill({ status: failure === "INVALID_REQUEST" ? 400 : failure === "NOT_FOUND" ? 404 : 409, headers,
      json: { error: { code: failure, message: "受控错误", requestId: id(999), ...(failure === "VERSION_CONFLICT" ? { details: { currentVersion: 2 } } : {}) } } });
    if (method === "DELETE") {
      const key = request.headers()["idempotency-key"]!;
      if (deletions.has(key)) return route.fulfill({ headers, json: deletions.get(key) });
      const target = state.items.find((dish) => request.url().endsWith(dish.id))!;
      state.items = state.items.filter((dish) => dish.id !== target.id);
      const result = { id: target.id }; deletions.set(key, result);
      if (failure === "lost-delete") return route.abort("failed");
      return route.fulfill({ headers, json: result });
    }
    if (method === "POST") {
      const { items } = request.postDataJSON() as DishBatchInput;
      const added = items.map((dish, i) => ({ ...seed, ...dish, id: id(state.items.length + i + 1) }));
      state.items.push(...added);
      return route.fulfill({ status: 201, json: { items: added }, headers });
    }
    const { baseVersion, ...changes } = request.postDataJSON() as DishUpdateInput;
    const index = state.items.findIndex((dish) => request.url().endsWith(dish.id));
    state.items[index] = { ...state.items[index]!, ...changes, version: baseVersion + 1 };
    return route.fulfill({ json: state.items[index], headers });
  });
  await page.goto("/#/pages/dishes/index");
  await expect(page.getByText(initial.length ? "我的菜品池" : "建立我的菜品池", { exact: true })).toBeVisible();
  const action = button(page, initial.length ? "添加菜品" : "自动分成荤 / 素 / 汤");
  await expect(action).toHaveJSProperty("tagName", "BUTTON");
  return state;
}
async function preview(page: Page, names: string) {
  await expect(button(page, "添加菜品")).toHaveCount(0);
  await page.locator('textarea[placeholder="每行一道菜，例如：红烧排骨"]').fill(names);
  await button(page, "自动分成荤 / 素 / 汤").focus();
  await expect(button(page, "自动分成荤 / 素 / 汤")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(button(page, "确认加入菜品池")).toBeVisible();
  await expect(button(page, "添加菜品")).toHaveCount(0);
}

test("批量录入经手动分类和返回修改，确认前不写入，成功后显示菜池", async ({ page }) => {
  const state = await openPool(page);
  await preview(page, "红烧排骨\n清炒青菜");
  await button(page, "更改清炒青菜分类，当前素").click();
  await button(page, "返回修改菜名").click();
  await expect(page.locator('textarea[placeholder="每行一道菜，例如：红烧排骨"]')).toHaveValue("红烧排骨\n清炒青菜");
  await button(page, "自动分成荤 / 素 / 汤").click();
  await expect(button(page, "更改清炒青菜分类，当前汤")).toBeVisible();
  await button(page, "取消添加").click();
  await page.getByText("继续编辑", { exact: true }).click();
  expect(state.writes).toHaveLength(0);
  await button(page, "确认加入菜品池").click();
  await expect(page.getByText("已新增 2 道菜", { exact: true })).toBeVisible();
  await expect(page.locator(".dish-card")).toHaveCount(2);
  expect(JSON.parse(state.writes[0]!.body)).toEqual({ items: [{ name: "红烧排骨", category: "meat" }, { name: "清炒青菜", category: "soup" }] });
  await page.reload();
  await expect(page.locator(".dish-card")).toHaveCount(2);
  await expect(page.locator(".dish-card").last()).toContainText("清炒青菜");
});

test("长菜品列表首屏与末尾均可添加，末菜不被遮挡，取消返回列表", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dishes = Array.from({ length: 24 }, (_, i) => ({ ...seed, id: id(i + 1), name: `家常菜${String(i + 1).padStart(2, "0")}` }));
  const state = await openPool(page, dishes);
  const add = button(page, "添加菜品"), scroll = page.locator(".flow-scroll"), dock = page.locator(".flow-dock");
  await expect(add).toHaveCount(1); await expect(add).toBeInViewport({ ratio: 1 });
  await expect(dock.getByRole("button", { name: "添加菜品", exact: true })).toBeVisible();
  const initialPosition = (await add.boundingBox())!, dockBox = (await dock.boundingBox())!;
  expect(dockBox.y + dockBox.height).toBeLessThanOrEqual((await page.locator(".main-nav").boundingBox())!.y + 1);
  expect(await scroll.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await scroll.hover(); await page.mouse.wheel(0, 10000);
  await expect(page.locator(".dish-card").last()).toBeInViewport({ ratio: 1 });
  await expect(add).toBeInViewport({ ratio: 1 });
  const last = (await page.locator(".dish-card").last().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual((await dock.boundingBox())!.y + 1);
  expect(Math.abs((await add.boundingBox())!.y - initialPosition.y)).toBeLessThan(1);
  await add.click();
  await expect(page.locator("textarea")).toBeVisible(); await expect(add).toHaveCount(0);
  await button(page, "取消添加").click();
  await expect(page.locator(".dish-card")).toHaveCount(dishes.length);
  await expect(add).toHaveCount(1); await expect(add).toBeInViewport({ ratio: 1 });
  expect(state.writes).toHaveLength(0); expect(state.items).toEqual(dishes);
});

test("编辑菜名分类，停用后仍可找到并恢复", async ({ page }) => {
  const state = await openPool(page, [seed]);
  await button(page, "编辑").click();
  await expect(button(page, "添加菜品")).toHaveCount(0);
  await page.locator('input[placeholder="菜名"]').fill("糖醋排骨");
  await button(page, "更改单菜分类").click();
  await page.getByRole("checkbox").uncheck();
  await button(page, "保存修改").click();
  await expect(page.locator(".dish-card")).toContainText("糖醋排骨");
  await expect(page.locator(".dish-card")).toContainText("已停用");
  expect(state.items[0]).toMatchObject({ name: "糖醋排骨", category: "vegetable", active: false, version: 2 });
  await button(page, "编辑").click();
  await page.getByRole("checkbox").check();
  await button(page, "保存修改").click();
  await expect(page.locator(".dish-card")).toContainText("已启用");
  expect(JSON.parse(state.writes[1]!.body)).toMatchObject({ baseVersion: 2, active: true });
});

test("删除须确认，取消保留草稿，删除后刷新仍移除并能重新添加同名菜", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openPool(page, [seed]);
  await button(page, "编辑").click();
  await page.locator('input[placeholder="菜名"]').fill("未保存的新名字");
  await button(page, "删除菜品").click();
  await expect(page.getByText("“红烧排骨”删除后不可恢复，已保存的菜单不受影响。", { exact: true })).toBeVisible();
  await page.getByText("取消", { exact: true }).click();
  await expect(page.getByText("删除菜品？", { exact: true })).not.toBeVisible();
  await expect(page.locator('input[placeholder="菜名"]')).toHaveValue("未保存的新名字");
  expect(state.writes).toHaveLength(0);
  await page.screenshot({ path: "/tmp/kith-delete-edit-mobile.png" });
  await button(page, "删除菜品").click(); await page.getByText("删除", { exact: true }).click();
  await expect(page.getByText("菜品已删除", { exact: true })).toBeVisible();
  await expect(page.getByText("建立我的菜品池", { exact: true })).toBeVisible();
  expect(state.items).toEqual([]);
  expect(state.writes[0]).toMatchObject({ method: "DELETE", body: JSON.stringify({ baseVersion: 1 }) });
  await page.reload(); await expect(page.locator(".dish-card")).toHaveCount(0);
  await preview(page, "红烧排骨"); await button(page, "确认加入菜品池").click();
  await expect(page.locator(".dish-card")).toHaveCount(1);
});

test("删除响应丢失时冻结编辑并重试原请求，读取失败仍保留删除成功", async ({ page }) => {
  const state = await openPool(page, [seed, { ...seed, id: id(2), name: "保留菜" }]);
  await button(page, "编辑").first().click();
  state.failure = "lost-delete";
  await button(page, "删除菜品").click(); await page.getByText("删除", { exact: true }).click();
  await expect(page.getByText("删除结果尚未确认", { exact: true })).toBeVisible();
  await expect(button(page, "删除菜品")).toBeDisabled();
  await expect(button(page, "取消编辑")).toBeDisabled();
  await button(page, "重新读取").click();
  await expect(button(page, "保存修改")).toBeDisabled();
  state.failNextRead = true;
  await button(page, "重试原请求").click();
  await expect(page.getByText("删除已确认，但菜品池暂时读取失败，请重试。", { exact: true })).toBeVisible();
  await button(page, "重试").click();
  await expect(page.locator(".dish-card")).toHaveCount(1);
  await expect(page.locator(".dish-card")).toContainText("保留菜");
  expect(state.writes[1]).toEqual(state.writes[0]);
});

test("删除旧版本先核对，已被其他设备删除时可退出编辑", async ({ page }) => {
  const state = await openPool(page, [seed]);
  await button(page, "编辑").click(); state.failure = "VERSION_CONFLICT";
  state.items[0] = { ...seed, name: "另一处的新名字", version: 2 };
  await button(page, "删除菜品").click(); await page.getByText("删除", { exact: true }).click();
  await expect(button(page, "删除菜品")).toBeDisabled();
  await button(page, "重新读取").click();
  await button(page, "载入最新版本").click(); await page.getByText("确定", { exact: true }).click();
  state.items = []; state.failure = "NOT_FOUND";
  await button(page, "删除菜品").click(); await page.getByText("删除", { exact: true }).click();
  await button(page, "重新读取").click();
  await expect(page.getByText("该菜品已删除，请取消编辑返回菜品池。", { exact: true })).toBeVisible();
  await button(page, "取消编辑").click();
  await expect(page.getByText("建立我的菜品池", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(JSON.parse(state.writes[1]!.body)).toEqual({ baseVersion: 2 });
});

test("删除结果未知超过重试期限，读取核对后回到菜品池且不再删除", async ({ page }) => {
  await page.clock.install();
  const state = await openPool(page, [seed]);
  await button(page, "编辑").click(); state.failure = "lost-delete";
  await button(page, "删除菜品").click(); await page.getByText("删除", { exact: true }).click();
  await expect(page.getByText("删除结果尚未确认", { exact: true })).toBeVisible();
  await page.clock.fastForward(86_401_000);
  await expect(button(page, "已核对，继续编辑")).toBeDisabled();
  await button(page, "重新读取").click(); await button(page, "已核对，继续编辑").click();
  await page.getByText("确定", { exact: true }).click();
  await expect(page.getByText("菜品已删除", { exact: true })).toBeVisible();
  await expect(page.getByText("建立我的菜品池", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test("首次保存成功后读取失败，保留保存确认和重试入口", async ({ page }) => {
  const state = await openPool(page);
  await preview(page, "红烧排骨");
  state.failNextRead = true;
  await button(page, "确认加入菜品池").click();
  await expect(page.getByText("已新增 1 道菜", { exact: true })).toBeVisible();
  await expect(page.getByText("保存已确认，但菜品池暂时读取失败，请重试。", { exact: true })).toBeVisible();
  await expect(page.getByText("建立我的菜品池", { exact: true })).toHaveCount(0);
  await expect(button(page, "重试")).toBeEnabled();
  await button(page, "重试").click();
  await expect(page.locator(".dish-card")).toHaveCount(1);
  await expect(page.locator(".dish-card")).toContainText("红烧排骨");
  await expect(button(page, "重试")).toHaveCount(0);
  await expect(button(page, "重新读取")).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});

test("400 和 409 保留草稿，冲突读取后仍须明确确认载入", async ({ page }) => {
  const state = await openPool(page, [seed]);
  await button(page, "编辑").click();
  await page.locator('input[placeholder="菜名"]').fill("我的改名");
  state.failure = "INVALID_REQUEST";
  await button(page, "保存修改").click();
  await expect(page.getByText("请检查输入内容", { exact: true })).toBeVisible();
  await expect(page.locator('input[placeholder="菜名"]')).toHaveValue("我的改名");
  state.failure = "VERSION_CONFLICT";
  state.items[0] = { ...seed, name: "别处已改名", version: 2 };
  await button(page, "保存修改").click();
  await expect(page.getByText("内容已在另一处更新，请重新读取后再调整", { exact: true })).toBeVisible();
  await button(page, "重新读取").click();
  await expect(page.locator('input[placeholder="菜名"]')).toHaveValue("我的改名");
  await button(page, "载入最新版本").click();
  await page.getByText("取消", { exact: true }).click();
  await expect(page.locator('input[placeholder="菜名"]')).toHaveValue("我的改名");
  await button(page, "载入最新版本").click();
  await page.getByText("确定", { exact: true }).click();
  await expect(page.locator('input[placeholder="菜名"]')).toHaveValue("别处已改名");
  expect(state.writes).toHaveLength(2);
});

test("响应中断冻结草稿，原请求重试保留幂等键和请求正文", async ({ page }) => {
  const state = await openPool(page);
  await preview(page, "番茄蛋汤");
  state.failure = "abort";
  await button(page, "确认加入菜品池").click();
  await expect(page.getByText("保存结果尚未确认", { exact: true })).toBeVisible();
  await expect(button(page, "排菜单")).toBeDisabled();
  await expect(button(page, "历史")).toBeDisabled();
  await expect(button(page, "返回修改菜名")).toBeDisabled();
  await expect(button(page, "取消添加")).toBeDisabled();
  await expect(button(page, "更改番茄蛋汤分类，当前汤")).toBeDisabled();
  await expect(button(page, "确认加入菜品池")).toBeDisabled();
  await button(page, "重新读取").click();
  await expect(page.getByText("保存结果尚未确认", { exact: true })).toBeVisible();
  await expect(button(page, "返回修改菜名")).toBeDisabled();
  await button(page, "重试原请求").click();
  await expect(page.getByText("已新增 1 道菜", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1]).toEqual(state.writes[0]);
  expect(state.writes[0]!.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await expect(page.locator(".dish-card")).toHaveCount(1);
});

test("重试期限过后必须重新读取并核对实际菜池才能继续编辑", async ({ page }) => {
  await page.clock.install();
  const state = await openPool(page);
  await preview(page, "红烧排骨");
  state.failure = "abort";
  await button(page, "确认加入菜品池").click();
  await expect(page.getByText("保存结果尚未确认", { exact: true })).toBeVisible();
  await button(page, "重新读取").click();
  await expect(button(page, "已核对，继续编辑")).toHaveCount(0);
  await expect(button(page, "重试原请求")).toBeEnabled();
  await page.clock.fastForward(86_401_000);
  await expect(button(page, "已核对，继续编辑")).toBeDisabled();
  state.items.push(seed);
  await button(page, "重新读取").click();
  await expect(page.locator(".review-list")).toContainText("红烧排骨 · 荤 · 已启用");
  await button(page, "已核对，继续编辑").click();
  await page.getByText("确定", { exact: true }).click();
  await expect(page.getByText("保存结果尚未确认", { exact: true })).toHaveCount(0);
  await expect(button(page, "返回修改菜名")).toBeEnabled();
  expect(state.writes).toHaveLength(1);
});


test("固定导航离开未确认批量输入前提醒，取消保留菜名和分类", async ({ page }) => {
  const state = await openPool(page);
  await preview(page, "红烧排骨\n清炒青菜");
  await button(page, "更改清炒青菜分类，当前素").click();
  await button(page, "排菜单").click();
  await page.locator(".taro-model__cancel").click();
  await expect(button(page, "更改清炒青菜分类，当前汤")).toBeVisible();
  await button(page, "返回修改菜名").click();
  await button(page, "历史").click();
  await page.locator(".taro-model__cancel").click();
  await expect(page.locator("textarea")).toHaveValue("红烧排骨\n清炒青菜");
  expect(state.writes).toHaveLength(0);
});


test("只为实际溢出的菜名提供气泡，宽度变化后自动恢复普通文字", async ({ page }) => {
  const middleName = "香菇土豆炖牛肉配家常时蔬及米饭";
  await page.setViewportSize({ width: 520, height: 844 });
  const state = await openPool(page, [seed, { ...seed, id: id(2), name: middleName }]);
  const short = page.locator(".dish-name").first(), middle = page.locator(".dish-name").last();
  await expect(page.locator(".dish-name[aria-haspopup]")).toHaveCount(0);
  await short.click(); await middle.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(short).not.toHaveAttribute("title");
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(middle).toHaveAttribute("aria-haspopup", "dialog");
  await expect(short).not.toHaveAttribute("aria-haspopup");
  await middle.click();
  await expect(page.getByRole("dialog", { name: "完整菜名" })).toContainText(middleName);
  await page.setViewportSize({ width: 520, height: 844 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(middle).not.toHaveAttribute("aria-haspopup");
  await middle.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test.describe("触屏菜池气泡", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test("单行长菜名可点击读全，气泡不越界，外部关闭不误触编辑或写入", async ({ page }) => {
    const longName = "家常香菇土豆炖牛肉".repeat(6).slice(0, 60);
    const state = await openPool(page, [{ ...seed, name: longName }]);
    const name = page.locator(".dish-name");
    const before = await page.locator(".dish-card").boundingBox();
    await expect(name).toHaveCSS("white-space", "nowrap");
    expect(await name.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    await name.tap();
    const popover = page.getByRole("dialog", { name: "完整菜名" });
    await expect(popover).toContainText(longName);
    await expect(page.locator(".dish-name-popover-scroll")).toHaveCSS("height", /px$/);
    const bubble = (await popover.boundingBox())!;
    expect(bubble.x).toBeGreaterThanOrEqual(0);
    expect(bubble.x + bubble.width).toBeLessThanOrEqual(390);
    expect(bubble.y).toBeGreaterThanOrEqual(0);
    expect(bubble.y + bubble.height).toBeLessThanOrEqual(844);
    await popover.locator(".dish-name-popover-text").tap();
    await expect(popover).toBeVisible();
    const editBox = (await button(page, "编辑").boundingBox())!;
    await page.touchscreen.tap(editBox.x + editBox.width / 2, editBox.y + editBox.height / 2);
    await expect(popover).toHaveCount(0);
    await expect(page.locator(".edit-panel")).toHaveCount(0);
    expect((await page.locator(".dish-card").boundingBox())!.height).toBe(before!.height);
    expect(state.writes).toHaveLength(0);
    await name.focus(); await page.keyboard.press("Enter");
    await expect(popover).toBeVisible();
    await expect(button(page, "关闭完整菜名")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect.poll(() => popover.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(name).toBeFocused();
    await button(page, "编辑").click();
    await expect(page.locator('input[placeholder="菜名"]')).toHaveValue(longName);
    expect(state.writes).toHaveLength(0);
  });
});
