import { expect, test } from "@playwright/test";

test("H5 首页展示标题并能进入菜单页", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("社区做饭")).toBeVisible();

  await page.getByText("生成本周菜单").click();
  await expect(page.getByText("本周菜单")).toBeVisible();
});
