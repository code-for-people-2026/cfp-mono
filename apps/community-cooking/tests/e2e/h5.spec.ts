import { expect, test } from "@playwright/test";

test("H5 首页展示标题并能进入菜单页", async ({ page }) => {
  // 限定到页面体 #app（"社区做饭" 等也出现在 Taro 导航栏），并用 exact 精确匹配：
  // getByText 默认是子串匹配，"本周菜单" 会撞上首页的「生成本周菜单」按钮
  // —— Taro navigateTo 后旧页面仍留在 DOM 里。
  const app = page.locator("#app");

  await page.goto("/");
  await expect(app.getByText("社区做饭", { exact: true })).toBeVisible();

  await app.getByText("生成本周菜单", { exact: true }).click();
  await expect(app.getByText("本周菜单", { exact: true })).toBeVisible();
});
