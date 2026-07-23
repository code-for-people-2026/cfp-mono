import { expect, test, type Page } from "@playwright/test";

const taroButton = (page: Page, text: RegExp) => page.locator("taro-button-core:visible").filter({ hasText: text });

const enterOfferings = async (page: Page) => {
  await taroButton(page, /^开发登录$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/home\/index/);
  await taroButton(page, /^菜品$/).click();
  await expect(page.getByText("菜品池", { exact: true })).toBeVisible();
};

const menuItems = ["红烧肉", "香菇滑鸡", "清炒时蔬", "家常豆腐", "番茄蛋汤"].map((name, index) => ({
  offeringId: index + 1,
  nameSnapshot: name,
  mainIngredientSnapshot: null,
  categorySnapshot: index < 2 ? "meat" : index === 4 ? "soup" : "veg"
}));

const slot = (date: string, occasion: "lunch" | "dinner") => ({
  id: occasion === "lunch" ? 11 : 12,
  sellerId: 1,
  date,
  occasion,
  menuItems,
  orderStatus: occasion === "lunch" ? "open" : "closed",
  orderDeadline: occasion === "lunch" ? "2099-01-01T02:30:00.000Z" : "2020-01-01T08:00:00.000Z",
  priceCents: occasion === "lunch" ? 3000 : null,
  generatedAt: "2026-01-01T00:00:00.000Z"
});

test("未授权访问菜品页会回到登录", async ({ page }) => {
  await page.goto("/pages/merchant/home/index");
  await expect(page).toHaveURL(/pages\/merchant\/login\/index/);
  await page.goto("/pages/merchant/offerings/index");
  await expect(page).toHaveURL(/pages\/merchant\/login\/index/);
  await expect(taroButton(page, /^开发登录$/)).toBeVisible();
  await page.goto("/pages/merchant/menu/index");
  await expect(page).toHaveURL(/pages\/merchant\/login\/index/);
});

test("登录进入今日工作台，隔离部分失败并通过快捷入口导航", async ({ page }) => {
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const slots = [slot(today, "lunch"), slot(today, "dinner")];
  let dinnerAttempts = 0;
  let slotRequests = 0;
  await page.route("**/merchant/meal-slots?*", (route) => {
    slotRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs: slots }) });
  });
  await page.route("**/merchant/orders?*", (route) => {
    const occasion = new URL(route.request().url()).searchParams.get("occasion");
    if (occasion === "dinner" && dinnerAttempts++ === 0) return route.fulfill({ status: 500, body: "{}" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mealSlot: slots.find((item) => item.occasion === occasion),
        docs: occasion === "lunch" ? [{
          id: 31, sellerId: 1, mealSlotId: 11, customerProfileId: 21, status: "draft", source: "manual",
          displayName: "王阿姨", address: "3A-1201", quantity: 2, unitPriceCents: 3000, totalCents: 6000,
          paymentStatus: "unpaid", paidAt: null, deliveryStatus: "pending", deliveredAt: null,
          confirmedAt: null, canceledAt: null, note: null
        }] : [],
        summary: { confirmedOrders: 2, totalQuantity: 5, unpaid: 1, pendingDelivery: 2 }
      })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/home\/index/);
  await expect(page.getByText("桃子，今天好", { exact: true })).toBeVisible();
  await expect(page.getByText("已知有 1 笔待确认订单", { exact: true })).toBeVisible();
  await expect(page.locator(".home-meal-card").filter({ hasText: "今日午餐" })).toContainText("已确认 5 份");
  await expect(page.locator(".home-meal-card").filter({ hasText: "今日晚餐" })).toContainText("订单摘要加载失败");
  await taroButton(page, /^重新加载$/).click();
  await expect(page.getByText("订单摘要加载失败", { exact: true })).toHaveCount(0);
  await expect(page.getByText("有 1 笔待确认订单", { exact: true })).toBeVisible();
  await expect(page.getByText("商家默认价", { exact: true })).toBeVisible();
  await taroButton(page, /^菜品$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/offerings\/index/);
  await page.goto("/");
  await expect(page).toHaveURL(/pages\/merchant\/home\/index/);
  await taroButton(page, /^配送清单$/).click();
  await expect(page).toHaveURL(new RegExp(`date=${today}&occasion=lunch`));
  await expect(page.getByText("当前餐次：" + today + " 午餐", { exact: true })).toBeVisible();
  await page.goto("/pages/merchant/home/index");
  const requestsBeforeBack = slotRequests;
  await taroButton(page, /^预订批次$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/batches\/index/);
  await page.goBack();
  await expect.poll(() => slotRequests).toBeGreaterThan(requestsBeforeBack);
});

test("今日工作台整页失败后可重试为空餐次", async ({ page }) => {
  let attempts = 0;
  await page.route("**/merchant/meal-slots?*", (route) => route.fulfill(attempts++ === 0
    ? { status: 500, body: "{}" }
    : { status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] }) }));
  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await expect(page.getByText("今日数据加载失败", { exact: true })).toBeVisible();
  await taroButton(page, /^重试$/).click();
  await expect(page.getByText("尚未排菜单", { exact: true })).toHaveCount(2);
});

test("成员资格停用后显示明确提示并回到登录", async ({ page }) => {
  await page.route("**/merchant/meal-slots?*", async (route) => {
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
  await enterOfferings(page);
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
  await enterOfferings(page);
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
  await single.getByLabel(`换掉 ${firstName}`, { exact: true }).click();
  await expect(single.getByText(firstName, { exact: true })).toHaveCount(0);

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

test("配置餐次后创建、复制并关闭预订批次", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const target = new Date(Date.now() + (120 + Date.now() % 100) * 86_400_000);
  const targetDate = target.toISOString().slice(0, 10);
  const deadline = new Date(target.getTime() - 86_400_000).toISOString().slice(0, 10);
  const rows = [
    `批次荤一-${suffix} 牛肉-${suffix} 荤`,
    `批次荤二-${suffix} 猪肉-${suffix} 荤`,
    `批次素一-${suffix} 青菜-${suffix} 素`,
    `批次素二-${suffix} 豆腐-${suffix} 素`,
    `批次汤-${suffix} 番茄-${suffix} 汤`
  ];
  await page.goto("/");
  await enterOfferings(page);
  await page.getByRole("textbox", { name: "每行一道菜" }).fill(rows.join("\n"));
  await taroButton(page, /^预览导入$/).click();
  await taroButton(page, /^确认导入$/).click();
  await expect(page.getByText("新增 5 行，覆盖 0 行，跳过 0 行，失败 0 行")).toBeVisible();
  await taroButton(page, /^菜单$/).click();
  await page.getByRole("textbox", { name: "菜单起始日期" }).fill(targetDate);
  await taroButton(page, /^生成午餐$/).click();
  await expect(page.getByText(`${targetDate} 午餐`, { exact: true })).toBeVisible();
  await taroButton(page, /^预订批次$/).click();

  await page.getByRole("textbox", { name: "批次起始日期" }).fill(targetDate);
  const startedAt = Date.now();
  await taroButton(page, /^查看餐次$/).click();
  const slot = page.locator(".batch-slot").filter({ hasText: `${targetDate} 午餐` });
  await slot.getByRole("textbox", { name: "价格（元）" }).fill("28");
  await slot.getByRole("textbox", { name: "截止时间" }).fill(`${deadline}T09:00`);
  const configResponse = page.waitForResponse((response) =>
    response.url().includes("/booking-config") && response.request().method() === "PATCH");
  await slot.locator("taro-button-core").filter({ hasText: /^开放预订$/ }).click();
  expect((await configResponse).status()).toBe(200);
  const selectSlot = slot.getByLabel(`选择 ${targetDate} 午餐`);
  await expect(selectSlot).toBeEnabled();
  await selectSlot.click();
  await expect(page.getByText("已选择 1 个餐次", { exact: true })).toBeVisible();
  const createResponse = page.waitForResponse((response) =>
    response.url().endsWith("/merchant/booking-batches") && response.request().method() === "POST");
  await taroButton(page, /^创建预订批次$/).click();
  expect((await createResponse).status()).toBe(201);
  const batch = page.locator(".batch-card").filter({ hasText: `${targetDate} 午餐预订` });
  await expect(batch).toContainText("/pages/booking/index?batch=");
  await batch.getByLabel("复制分享 path").click();
  await expect(page.getByText("path 已复制", { exact: true })).toBeVisible();
  await batch.getByLabel("关闭预订批次").click();
  await taroButton(page, /^确认关闭批次$/).click();
  await expect(batch).toContainText("已关闭");
  expect(Date.now() - startedAt).toBeLessThan(60_000);
  await expect(page.getByText(/operator-token|sellerId|createdById/)).toHaveCount(0);
  await expect(page.getByLabel(/分享给朋友|原生分享/)).toHaveCount(0);
});

test("选择餐次后新建顾客资料、补草稿单、重复确认更新并修改", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const displayName = `订单顾客-${suffix}`;
  const address = `9C-${suffix}`;
  const rows = [
    `订单荤一-${suffix} 牛肉-${suffix} 荤`,
    `订单荤二-${suffix} 猪肉-${suffix} 荤`,
    `订单素一-${suffix} 青菜-${suffix} 素`,
    `订单素二-${suffix} 豆腐-${suffix} 素`,
    `订单汤-${suffix} 番茄-${suffix} 汤`
  ];

  await page.goto("/");
  await enterOfferings(page);
  await page.getByRole("textbox", { name: "每行一道菜" }).fill(rows.join("\n"));
  await taroButton(page, /^预览导入$/).click();
  await taroButton(page, /^确认导入$/).click();
  await expect(page.getByText("新增 5 行，覆盖 0 行，跳过 0 行，失败 0 行")).toBeVisible();

  await taroButton(page, /^菜单$/).click();
  await page.getByRole("textbox", { name: "菜单起始日期" }).fill("2026-09-21");
  await taroButton(page, /^生成午餐$/).click();
  await expect(page.getByText("2026-09-21 午餐", { exact: true })).toBeVisible();
  await taroButton(page, /^订单$/).click();

  await expect(page.getByText("餐次订单", { exact: true })).toBeVisible();
  await expect(page.locator(".page-state")).toContainText("请填写日期并查看午餐或晚餐订单");
  await page.getByRole("textbox", { name: "订单日期" }).fill("2099-01-01");
  await taroButton(page, /^查看午餐订单$/).click();
  await expect(page.locator(".page-state")).toContainText("餐次订单加载失败，请检查日期后重试");
  await page.getByRole("textbox", { name: "订单日期" }).fill("2026-09-21");
  await taroButton(page, /^查看午餐订单$/).click();
  await expect(page.locator(".page-state")).toContainText("当前餐次还没有订单，可在下方补录草稿");
  await expect(page.getByText("已确认 0 单，共 0 份；未付 0 单，待送 0 单", { exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "顾客称呼" }).fill(displayName);
  await page.getByRole("textbox", { name: "顾客地址" }).fill(address);
  await page.getByRole("spinbutton").first().fill("2");
  await page.getByRole("textbox", { name: "备注" }).fill("少辣");
  await taroButton(page, /^草稿补单$/).click();
  const orderCard = page.locator(".order-card").filter({ hasText: displayName });
  await expect(orderCard).toContainText("2 份");

  await page.getByRole("spinbutton").first().fill("3");
  await taroButton(page, /^草稿补单$/).click();
  await expect(taroButton(page, /^确认更新现有草稿$/)).toBeVisible();
  await page.getByRole("spinbutton").first().fill("4");
  await expect(taroButton(page, /^确认更新现有草稿$/)).toHaveCount(0);
  await taroButton(page, /^草稿补单$/).click();
  await expect(taroButton(page, /^确认更新现有草稿$/)).toBeVisible();
  await taroButton(page, /^确认更新现有草稿$/).click();
  await expect(orderCard).toContainText("4 份");

  await orderCard.getByLabel(`编辑 ${displayName}`).click();
  await page.locator('.edit-order-form input[type="number"]').fill("5");
  await page.getByRole("textbox", { name: "编辑地址" }).fill(`${address}-改`);
  await taroButton(page, /^保存草稿修改$/).click();
  await expect(orderCard).toContainText("5 份");
  await expect(orderCard).toContainText(`${address}-改`);

  await page.reload();
  await page.getByRole("textbox", { name: "订单日期" }).fill("2026-09-21");
  await taroButton(page, /^查看午餐订单$/).click();
  const reloadedOrderCard = page.locator(".order-card").filter({ hasText: displayName });
  await expect(reloadedOrderCard).toContainText("5 份");

  const mealSlotId = await page.locator(".orders-page").getAttribute("data-meal-slot-id");
  const foreign = await page.evaluate(async (targetMealSlotId) => {
    const tokenIn = (value: unknown): string => {
      if (typeof value === "string") {
        try {
          return tokenIn(JSON.parse(value));
        } catch {
          return "";
        }
      }
      if (typeof value !== "object" || value === null) return "";
      const record = value as Record<string, unknown>;
      if (typeof record.token === "string") return record.token;
      return Object.values(record).map(tokenIn).find(Boolean) ?? "";
    };
    let token = "";
    for (let index = 0; index < localStorage.length; index += 1) {
      const raw = localStorage.getItem(localStorage.key(index) ?? "");
      token ||= tokenIn(raw);
    }
    const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
    const response = await fetch("http://127.0.0.1:3311/merchant/orders", {
      method: "POST",
      headers,
      body: JSON.stringify({ mealSlotId: targetMealSlotId, customerProfileId: 999999999, quantity: 1 })
    });
    return { status: response.status, body: await response.json() as { error?: string } };
  }, mealSlotId);
  expect(foreign).toEqual({ status: 404, body: expect.objectContaining({ error: "customer-profile-not-found" }) });

  await reloadedOrderCard.getByLabel(`编辑 ${displayName}`).click();
  await page.getByRole("textbox", { name: "订单日期" }).fill("2026-09-22");
  await expect(page.locator(".edit-order-form")).toHaveCount(0);
  await expect(page.locator(".order-card")).toHaveCount(0);
  await expect(page.locator(".orders-page")).toHaveAttribute("data-meal-slot-id", "");

  await page.getByRole("textbox", { name: "订单日期" }).fill("2026-09-21");
  await taroButton(page, /^查看午餐订单$/).click();
  const lifecycleCard = page.locator(".order-card").filter({ hasText: displayName });
  await lifecycleCard.getByLabel(`确认 ${displayName}`).click();
  await expect(lifecycleCard).toContainText("业务：已确认；付款：未付；配送：待送");
  await expect(page.getByText("已确认 1 单，共 5 份；未付 1 单，待送 1 单", { exact: true })).toBeVisible();

  await lifecycleCard.getByLabel(`编辑 ${displayName}`).click();
  await page.locator('.edit-order-form input[type="number"]').fill("6");
  await taroButton(page, /^保存已确认订单修改$/).click();
  await expect(taroButton(page, /^确认影响并保存$/)).toBeVisible();
  await expect(lifecycleCard).toContainText("5 份");
  await taroButton(page, /^确认影响并保存$/).click();
  await expect(lifecycleCard).toContainText("6 份");
  await expect(page.getByText("已确认 1 单，共 6 份；未付 1 单，待送 1 单", { exact: true })).toBeVisible();

  await lifecycleCard.getByLabel(`标已付 ${displayName}`).click();
  await expect(lifecycleCard).toContainText("业务：已确认；付款：已付；配送：待送");
  await lifecycleCard.getByLabel(`标已送 ${displayName}`).click();
  await expect(lifecycleCard).toContainText("业务：已确认；付款：已付；配送：已送");
  await expect(page.getByText("已确认 1 单，共 6 份；未付 0 单，待送 0 单", { exact: true })).toBeVisible();

  await lifecycleCard.getByLabel(`取消 ${displayName}`).click();
  await taroButton(page, /^确认取消$/).click();
  await expect(lifecycleCard).toContainText("业务：已取消；付款：已付；配送：已送");
  await expect(page.getByText("已确认 0 单，共 0 份；未付 0 单，待送 0 单", { exact: true })).toBeVisible();

  const lifecycleOrderId = await lifecycleCard.getAttribute("data-order-id");
  const illegal = await page.evaluate(async (orderId) => {
    const tokenIn = (value: unknown): string => {
      if (typeof value === "string") {
        try {
          return tokenIn(JSON.parse(value));
        } catch {
          return "";
        }
      }
      if (typeof value !== "object" || value === null) return "";
      const record = value as Record<string, unknown>;
      if (typeof record.token === "string") return record.token;
      return Object.values(record).map(tokenIn).find(Boolean) ?? "";
    };
    let token = "";
    for (let index = 0; index < localStorage.length; index += 1) {
      token ||= tokenIn(localStorage.getItem(localStorage.key(index) ?? ""));
    }
    const response = await fetch(`http://127.0.0.1:3311/merchant/orders/${encodeURIComponent(orderId ?? "")}/mark-paid`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }
    });
    return { status: response.status, body: await response.json() as { error?: string } };
  }, lifecycleOrderId);
  expect(illegal).toEqual({ status: 409, body: expect.objectContaining({ error: "invalid-order-transition" }) });
  await expect(lifecycleCard).toContainText("业务：已取消；付款：已付；配送：已送");

  await lifecycleCard.getByLabel(`重提 ${displayName}`).click();
  await taroButton(page, /^确认重提$/).click();
  await expect(lifecycleCard).toContainText("业务：草稿；付款：未付；配送：待送");
  await expect(lifecycleCard).toContainText("6 份");

  await lifecycleCard.getByLabel(`确认 ${displayName}`).click();
  await expect(lifecycleCard).toContainText("业务：已确认；付款：未付；配送：待送");
  const secondName = `批量顾客-${suffix}`;
  const secondAddress = `1A-${suffix}`;
  await taroButton(page, /^新建顾客资料$/).click();
  await page.getByRole("textbox", { name: "顾客称呼" }).fill(secondName);
  await page.getByRole("textbox", { name: "顾客地址" }).fill(secondAddress);
  await page.getByRole("spinbutton").first().fill("2");
  await taroButton(page, /^草稿补单$/).click();
  const secondCard = page.locator(".order-card").filter({ hasText: secondName });
  await secondCard.getByLabel(`确认 ${secondName}`).click();
  await expect(secondCard).toContainText("业务：已确认；付款：未付；配送：待送");

  await lifecycleCard.getByLabel(`选择 ${displayName}`).click();
  await secondCard.getByLabel(`选择 ${secondName}`).click();
  const secondOrderId = await secondCard.getAttribute("data-order-id");
  const canceledDuringBulk = await page.evaluate(async (orderId) => {
    const tokenIn = (value: unknown): string => {
      if (typeof value === "string") {
        try {
          return tokenIn(JSON.parse(value));
        } catch {
          return "";
        }
      }
      if (typeof value !== "object" || value === null) return "";
      const record = value as Record<string, unknown>;
      if (typeof record.token === "string") return record.token;
      return Object.values(record).map(tokenIn).find(Boolean) ?? "";
    };
    let token = "";
    for (let index = 0; index < localStorage.length; index += 1) {
      token ||= tokenIn(localStorage.getItem(localStorage.key(index) ?? ""));
    }
    const response = await fetch(`http://127.0.0.1:3311/merchant/orders/${encodeURIComponent(orderId ?? "")}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }
    });
    return response.status;
  }, secondOrderId);
  expect(canceledDuringBulk).toBe(200);

  await taroButton(page, /^批量标已送（2）$/).click();
  await expect(lifecycleCard).toContainText("业务：已确认；付款：未付；配送：已送");
  await expect(secondCard).toContainText("业务：已取消；付款：未付；配送：待送");
  await expect(page.getByText(`订单 ${secondOrderId}：失败（invalid-order-transition）`, { exact: true })).toBeVisible();

  const checklist = page.locator(".order-checklist");
  await expect(checklist).toContainText("餐次：2026-09-21 午餐");
  await expect(checklist).toContainText("总份数：6");
  await expect(checklist).toContainText(`${address}-改｜${displayName}｜6 份`);
  await expect(checklist).not.toContainText(secondName);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await taroButton(page, /^复制备餐\/送餐清单$/).click();
  await expect(page.getByText("清单已复制", { exact: true })).toBeVisible();
});
