import { expect, test } from "@playwright/test";

test("H5 Mock 完成菜单确认、清单、历史和复制 Happy Path", async ({
  page
}) => {
  // Taro navigateTo 后旧页面仍留在 DOM，Playwright 只操作当前可见元素。
  const app = page.locator("#app");

  await page.goto("/");
  await expect(app.getByText("Weekly Menu", { exact: true })).toBeVisible();
  await expect(app.getByText("Mock 模式", { exact: true })).toBeVisible();

  await app.getByText("Mock 登录", { exact: true }).click();
  await expect(app.getByText("你好，学习用户", { exact: true })).toBeVisible();

  await app.getByText("制作本周菜单", { exact: true }).click();
  await expect(app.getByText("本周菜单", { exact: true })).toBeVisible();
  await expect(app.getByText("周一", { exact: true })).toBeVisible();
  await expect(app.getByText("周日", { exact: true })).toBeVisible();

  const firstDish = app.locator(".dish-name").first();
  const firstDishName = await firstDish.textContent();
  await app.getByText("换一道", { exact: true }).first().click();
  await expect(firstDish).not.toHaveText(firstDishName ?? "");

  await app.getByText("保存草稿", { exact: true }).click();
  await expect(app.getByText("草稿已保存", { exact: true })).toBeVisible();
  await app.getByText("确认菜单", { exact: true }).click();

  await expect(
    app.getByText("本周菜品勾选清单", { exact: true })
  ).toBeVisible();
  await expect(app.getByText(/已核对 0 \/ \d+/)).toBeVisible();
  await app.getByRole("checkbox").first().check();
  await expect(app.getByText(/已核对 1 \/ \d+/)).toBeVisible();

  await app.getByText("查看历史", { exact: true }).last().click();
  await expect(app.getByText("已确认", { exact: true })).toBeVisible();
  await app.locator(".history-card").first().click();
  await expect(app.getByText("已确认菜单", { exact: true })).toBeVisible();
  await app.getByText("复制为新草稿", { exact: true }).click();

  await expect(app.getByText("本周菜单", { exact: true }).last()).toBeVisible();
  await expect(app.getByText("由历史菜单复制", { exact: true })).toBeVisible();

  await app.getByText("查看历史", { exact: true }).last().click();
  const visibleHistoryCards = app.locator(".history-card:visible");
  await expect(visibleHistoryCards).toHaveCount(2);
  await visibleHistoryCards.first().click();
  await expect(app.getByText("草稿菜单", { exact: true })).toBeVisible();
  await app.getByText("删除草稿", { exact: true }).click();
  await expect(page.getByText("删除草稿？", { exact: true })).toBeVisible();
  await page.getByText("确定", { exact: true }).click();

  await expect(app.locator(".history-card:visible")).toHaveCount(1);
  await expect(app.locator(".history-status--confirmed:visible")).toHaveCount(1);
  await expect(app.locator(".history-status--draft:visible")).toHaveCount(0);
});
