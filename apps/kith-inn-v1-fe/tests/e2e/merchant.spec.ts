import { expect, test, type Page } from "@playwright/test";

const taroButton = (page: Page, text: RegExp) => page.locator("taro-button-core").filter({ hasText: text });

test("未授权访问菜品页会回到登录", async ({ page }) => {
  await page.goto("/pages/merchant/offerings/index");
  await expect(page).toHaveURL(/pages\/merchant\/login\/index/);
  await expect(taroButton(page, /^开发登录$/)).toBeVisible();
});

test("dev login 后完成菜品 CRUD 与 import preview/commit", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const original = `测试菜-${suffix}`;
  const renamed = `改名菜-${suffix}`;
  const imported = `导入菜-${suffix}`;

  await page.goto("/");
  const loginStartedAt = Date.now();
  await taroButton(page, /^开发登录$/).click();
  await expect(page.getByText("菜品池", { exact: true })).toBeVisible();
  expect(Date.now() - loginStartedAt).toBeLessThan(30_000);

  await page.getByRole("textbox", { name: "菜名" }).fill(original);
  await page.getByRole("textbox", { name: "主料（可不填）" }).fill("牛肉");
  await taroButton(page, /^荤$/).click();
  await taroButton(page, /^新增菜品$/).click();
  await expect(page.getByText(original)).toBeVisible();

  await page.getByLabel(`编辑 ${original}`).click();
  await page.getByRole("textbox", { name: "菜名" }).fill(renamed);
  await taroButton(page, /^保存修改$/).click();
  await expect(page.getByText(renamed)).toBeVisible();

  await page.getByLabel(`停用 ${renamed}`).click();
  await expect(page.getByText("已停用菜品")).toBeVisible();
  await page.getByLabel(`恢复 ${renamed}`).click();
  await expect(page.getByLabel(`停用 ${renamed}`)).toBeVisible();

  await page.getByRole("textbox", { name: "每行一道菜" }).fill(`${renamed} 牛肉 荤\n${imported} 青菜 素\n坏数据`);
  await taroButton(page, /^预览导入$/).click();
  await expect(page.getByText("可新增 1 行，重名 1 行，错误 1 行")).toBeVisible();
  await page.getByLabel("覆盖第 1 行").click();
  await taroButton(page, /^确认导入$/).click();
  await expect(page.getByText("新增 1 行，覆盖 1 行，跳过 0 行，失败 1 行")).toBeVisible();
  await expect(page.getByText("第 1 行：覆盖成功")).toBeVisible();
  await expect(page.getByText("第 2 行：新增成功")).toBeVisible();
  await expect(page.getByText("第 3 行：失败：每行需要菜名和分类")).toBeVisible();
  await expect(page.getByText(imported, { exact: true })).toBeVisible();

  const fiftyRows = Array.from({ length: 50 }, (_, index) => `预算菜-${suffix}-${index} 素`).join("\n");
  await page.getByRole("textbox", { name: "每行一道菜" }).fill(fiftyRows);
  await expect(taroButton(page, /^确认导入$/)).toHaveCount(0);
  const previewStartedAt = Date.now();
  await taroButton(page, /^预览导入$/).click();
  await expect(page.getByText("可新增 50 行，重名 0 行，错误 0 行")).toBeVisible();
  expect(Date.now() - previewStartedAt).toBeLessThan(2_000);
});
