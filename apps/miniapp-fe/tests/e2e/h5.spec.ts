import { expect, test } from "@playwright/test";

test("Taro H5 homepage renders", async ({ page }) => {
  await page.goto("/");
  const app = page.locator("#app");

  await expect(app.getByText("码成工", { exact: true })).toBeVisible();
  await expect(app.getByText("Taro 同时产出微信小程序和 H5")).toBeVisible();
});
