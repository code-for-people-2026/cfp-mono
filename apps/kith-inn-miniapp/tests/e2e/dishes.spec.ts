import { expect, test, type Page } from "@playwright/test";
import type { Dish, DishBatchInput, DishUpdateInput } from "@cfp/kith-inn-contracts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const timestamp = "2026-09-20T00:00:00Z";
const seed: Dish = { id: id(1), name: "红烧排骨", category: "meat", active: true, version: 1, createdAt: timestamp, updatedAt: timestamp };
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

// Controlled H5 transport and stored session; this does not exercise real WeChat or a database.
async function openPool(page: Page, initial: Dish[] = []) {
  const state = { items: [...initial], writes: [] as { method: string; body: string; key: string }[], failure: "", failNextRead: false };
  await page.addInitScript(() => localStorage.setItem("kith-inn:session:v1:https://kith-inn.test", JSON.stringify({
    data: { token: "t".repeat(43), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }
  })));
  await page.route("**/api/kith-inn/dishes**", async (route) => {
    const request = route.request(), method = request.method();
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS" };
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
    if (failure) return route.fulfill({ status: failure === "INVALID_REQUEST" ? 400 : 409, headers,
      json: { error: { code: failure, message: "受控错误", requestId: id(999), ...(failure === "VERSION_CONFLICT" ? { details: { currentVersion: 2 } } : {}) } } });
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
  await page.goto("/");
  await expect(page.getByText(initial.length ? "我的菜品池" : "建立我的菜品池", { exact: true })).toBeVisible();
  const action = button(page, initial.length ? "批量添加" : "自动分成荤 / 素 / 汤");
  await expect(action).toHaveJSProperty("tagName", "BUTTON");
  return state;
}
async function preview(page: Page, names: string) {
  await page.locator('textarea[placeholder="每行一道菜，例如：红烧排骨"]').fill(names);
  await button(page, "自动分成荤 / 素 / 汤").focus();
  await expect(button(page, "自动分成荤 / 素 / 汤")).toBeFocused();
  await page.keyboard.press("Enter");
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

test("编辑菜名分类，停用后仍可找到并恢复", async ({ page }) => {
  const state = await openPool(page, [seed]);
  await button(page, "编辑").click();
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

test("首次保存成功后读取失败，保留保存确认和重新读取入口", async ({ page }) => {
  const state = await openPool(page);
  await preview(page, "红烧排骨");
  state.failNextRead = true;
  await button(page, "确认加入菜品池").click();
  await expect(page.getByText("已新增 1 道菜", { exact: true })).toBeVisible();
  await expect(page.getByText("保存已确认，但菜品池暂时读取失败。请重新读取查看最新内容。", { exact: true })).toBeVisible();
  await expect(page.getByText("建立我的菜品池", { exact: true })).toHaveCount(0);
  await expect(button(page, "重新读取")).toBeEnabled();
  await button(page, "重新读取").click();
  await expect(page.locator(".dish-card")).toHaveCount(1);
  await expect(page.locator(".dish-card")).toContainText("红烧排骨");
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
