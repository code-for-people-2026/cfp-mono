import { expect, test, type Page } from "@playwright/test";

const taroButton = (page: Page, text: RegExp) => page.locator("taro-button-core:visible").filter({ hasText: text });

test("显式启用后纵向完成接龙预览、确认、重试与无地址订单", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const target = new Date(Date.now() + (150 + Date.now() % 100) * 86_400_000);
  const targetDate = target.toISOString().slice(0, 10);
  const deadline = new Date(target.getTime() - 86_400_000).toISOString().slice(0, 10);
  const offerings = [
    `接龙荤一-${suffix} 牛肉-${suffix} 荤`,
    `接龙荤二-${suffix} 猪肉-${suffix} 荤`,
    `接龙素一-${suffix} 青菜-${suffix} 素`,
    `接龙素二-${suffix} 豆腐-${suffix} 素`,
    `接龙汤-${suffix} 番茄-${suffix} 汤`
  ];

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜品$/).click();
  await page.getByRole("textbox", { name: "每行一道菜" }).fill(offerings.join("\n"));
  await taroButton(page, /^预览导入$/).click();
  await taroButton(page, /^确认导入$/).click();
  await taroButton(page, /^菜单$/).last().click();
  await page.getByRole("textbox", { name: "菜单起始日期" }).fill(targetDate);
  await taroButton(page, /^生成午餐$/).click();
  await expect(page.locator(".menu-slot").filter({ hasText: `${targetDate} 午餐` })).toBeVisible();
  await taroButton(page, /^预订批次$/).click();
  await page.getByRole("textbox", { name: "批次起始日期" }).fill(targetDate);
  await taroButton(page, /^查看餐次$/).click();
  const slot = page.locator(".batch-slot").filter({ hasText: `${targetDate} 午餐` });
  await slot.getByRole("textbox", { name: "价格（元）" }).fill("30");
  await slot.getByRole("textbox", { name: "截止时间" }).fill(`${deadline}T09:00`);
  await slot.locator("taro-button-core").filter({ hasText: /^开放预订$/ }).click();
  await taroButton(page, /^菜单$/).last().click();

  const weakEntry = taroButton(page, /^接龙导入（兜底）$/).last();
  await expect(weakEntry).toBeVisible();
  await weakEntry.click();
  await expect(page.getByText("接龙导入兜底", { exact: true })).toBeVisible();
  await expect(page.locator(".page-state")).toContainText("请粘贴接龙文本后预览");
  await page.getByRole("textbox", { name: "粘贴接龙文本" }).fill("无法解析的文本");
  await taroButton(page, /^预览接龙$/).click();
  await expect(page.locator(".page-state")).toContainText("接龙预览失败，请检查文本格式后重试");
  const text = `${targetDate} 午餐\n1. 王阿姨 2份\n2. 李叔 1份`;
  await page.getByRole("textbox", { name: "粘贴接龙文本" }).fill(text);
  await expect(taroButton(page, /^写入草稿订单$/)).toHaveCount(0);
  await taroButton(page, /^预览接龙$/).click();
  const preview = page.locator(".jielong-preview");
  await expect(preview.getByText(`${targetDate} 午餐`, { exact: true })).toBeVisible();
  await expect(preview.getByText("王阿姨 · 2 份 · ¥60.00", { exact: true })).toBeVisible();
  await expect(preview.getByText("合计 ¥90.00", { exact: true })).toBeVisible();
  const commit = preview.locator("taro-button-core").filter({ hasText: /^写入草稿订单$/ });
  await expect(commit).toHaveAttribute("disabled", "");
  await page.getByLabel("我已核对以上接龙预览").click();
  await expect(commit).not.toHaveAttribute("disabled", "");
  await commit.click();
  await expect(page.getByText("新增 2 单，已存在 0 单，共 2 单", { exact: true })).toBeVisible();
  await commit.click();
  await expect(page.getByText("新增 0 单，已存在 2 单，共 2 单", { exact: true })).toBeVisible();

  await taroButton(page, /^查看餐次订单$/).click();
  await page.getByRole("textbox", { name: "订单日期" }).fill(targetDate);
  await taroButton(page, /^查看午餐订单$/).click();
  for (const name of ["王阿姨", "李叔"]) {
    await expect(page.locator(".order-card").filter({ hasText: name })).toContainText("无地址");
  }
});
