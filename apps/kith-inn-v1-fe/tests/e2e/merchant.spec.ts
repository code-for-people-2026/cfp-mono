import { expect, test, type Page } from "@playwright/test";

const taroButton = (page: Page, text: RegExp) => page.locator("taro-button-core").filter({ hasText: text });

test("未授权访问菜品页会回到登录", async ({ page }) => {
  await page.goto("/pages/merchant/offerings/index");
  await expect(page).toHaveURL(/pages\/merchant\/login\/index/);
  await expect(taroButton(page, /^开发登录$/)).toBeVisible();
  await page.goto("/pages/merchant/menu/index");
  await expect(page).toHaveURL(/pages\/merchant\/login\/index/);
});

test("成员资格停用后显示明确提示并回到登录", async ({ page }) => {
  await page.route("**/merchant/offerings?active=all", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "membership-inactive", message: "商家身份已停用" })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/login\/index/);
  await expect(page.getByText("商家身份已停用", { exact: true })).toBeVisible();
  await expect(page.getByText("菜品加载失败", { exact: true })).toHaveCount(0);
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

test("生成单餐与工作周菜单、确认覆盖并换一道菜", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const rows = [
    ...Array.from({ length: 20 }, (_, index) => `菜单荤-${suffix}-${index} 主料荤-${suffix}-${index} 荤`),
    ...Array.from({ length: 20 }, (_, index) => `菜单素-${suffix}-${index} 主料素-${suffix}-${index} 素`),
    ...Array.from({ length: 10 }, (_, index) => `菜单汤-${suffix}-${index} 主料汤-${suffix}-${index} 汤`)
  ];

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await page.getByRole("textbox", { name: "每行一道菜" }).fill(rows.join("\n"));
  await taroButton(page, /^预览导入$/).click();
  await expect(page.getByText("可新增 50 行，重名 0 行，错误 0 行")).toBeVisible();
  await taroButton(page, /^确认导入$/).click();
  await expect(page.getByText("新增 50 行，覆盖 0 行，跳过 0 行，失败 0 行")).toBeVisible();

  await taroButton(page, /^菜单$/).click();
  await expect(page.getByText("菜单计划", { exact: true })).toBeVisible();
  const dateInput = page.getByRole("textbox", { name: "菜单起始日期" });
  await dateInput.fill("2026-08-03");
  const generatedAt = Date.now();
  await taroButton(page, /^生成午餐$/).click();
  await expect(page.getByText("2026-08-03 午餐", { exact: true })).toBeVisible();
  expect(Date.now() - generatedAt).toBeLessThan(3_000);
  const single = page.locator(".menu-slot").filter({ hasText: "2026-08-03 午餐" });
  await expect(single.locator(".menu-item")).toHaveCount(5);

  const firstName = await single.locator(".menu-item-name").first().innerText();
  await single.getByLabel(`换掉 ${firstName}`).click();
  await expect(single.locator(".menu-item-name").filter({ hasText: firstName })).toHaveCount(0);

  await taroButton(page, /^生成午餐$/).click();
  await expect(taroButton(page, /^确认覆盖已有菜单$/)).toBeVisible();
  await taroButton(page, /^确认覆盖已有菜单$/).click();
  await expect(page.locator(".menu-slot").filter({ hasText: "2026-08-03 午餐" })).toHaveCount(1);

  await dateInput.fill("2026-08-10");
  await taroButton(page, /^生成工作周午晚餐$/).click();
  await expect(page.getByText("2026-08-14 晚餐", { exact: true })).toBeVisible();
  const weekSlots = page.locator('.menu-slot[data-week="2026-08-10"]');
  await expect(weekSlots).toHaveCount(10);
  const menus = await weekSlots.evaluateAll((slots) => slots.map((slot) => ({
    date: slot.getAttribute("data-date"),
    names: Array.from(slot.querySelectorAll(".menu-item-name"), (item) => item.textContent),
    mains: Array.from(slot.querySelectorAll(".menu-item-main"), (item) => item.textContent).filter(Boolean)
  })));
  expect(new Set(menus.flatMap(({ names }) => names)).size).toBe(50);
  for (const date of new Set(menus.map((menu) => menu.date))) {
    const mains = menus.filter((menu) => menu.date === date).flatMap((menu) => menu.mains);
    expect(new Set(mains).size).toBe(mains.length);
  }

  await page.reload();
  await dateInput.fill("2026-08-03");
  await taroButton(page, /^查看未来 31 天菜单$/).click();
  await expect(page.locator(".menu-slot")).toHaveCount(11);
});
