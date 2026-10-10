import { expect, test } from "@playwright/test";

test("生产 H5 的入口与生命周期共用 React 上下文，直达和刷新均可渲染", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // 不依赖登录或后端请求：隔离 pnpm 多个 peer 快照导致的初始化白屏。
  for (const route of ["dishes", "week"]) {
    await page.goto(`/#/pages/${route}/index`);
    await expect(page.getByRole("button", { name: "微信登录", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "微信登录", exact: true })).toBeVisible();
  }
  expect(errors, "生命周期不得读取另一份尚未初始化的 React 运行时").toEqual([]);
});
