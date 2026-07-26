import { expect, test, type Page } from "@playwright/test";

const taroButton = (page: Page, text: RegExp) => page.locator("taro-button-core:visible").filter({ hasText: text });
const offeringImportInput = (page: Page) => page.locator(".import-card textarea");

const enterOfferings = async (page: Page) => {
  await taroButton(page, /^开发登录$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/home\/index/);
  await taroButton(page, /^菜品$/).click();
  await expect(page.getByText("菜品库", { exact: true })).toBeVisible();
};

const enterManageOfferings = async (page: Page) => {
  await enterOfferings(page);
  const manageButton = taroButton(page, /^管理$/);
  await expect(manageButton).not.toHaveAttribute("disabled", "");
  await manageButton.click();
  await expect(page.getByText("启用中", { exact: true })).toBeVisible();
  await expect(page.getByText("已停用", { exact: true })).toBeVisible();
};

const openOfferingImport = async (page: Page) => {
  await enterManageOfferings(page);
  await taroButton(page, /^批量导入$/).click();
  await expect(offeringImportInput(page)).toBeVisible();
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
  const slots = [slot(today, "lunch"), {
    ...slot(today, "dinner"), orderStatus: "draft", orderDeadline: null, priceCents: null
  }];
  let dinnerAttempts = 0;
  let lunchAttempts = 0;
  let slotRequests = 0;
  await page.route("**/merchant/meal-slots?*", (route) => {
    slotRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs: slots }) });
  });
  await page.route("**/merchant/orders?*", (route) => {
    const occasion = new URL(route.request().url()).searchParams.get("occasion");
    if (occasion === "dinner" && dinnerAttempts++ === 0) return route.fulfill({ status: 500, body: "{}" });
    if (occasion === "lunch") lunchAttempts += 1;
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
  await expect(page.locator(".home-brand").getByText("街坊味", { exact: true })).toBeVisible();
  await expect(page.getByText(/^桃子，(早上|中午|下午|晚上)好$/)).toBeVisible();
  await expect(page.locator(".home-mark")).toHaveCount(0);
  await expect(page.getByText("已知有 1 笔待确认订单", { exact: true })).toBeVisible();
  const lunchCard = page.locator(".home-meal-card").filter({ hasText: "今日午餐" });
  const dinnerCard = page.locator(".home-meal-card").filter({ hasText: "今日晚餐" });
  await expect(lunchCard).toContainText("红烧肉 · 香菇滑鸡 · 清炒时蔬等 4菜1汤");
  await expect(lunchCard).toContainText("已订 5 份");
  await expect(page.locator(".home-meal-card").filter({ hasText: "今日晚餐" })).toContainText("订单摘要加载失败");
  await taroButton(page, /^重新加载$/).click();
  await expect(page.getByText("订单摘要加载失败", { exact: true })).toHaveCount(0);
  expect(lunchAttempts).toBe(1);
  await expect(page.getByText("有 1 笔待确认订单", { exact: true })).toBeVisible();
  await expect(dinnerCard).toContainText("待开放");
  await expect(dinnerCard).toContainText("菜单已排好，价格与截止时间还未确认");
  await expect(dinnerCard).toContainText("红烧肉 · 香菇滑鸡 · 清炒时蔬等 4菜1汤");
  await expect(dinnerCard).toContainText("已订 5 份 · 2 单已确认 · 1 单未付 · 2 单待送");
  await expect(page.getByText("商家默认价", { exact: true })).toBeVisible();
  await page.locator(".home-pending-notice").click();
  await expect(page).toHaveURL(new RegExp(`date=${today}&occasion=lunch`));
  await page.goto("/pages/merchant/home/index");
  await dinnerCard.locator(".home-card-title").click();
  await expect(page).toHaveURL(new RegExp(`date=${today}&occasion=dinner`));
  await page.goto("/pages/merchant/home/index");
  await taroButton(page, /^菜品$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/offerings\/index/);
  await expect(taroButton(page, /^今日$/)).toBeVisible();
  await taroButton(page, /^菜单$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/menu\/index/);
  await expect(taroButton(page, /^今日$/)).toBeVisible();
  await taroButton(page, /^订单$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/orders\/index/);
  await taroButton(page, /^今日$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/home\/index/);
  await taroButton(page, /^排本周菜单$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/menu\/index/);
  await taroButton(page, /^今日$/).click();
  await taroButton(page, /^查看订单$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/orders\/index$/);
  await taroButton(page, /^今日$/).click();
  await taroButton(page, /^配送清单$/).click();
  await expect(page).toHaveURL(new RegExp(`date=${today}&occasion=lunch`));
  await expect(page.getByText("当前餐次：" + today + " 午餐", { exact: true })).toBeVisible();
  await page.goto("/pages/merchant/home/index");
  const requestsBeforeBack = slotRequests;
  await taroButton(page, /^开放预订$/).click();
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
  await expect(page.getByText("未排菜单", { exact: true })).toHaveCount(2);
  await expect(page.locator(".home-pending-notice")).toHaveCount(0);
  await expect(taroButton(page, /^先排菜单$/)).toHaveCount(2);
  await taroButton(page, /^配送清单$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/orders\/index$/);
  expect(new URL(page.url()).search).toBe("");
});

test("截止和关闭餐次仍可手动加单，顾客端订单冲突只导向既有订单", async ({ page }) => {
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const slots = [
    { ...slot(today, "lunch"), orderStatus: "open", orderDeadline: "2020-01-01T00:00:00.000Z" },
    { ...slot(today, "dinner"), orderStatus: "closed", orderDeadline: "2020-01-01T00:00:00.000Z" }
  ];
  const profiles = [
    { id: 23, sellerId: 1, displayName: "顾客端顾客", address: "8B-801", active: true }
  ];
  const customerOrder = {
    id: 33, sellerId: 1, mealSlotId: 12, customerProfileId: 23, status: "draft", source: "customer-card",
    displayName: "顾客端顾客", address: "8B-801", quantity: 1, unitPriceCents: 3000, totalCents: 3000,
    paymentStatus: "unpaid", paidAt: null, deliveryStatus: "pending", deliveredAt: null,
    confirmedAt: null, canceledAt: null, note: null
  };
  const createdMealSlotIds: Array<string | number> = [];
  let nextOrderId = 100;
  let profileRequests = 0;
  await page.route("**/merchant/meal-slots?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: slots })
  }));
  await page.route("**/merchant/customer-profiles?*", (route) => route.fulfill(profileRequests++ === 0
    ? { status: 500, contentType: "application/json", body: JSON.stringify({ error: "unavailable", message: "暂不可用" }) }
    : { status: 200, contentType: "application/json", body: JSON.stringify({ docs: profiles }) }));
  await page.route("**/merchant/orders**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/merchant/orders")) return route.continue();
    const occasion = url.searchParams.get("occasion") === "dinner" ? "dinner" : "lunch";
    const mealSlot = slots.find((item) => item.occasion === occasion)!;
    if (request.method() === "GET") {
      if (url.searchParams.get("date") !== today) return route.fulfill({
        status: 404, contentType: "application/json", body: JSON.stringify({ error: "meal-slot-not-found", message: "餐次不存在" })
      });
      const docs = occasion === "dinner" ? [customerOrder] : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        mealSlot, docs, summary: { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 }
      }) });
    }
    const input = request.postDataJSON() as { mealSlotId: string | number; customerProfileId?: string | number; newProfile?: typeof profiles[number]; quantity: number; note: string | null };
    if (input.customerProfileId === 23) return route.fulfill({
      status: 409, contentType: "application/json", body: JSON.stringify({
        error: "order-exists", message: "订单已存在，请确认更新", existing: { id: 33, status: "draft", quantity: 1 }
      })
    });
    createdMealSlotIds.push(input.mealSlotId);
    const profile = {
      id: nextOrderId,
      sellerId: 1,
      active: true,
      displayName: input.newProfile?.displayName ?? "",
      address: input.newProfile?.address ?? ""
    };
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      profile,
      doc: { ...customerOrder, id: nextOrderId++, mealSlotId: input.mealSlotId, customerProfileId: profile.id,
        source: "manual", displayName: profile.displayName, address: profile.address, quantity: input.quantity,
        totalCents: input.quantity * 3000, note: input.note }
    }) });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  const lunchCard = page.locator(".home-meal-card").filter({ hasText: "今日午餐" });
  const dinnerCard = page.locator(".home-meal-card").filter({ hasText: "今日晚餐" });
  await lunchCard.locator("taro-button-core").filter({ hasText: /^手动加单$/ }).click();
  await expect(page.getByText("已截止", { exact: true })).toBeVisible();
  await expect(page.getByText("顾客预订已截止，商家仍可手动补录私信订单。", { exact: true })).toBeVisible();
  await expect(page.getByText("顾客资料加载失败，可直接新建资料或重试搜索。", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "顾客称呼" }).fill("截止顾客");
  await page.getByRole("textbox", { name: "顾客地址" }).fill("7A-701");
  await page.getByRole("spinbutton").fill("2");
  await taroButton(page, /^保存待确认订单$/).click();
  await expect(page).toHaveURL(new RegExp(`pages/merchant/orders/index\\?date=${today}&occasion=lunch`));

  slots[0]!.orderDeadline = "2099-01-01T00:00:00.000Z";
  await page.goto("/pages/merchant/home/index");
  await lunchCard.locator("taro-button-core").filter({ hasText: /^手动加单$/ }).click();
  await expect(page.getByText("预订中", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "顾客称呼" }).fill("开放顾客");
  await page.getByRole("textbox", { name: "顾客地址" }).fill("7A-703");
  await taroButton(page, /^保存待确认订单$/).click();

  await page.goto("/pages/merchant/home/index");
  await dinnerCard.locator("taro-button-core").filter({ hasText: /^手动加单$/ }).click();
  await expect(page.getByText("已关闭", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "顾客称呼" }).fill("关闭顾客");
  await page.getByRole("textbox", { name: "顾客地址" }).fill("7A-702");
  await taroButton(page, /^保存待确认订单$/).click();
  expect(createdMealSlotIds).toEqual([11, 11, 12]);

  await page.goto(`/pages/merchant/orders/add/index?date=${today}&occasion=dinner`);
  await page.getByRole("textbox", { name: "搜索顾客" }).fill("顾客端");
  await taroButton(page, /^搜索$/).click();
  await page.locator(".manual-profile").filter({ hasText: "顾客端顾客" }).click();
  await taroButton(page, /^保存待确认订单$/).click();
  await expect(page.getByText("该顾客已有顾客端订单，不能改写为手动订单。", { exact: true })).toBeVisible();
  await taroButton(page, /^查看顾客端既有订单$/).click();
  await expect(page).toHaveURL(new RegExp(`pages/merchant/orders/index\\?date=${today}&occasion=dinner`));

  await page.goto("/pages/merchant/orders/add/index?date=2099-01-01&occasion=lunch");
  await expect(page.getByText("没有找到这个餐次，请先排菜单。", { exact: true })).toBeVisible();
  await expect(taroButton(page, /^保存待确认订单$/)).toHaveCount(0);
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

test("菜品库默认浏览启用菜并可进入管理和批量导入", async ({ page }) => {
  const docs = [
    { id: 881, sellerId: 1, name: "浏览荤菜", mainIngredient: "牛肉", category: "meat", active: true },
    { id: 882, sellerId: 1, name: "浏览素菜", mainIngredient: "菜心", category: "veg", active: true },
    { id: 883, sellerId: 1, name: "浏览汤", mainIngredient: null, category: "soup", active: true },
    { id: 884, sellerId: 1, name: "停用菜", mainIngredient: null, category: "veg", active: false }
  ];
  await page.route("**/merchant/offerings?active=all", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs })
  }));
  await page.route("**/merchant/offerings/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const id = Number(new URL(route.request().url()).pathname.split("/").at(-1));
    const offering = docs.find((item) => item.id === id);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ doc: { ...offering, active: false } })
    });
  });

  await page.goto("/");
  await enterOfferings(page);
  await expect(page.getByText("常做的菜", { exact: true })).toBeVisible();
  await expect(taroButton(page, /^管理$/)).toBeVisible();
  for (const label of ["全部", "荤菜", "素菜", "汤"]) {
    await expect(taroButton(page, new RegExp(`^${label}$`))).toBeVisible();
  }
  await expect(page.getByText("浏览荤菜", { exact: true })).toBeVisible();
  await expect(page.getByText("停用菜", { exact: true })).toHaveCount(0);
  await page.getByLabel("停用 浏览荤菜").click();
  await expect(page.getByText("浏览荤菜", { exact: true })).toHaveCount(0);
  await taroButton(page, /^素菜$/).click();
  await expect(page.getByText("浏览素菜", { exact: true })).toBeVisible();

  await taroButton(page, /^管理$/).click();
  await expect(taroButton(page, /^完成$/)).toBeVisible();
  await expect(page.getByText("启用中", { exact: true })).toBeVisible();
  await expect(page.getByText("已停用", { exact: true })).toBeVisible();
  await expect(page.getByText("停用菜", { exact: true })).toBeVisible();
  await taroButton(page, /^批量导入$/).click();
  await expect(page.getByText("批量导入菜品", { exact: true })).toBeVisible();
  const importInput = offeringImportInput(page);
  await expect(importInput).toBeVisible();
  await expect(importInput).toHaveAttribute(
    "placeholder",
    "每行：菜名 [主料] 分类\n例如：\n红烧肉 猪肉 荤\n清炒时蔬 素"
  );
  await taroButton(page, /^收起导入$/).click();
  await expect(offeringImportInput(page)).toHaveCount(0);

  await taroButton(page, /^新增菜品$/).click();
  await expect(page.getByRole("textbox", { name: "菜名" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "主料（可不填）" })).toBeVisible();
  await taroButton(page, /^取消$/).click();
  await expect(page.getByRole("textbox", { name: "菜名" })).toHaveCount(0);
});

test("首次加载失败时禁止进入管理", async ({ page }) => {
  await page.route("**/merchant/offerings?active=all", (route) => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ error: "load-failed" })
  }));

  await page.goto("/");
  await enterOfferings(page);
  await expect(page.getByText("菜品加载失败", { exact: true })).toBeVisible();
  await expect(taroButton(page, /^管理$/)).toHaveAttribute("disabled", "");
  await expect(taroButton(page, /^新增菜品$/)).toHaveCount(0);
});

test("保存菜品期间不能退出管理或清空表单", async ({ page }) => {
  let releaseSave!: () => void;
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route("**/merchant/offerings?active=all", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] })
  }));
  await page.route("**/merchant/offerings", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await saveGate;
    await route.fulfill({
      status: 500, contentType: "application/json", body: JSON.stringify({ error: "save-failed" })
    });
  });

  await page.goto("/");
  await enterManageOfferings(page);
  await taroButton(page, /^新增菜品$/).click();
  const nameInput = page.getByRole("textbox", { name: "菜名" });
  await nameInput.fill("待保存菜");
  await taroButton(page, /^新增菜品$/).click();
  await expect(taroButton(page, /^完成$/)).toHaveAttribute("disabled", "");
  await expect(nameInput).toHaveValue("待保存菜");

  releaseSave();
  await expect(page.getByText("菜品保存失败", { exact: true })).toBeVisible();
  await expect(nameInput).toHaveValue("待保存菜");
  await expect(taroButton(page, /^完成$/)).not.toHaveAttribute("disabled", "");
});

test("不同菜品的启停请求独立锁定并按各自响应完成", async ({ page }) => {
  const docs = [
    { id: 901, sellerId: 1, name: "并发菜A", mainIngredient: "牛肉", category: "meat", active: true },
    { id: 902, sellerId: 1, name: "并发菜B", mainIngredient: "青菜", category: "veg", active: true }
  ];
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const patchRequests: number[] = [];

  await page.route("**/merchant/offerings?active=all", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs })
  }));
  await page.route("**/merchant/offerings/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const id = Number(new URL(route.request().url()).pathname.split("/").at(-1));
    patchRequests.push(id);
    await (id === 901 ? firstGate : secondGate);
    const target = docs.find((item) => item.id === id);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ doc: { ...target, active: false } })
    });
  });

  await page.goto("/");
  await enterManageOfferings(page);
  await page.getByLabel("停用 并发菜A").click();
  await page.getByLabel("停用 并发菜B").click();
  await expect.poll(() => patchRequests).toEqual([901, 902]);
  await expect(page.getByLabel("停用 并发菜A")).toHaveAttribute("disabled", "true");
  await expect(page.getByLabel("停用 并发菜B")).toHaveAttribute("disabled", "true");

  releaseFirst();
  await expect(page.getByLabel("恢复 并发菜A")).toBeVisible();
  await expect(page.getByLabel("停用 并发菜B")).toHaveAttribute("disabled", "true");
  releaseSecond();
  await expect(page.getByLabel("恢复 并发菜B")).toBeVisible();
});

test("编辑菜品保持原有列表顺序", async ({ page }) => {
  const docs = [
    { id: 911, sellerId: 1, name: "顺序菜A", mainIngredient: null, category: "meat", active: true },
    { id: 912, sellerId: 1, name: "顺序菜B", mainIngredient: null, category: "veg", active: true },
    { id: 913, sellerId: 1, name: "顺序菜C", mainIngredient: null, category: "soup", active: true }
  ];
  await page.route("**/merchant/offerings?active=all", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs })
  }));
  await page.route("**/merchant/offerings/912", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const body = route.request().postDataJSON() as { name: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ doc: { ...docs[1], name: body.name } })
    });
  });

  await page.goto("/");
  await enterManageOfferings(page);
  const editedCard = page.locator(".offering-card").filter({ hasText: "顺序菜B" });
  await page.getByLabel("编辑 顺序菜B").click();
  await expect(editedCard.locator("xpath=following-sibling::*[1]"))
    .toHaveClass(/offering-sheet-backdrop/);
  await page.getByRole("textbox", { name: "菜名" }).fill("顺序菜B-改");
  await taroButton(page, /^保存修改$/).click();

  const editLabels = await page.locator('[aria-label^="编辑 顺序菜"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-label"))
  );
  expect(editLabels).toEqual(["编辑 顺序菜A", "编辑 顺序菜B-改", "编辑 顺序菜C"]);
});

test("修改导入原文后旧预览响应不能覆盖新预览", async ({ page }) => {
  let releaseOldPreview!: () => void;
  const oldPreviewGate = new Promise<void>((resolve) => { releaseOldPreview = resolve; });
  let previewRequests = 0;
  await page.route("**/merchant/offerings?active=all", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] })
  }));
  await page.route("**/merchant/offerings/import/preview", async (route) => {
    previewRequests += 1;
    const current = previewRequests;
    if (current === 1) await oldPreviewGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [], summary: { ready: current, conflict: 0, invalid: 0 } })
    });
  });

  await page.goto("/");
  await openOfferingImport(page);
  const input = offeringImportInput(page);
  await input.fill("旧预览菜 素");
  await taroButton(page, /^预览导入$/).click();
  await expect.poll(() => previewRequests).toBe(1);
  await input.fill("当前预览菜 汤");
  await taroButton(page, /^预览导入$/).click();
  await expect(page.getByText("可新增 2 行，重名 0 行，错误 0 行", { exact: true })).toBeVisible();

  releaseOldPreview();
  await expect(page.getByText("可新增 2 行，重名 0 行，错误 0 行", { exact: true })).toBeVisible();
  await expect(page.getByText("可新增 1 行，重名 0 行，错误 0 行", { exact: true })).toHaveCount(0);
});

test("同一原文的旧预览不能清除最新冲突选择", async ({ page }) => {
  let releaseOldPreview!: () => void;
  const oldPreviewGate = new Promise<void>((resolve) => { releaseOldPreview = resolve; });
  let previewRequests = 0;
  let oldPreviewFinished = false;
  let commitInput: { text: string; conflicts: Array<{ line: number; action: string }> } | null = null;
  const conflictPreview = {
    rows: [{
      line: 1,
      raw: "重名菜 素",
      parsed: { name: "重名菜", mainIngredient: null, category: "veg" },
      status: "conflict",
      existingId: 941,
      defaultAction: "skip"
    }],
    summary: { ready: 0, conflict: 1, invalid: 0 }
  };
  await page.route("**/merchant/offerings?active=all", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] })
  }));
  await page.route("**/merchant/offerings/import/preview", async (route) => {
    const current = ++previewRequests;
    if (current === 1) await oldPreviewGate;
    await route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(conflictPreview)
    });
    if (current === 1) oldPreviewFinished = true;
  });
  await page.route("**/merchant/offerings/import/commit", (route) => {
    commitInput = route.request().postDataJSON() as typeof commitInput;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ line: 1, status: "overwritten", id: 941 }],
        summary: { created: 0, overwritten: 1, skipped: 0, failed: 0 }
      })
    });
  });

  await page.goto("/");
  await openOfferingImport(page);
  await offeringImportInput(page).fill("重名菜 素");
  await taroButton(page, /^预览导入$/).click();
  await expect.poll(() => previewRequests).toBe(1);
  await taroButton(page, /^预览导入$/).click();
  await expect(page.getByLabel("覆盖第 1 行")).toBeVisible();
  await page.getByLabel("覆盖第 1 行").click();

  releaseOldPreview();
  await expect.poll(() => oldPreviewFinished).toBe(true);
  await taroButton(page, /^确认导入$/).click();
  await expect.poll(() => commitInput).toEqual({
    text: "重名菜 素",
    conflicts: [{ line: 1, action: "overwrite" }]
  });
});

test("确认导入期间锁定原文和冲突选择", async ({ page }) => {
  let releaseCommit!: () => void;
  const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
  let releaseRepeatedPreview!: () => void;
  const repeatedPreviewGate = new Promise<void>((resolve) => { releaseRepeatedPreview = resolve; });
  let previewRequests = 0;
  let commitInput: { text: string; conflicts: Array<{ line: number; action: string }> } | null = null;
  await page.route("**/merchant/offerings?active=all", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] })
  }));
  await page.route("**/merchant/offerings/import/preview", async (route) => {
    previewRequests += 1;
    if (previewRequests === 2) await repeatedPreviewGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(previewRequests === 1 ? {
        rows: [{
          line: 1,
          raw: "重名菜 素",
          parsed: { name: "重名菜", mainIngredient: null, category: "veg" },
          status: "conflict",
          existingId: 931,
          defaultAction: "skip"
        }],
        summary: { ready: 0, conflict: 1, invalid: 0 }
      } : {
        rows: [], summary: { ready: 2, conflict: 0, invalid: 0 }
      })
    });
  });
  await page.route("**/merchant/offerings/import/commit", async (route) => {
    commitInput = route.request().postDataJSON() as typeof commitInput;
    await commitGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ line: 1, status: "overwritten", id: 931 }],
        summary: { created: 0, overwritten: 1, skipped: 0, failed: 0 }
      })
    });
  });

  await page.goto("/");
  await openOfferingImport(page);
  const input = offeringImportInput(page);
  await input.fill("重名菜 素");
  await taroButton(page, /^预览导入$/).click();
  const overwrite = page.getByLabel("覆盖第 1 行");
  await overwrite.click();
  await taroButton(page, /^预览导入$/).click();
  await expect.poll(() => previewRequests).toBe(2);
  await taroButton(page, /^确认导入$/).click();

  await expect.poll(() => commitInput).toEqual({
    text: "重名菜 素",
    conflicts: [{ line: 1, action: "overwrite" }]
  });
  await expect(input).toBeDisabled();
  await expect(input).toHaveValue("重名菜 素");
  await expect(overwrite).toHaveAttribute("disabled", "");

  releaseCommit();
  await expect(page.getByText("新增 0 行，覆盖 1 行，跳过 0 行，失败 0 行", { exact: true })).toBeVisible();
  await expect(input).toBeEnabled();
  await expect(overwrite).not.toHaveAttribute("disabled", "");
  await expect(taroButton(page, /^确认导入$/)).toHaveAttribute("disabled", "");

  releaseRepeatedPreview();
  await expect(page.getByText("可新增 2 行，重名 0 行，错误 0 行", { exact: true })).toHaveCount(0);
  await expect(page.getByText("新增 0 行，覆盖 1 行，跳过 0 行，失败 0 行", { exact: true })).toBeVisible();
});

test("导入提交失败后保留原文并要求重新预览", async ({ page }) => {
  await page.route("**/merchant/offerings?active=all", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] })
  }));
  await page.route("**/merchant/offerings/import/preview", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ rows: [], summary: { ready: 1, conflict: 0, invalid: 0 } })
  }));
  await page.route("**/merchant/offerings/import/commit", (route) => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ error: "unavailable" })
  }));

  await page.goto("/");
  await openOfferingImport(page);
  const input = offeringImportInput(page);
  await input.fill("待重试菜 素");
  await taroButton(page, /^预览导入$/).click();
  await expect(taroButton(page, /^确认导入$/)).toBeVisible();
  await taroButton(page, /^确认导入$/).click();

  await expect(page.getByText("导入提交失败", { exact: true })).toBeVisible();
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("待重试菜 素");
  await expect(taroButton(page, /^确认导入$/)).toHaveCount(0);
  await expect(taroButton(page, /^预览导入$/)).not.toHaveAttribute("disabled", "");
});

test("dev login 后完成菜品 CRUD 与 import preview/commit", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const original = `测试菜-${suffix}`;
  const renamed = `改名菜-${suffix}`;
  const imported = `导入菜-${suffix}`;

  await page.goto("/");
  const loginStartedAt = Date.now();
  await enterManageOfferings(page);
  expect(Date.now() - loginStartedAt).toBeLessThan(30_000);

  await taroButton(page, /^新增菜品$/).click();
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
  await expect(page.getByText("已停用", { exact: true })).toBeVisible();
  await page.getByLabel(`恢复 ${renamed}`).click();
  await expect(page.getByLabel(`停用 ${renamed}`)).toBeVisible();

  await taroButton(page, /^批量导入$/).click();
  await offeringImportInput(page).fill(`${renamed} 牛肉 荤\n${imported} 青菜 素\n坏数据`);
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
  await offeringImportInput(page).fill(fiftyRows);
  await expect(taroButton(page, /^确认导入$/)).toHaveCount(0);
  const previewStartedAt = Date.now();
  await taroButton(page, /^预览导入$/).click();
  await expect(page.getByText("可新增 50 行，重名 0 行，错误 0 行")).toBeVisible();
  expect(Date.now() - previewStartedAt).toBeLessThan(2_000);
});

test("菜单页自动加载五日工作周并在开放餐次截止时主动重算", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:59:55.000Z") });
  const docs = [
    { ...slot("2026-07-21", "lunch"), id: 101, orderStatus: "draft", orderDeadline: null },
    { ...slot("2026-07-22", "lunch"), id: 102, orderStatus: "open", orderDeadline: "2026-07-22T02:00:00.000Z" }
  ];
  const ranges: string[] = [];
  await page.route("**/merchant/meal-slots?*", (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    ranges.push(`${from}:${to}`);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ docs: docs.filter(({ date }) => date >= from && date <= to) })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  const startedAt = Date.now();
  await taroButton(page, /^菜单$/).click();
  await expect(page.getByText("本周菜单", { exact: true })).toBeVisible();
  await expect(page.getByText("7月20日－24日", { exact: true })).toBeVisible();
  await expect(page.locator(".menu-day")).toHaveCount(5);
  expect(Date.now() - startedAt).toBeLessThan(3_000);

  await expect(page.locator(".menu-day.selected")).toContainText("周三");
  await expect(page.locator(".menu-meal-card")).toHaveCount(2);
  await expect(page.locator(".menu-meal-card").filter({ hasText: "午餐" })).toContainText("预订中");
  await expect(page.locator(".menu-meal-card").filter({ hasText: "晚餐" })).toContainText("未排菜单");
  await expect(taroButton(page, /^查看预订与分享$/)).toBeVisible();

  const requestCount = ranges.length;
  await page.locator(".menu-day").filter({ hasText: "周二" }).click();
  await expect(page.locator(".menu-meal-card").filter({ hasText: "午餐" })).toContainText("待设置");
  await expect(page.locator(".menu-meal-card").filter({ hasText: "晚餐" })).toContainText("未排菜单");
  expect(ranges).toHaveLength(requestCount);

  await page.locator(".menu-day").filter({ hasText: "周三" }).click();
  await page.clock.fastForward(5_000);
  await expect(page.locator(".menu-meal-card").filter({ hasText: "午餐" })).toContainText("已截止");
  expect(ranges).toContain("2026-07-20:2026-07-24");

  const requestsBeforeReturn = ranges.length;
  await page.locator(".menu-day").filter({ hasText: "周二" }).click();
  await page.locator(".menu-meal-card").filter({ hasText: "午餐" })
    .locator("taro-button-core").filter({ hasText: /^设置价格与截止时间$/ }).click();
  await expect(page).toHaveURL(/pages\/merchant\/batches\/index/);
  await taroButton(page, /^返回菜单$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/menu\/index/);
  await expect.poll(() => ranges.length).toBeGreaterThan(requestsBeforeReturn);
});

test("菜单工作周以后发请求为准并在失败刷新时保留数据", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  let currentAttempts = 0;
  let releaseInitialLoad!: () => void;
  const initialLoad = new Promise<void>((resolve) => { releaseInitialLoad = resolve; });
  let releaseSlowWeek!: () => void;
  const slowWeek = new Promise<void>((resolve) => { releaseSlowWeek = resolve; });
  let releaseRefresh!: () => void;
  const refresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  let releaseStaleRefresh!: () => void;
  const staleRefresh = new Promise<void>((resolve) => { releaseStaleRefresh = resolve; });
  let releaseConflict!: () => void;
  const conflict = new Promise<void>((resolve) => { releaseConflict = resolve; });
  let augustRequests = 0;
  await page.route("**/merchant/booking-batches", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] })
  }));
  await page.route("**/merchant/meal-slots?*", async (route) => {
    const from = new URL(route.request().url()).searchParams.get("from");
    if (from === "2026-07-20") {
      currentAttempts += 1;
      if (currentAttempts === 1) await initialLoad;
      return route.fulfill(currentAttempts === 2
        ? { status: 500, body: "{}" }
        : { status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] }) });
    }
    if (from === "2026-07-27") {
      await slowWeek;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ docs: [{ ...slot("2026-07-27", "lunch"), id: 201 }] })
      });
    }
    if (from === "2026-08-03") {
      augustRequests += 1;
      if (augustRequests === 2) {
        await refresh;
        return route.fulfill({ status: 500, body: "{}" });
      }
      // 进入配置页会自动加载一次工作周，返回刷新后下一次手动刷新才是待淘汰旧读取。
      if (augustRequests === 5) await staleRefresh;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          docs: [{ ...slot("2026-08-03", "lunch"), id: 301, orderStatus: "draft", orderDeadline: null }]
        })
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] }) });
  });
  let generationRequests = 0;
  await page.route("**/merchant/meal-slots/generate-menus", async (route) => {
    generationRequests += 1;
    if (generationRequests > 1) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          docs: [{
            ...slot("2026-08-03", "lunch"),
            id: 301,
            orderStatus: "draft",
            orderDeadline: null,
            menuItems: menuItems.map((item, index) => index === 0 ? { ...item, nameSnapshot: "新菜单" } : item)
          }],
          relaxedRules: []
        })
      });
    }
    await conflict;
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "meal-slots-exist",
        message: "目标餐次已有菜单，请确认覆盖",
        existingTargets: [{ date: "2026-07-22", occasion: "lunch" }]
      })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  await expect(page.getByText("正在加载工作周菜单", { exact: true })).toBeVisible();
  await taroButton(page, /^刷新$/).click();
  await expect(page.getByText("菜单加载失败", { exact: true })).toBeVisible();
  releaseInitialLoad();
  await expect(page.getByText("菜单加载失败", { exact: true })).toBeVisible();
  await taroButton(page, /^重试$/).click();
  await expect(page.getByText("7月20日－24日", { exact: true })).toBeVisible();

  const currentMenu = page.locator(".menu-page:visible");
  await currentMenu.locator(".menu-meal-card").filter({ hasText: "午餐" })
    .locator("taro-button-core").filter({ hasText: /^生成午餐$/ }).click();

  await currentMenu.getByLabel("下一周").click();
  await currentMenu.getByLabel("下一周").click();
  await expect(currentMenu.getByText("8月3日－7日", { exact: true })).toBeVisible();
  await expect(currentMenu.locator(".menu-meal-card").filter({ hasText: "午餐" })).toContainText("待设置");
  releaseSlowWeek();
  releaseConflict();
  await expect(currentMenu.getByText("8月3日－7日", { exact: true })).toBeVisible();
  await expect(currentMenu.getByText("7月27日－31日", { exact: true })).toHaveCount(0);
  await expect(currentMenu.locator(".menu-replace-confirmation")).toHaveCount(0);

  await currentMenu.locator("taro-button-core").filter({ hasText: /^刷新$/ }).click();
  await expect(currentMenu.getByText("正在刷新菜单", { exact: true })).toBeVisible();
  await expect(currentMenu.locator(".menu-meal-card").filter({ hasText: "午餐" })).toContainText("红烧肉");
  releaseRefresh();
  await expect(currentMenu.getByText("刷新失败，当前菜单仍可查看", { exact: true })).toBeVisible();

  const requestsBeforeBack = augustRequests;
  await currentMenu.locator(".menu-meal-card").filter({ hasText: "午餐" })
    .locator("taro-button-core").filter({ hasText: /^设置价格与截止时间$/ }).click();
  await expect(page).toHaveURL(/pages\/merchant\/batches\/index/);
  await page.locator(".batches-page:visible taro-button-core").filter({ hasText: /^返回菜单$/ }).click();
  await expect(page.locator(".menu-page:visible").getByText("8月3日－7日", { exact: true })).toBeVisible();
  await expect.poll(() => augustRequests).toBeGreaterThan(requestsBeforeBack);

  await page.locator(".menu-page:visible taro-button-core").filter({ hasText: /^刷新$/ }).click();
  await expect(page.getByText("正在刷新菜单", { exact: true })).toBeVisible();
  await page.locator(".menu-page:visible .menu-meal-card").filter({ hasText: "午餐" })
    .locator("taro-button-core").filter({ hasText: /^重新生成午餐$/ }).click();
  await expect(page.locator(".menu-page:visible .menu-meal-card").filter({ hasText: "午餐" })).toContainText("新菜单");
  releaseStaleRefresh();
  await expect(page.locator(".menu-page:visible .menu-meal-card").filter({ hasText: "午餐" })).toContainText("新菜单");
});

test("菜单生成展示分类缺口、放宽说明并在部分失败后重载", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const generated = (date: string, occasion: "lunch" | "dinner", id: number, firstName: string) => ({
    ...slot(date, occasion),
    id,
    orderStatus: "draft",
    orderDeadline: null,
    menuItems: menuItems.map((item, index) => index === 0 ? { ...item, nameSnapshot: firstName } : item)
  });
  let docs: ReturnType<typeof generated>[] = [];
  let listRequests = 0;
  let generationRequests = 0;
  const requestBodies: Array<{ targets: Array<{ date: string; occasion: string }> }> = [];
  await page.route("**/merchant/meal-slots?*", (route) => {
    listRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ docs })
    });
  });
  await page.route("**/merchant/meal-slots/generate-menus", (route) => {
    generationRequests += 1;
    requestBodies.push(route.request().postDataJSON());
    if (generationRequests === 1) {
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "offering-pool-insufficient",
          message: "菜品池分类不足，无法生成完整菜单",
          shortages: [
            { category: "meat", required: 2, available: 1 },
            { category: "soup", required: 1, available: 0 }
          ]
        })
      });
    }
    if (generationRequests === 2) {
      const doc = generated("2026-07-22", "lunch", 501, "放宽后菜单");
      docs = [doc];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ docs: [doc], relaxedRules: ["recent-offering"] })
      });
    }
    docs = [...docs, generated("2026-07-20", "lunch", 502, "部分保存菜单")];
    return route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "cms-unavailable", message: "菜单服务暂不可用" })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  const lunch = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  await lunch.locator("taro-button-core").filter({ hasText: /^生成午餐$/ }).click();
  const issue = page.locator(".menu-generation-issue");
  await expect(issue).toContainText("荤菜缺 1 道（需 2，现有 1）");
  await expect(issue).toContainText("汤缺 1 道（需 1，现有 0）");
  await expect(issue.locator("taro-button-core").filter({ hasText: /^去补充菜品$/ })).toBeVisible();
  await expect(lunch).toContainText("未排菜单");

  await lunch.locator("taro-button-core").filter({ hasText: /^生成午餐$/ }).click();
  await expect(lunch).toContainText("放宽后菜单");
  await expect(page.getByText("已放宽：近 7 日不重复菜", { exact: true })).toBeVisible();
  await expect(issue).toHaveCount(0);

  const requestsBeforeFailure = listRequests;
  await taroButton(page, /^补齐本周菜单$/).click();
  await expect.poll(() => listRequests).toBeGreaterThan(requestsBeforeFailure);
  await expect(page.getByText("生成未完成，部分目标可能已保存，请核对当前菜单", { exact: true })).toBeVisible();
  expect(requestBodies[2]!.targets).not.toContainEqual({ date: "2026-07-22", occasion: "lunch" });
  await page.locator(".menu-day").filter({ hasText: "周一" }).click();
  await expect(page.locator(".menu-meal-card").filter({ hasText: "午餐" })).toContainText("部分保存菜单");
});

test("不同餐次的并行生成独立合并响应", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  let releaseLunch!: () => void;
  let releaseDinner!: () => void;
  const lunchResponse = new Promise<void>((resolve) => { releaseLunch = resolve; });
  const dinnerResponse = new Promise<void>((resolve) => { releaseDinner = resolve; });
  await page.route("**/merchant/meal-slots?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] })
  }));
  await page.route("**/merchant/meal-slots/generate-menus", async (route) => {
    const target = route.request().postDataJSON().targets[0] as { date: string; occasion: "lunch" | "dinner" };
    await (target.occasion === "lunch" ? lunchResponse : dinnerResponse);
    const firstName = target.occasion === "lunch" ? "并行午餐" : "并行晚餐";
    const doc = {
      ...slot(target.date, target.occasion),
      id: target.occasion === "lunch" ? 601 : 602,
      orderStatus: "draft",
      orderDeadline: null,
      menuItems: menuItems.map((item, index) => index === 0 ? { ...item, nameSnapshot: firstName } : item)
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        docs: [doc],
        relaxedRules: target.occasion === "dinner" ? ["recent-offering"] : []
      })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  const lunch = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  const dinner = page.locator(".menu-meal-card").filter({ hasText: "晚餐" });
  await lunch.locator("taro-button-core").filter({ hasText: /^生成午餐$/ }).click();
  await dinner.locator("taro-button-core").filter({ hasText: /^生成晚餐$/ }).click();
  await expect(lunch.locator("taro-button-core").filter({ hasText: /^生成中$/ })).toHaveAttribute("disabled", "");
  await expect(dinner.locator("taro-button-core").filter({ hasText: /^生成中$/ })).toHaveAttribute("disabled", "");
  releaseDinner();
  await expect(dinner).toContainText("并行晚餐");
  await expect(page.getByText("已放宽：近 7 日不重复菜", { exact: true })).toBeVisible();
  await expect(lunch).toContainText("生成中");
  releaseLunch();
  await expect(lunch).toContainText("并行午餐");
  await expect(dinner).toContainText("并行晚餐");
  await expect(page.getByText("已放宽：近 7 日不重复菜", { exact: true })).toBeVisible();
});

test("部分失败重载与无关餐次成功可同时合并", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const generated = (occasion: "lunch" | "dinner", id: number, firstName: string) => ({
    ...slot("2026-07-22", occasion),
    id,
    orderStatus: "draft",
    orderDeadline: null,
    menuItems: menuItems.map((item, index) => index === 0 ? { ...item, nameSnapshot: firstName } : item)
  });
  let docs: ReturnType<typeof generated>[] = [];
  let listRequests = 0;
  let holdReload = false;
  let releaseLunch!: () => void;
  let releaseReload!: () => void;
  const lunchResponse = new Promise<void>((resolve) => { releaseLunch = resolve; });
  const reloadResponse = new Promise<void>((resolve) => { releaseReload = resolve; });
  await page.route("**/merchant/meal-slots?*", async (route) => {
    listRequests += 1;
    if (holdReload) await reloadResponse;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs }) });
  });
  await page.route("**/merchant/meal-slots/generate-menus", async (route) => {
    const target = route.request().postDataJSON().targets[0] as { occasion: "lunch" | "dinner" };
    if (target.occasion === "lunch") {
      await lunchResponse;
      const doc = generated("lunch", 651, "并行成功菜单");
      docs = [...docs, doc];
      return route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify({ docs: [doc], relaxedRules: [] })
      });
    }
    docs = [...docs, generated("dinner", 652, "部分保存晚餐")];
    return route.fulfill({ status: 502, contentType: "application/json", body: "{}" });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  const lunch = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  const dinner = page.locator(".menu-meal-card").filter({ hasText: "晚餐" });
  const lunchButton = lunch.locator("taro-button-core").filter({ hasText: /^生成午餐$/ });
  const dinnerButton = dinner.locator("taro-button-core").filter({ hasText: /^生成晚餐$/ });
  await expect(lunchButton).toBeVisible();
  await expect(dinnerButton).toBeVisible();
  const requestsBeforeFailure = listRequests;
  holdReload = true;
  await lunchButton.click();
  await dinnerButton.click();
  await expect.poll(() => listRequests).toBeGreaterThan(requestsBeforeFailure);
  releaseLunch();
  await expect(lunch).toContainText("并行成功菜单");
  releaseReload();
  await expect(dinner).toContainText("部分保存晚餐");
  await expect(lunch).toContainText("并行成功菜单");
  await expect(page.getByText("生成未完成，部分目标可能已保存，请核对当前菜单", { exact: true })).toBeVisible();
});

test("生成期间请求刷新会在结束后补执行", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const generated = (firstName: string) => ({
    ...slot("2026-07-22", "lunch"),
    id: 671,
    orderStatus: "draft",
    orderDeadline: null,
    menuItems: menuItems.map((item, index) => index === 0 ? { ...item, nameSnapshot: firstName } : item)
  });
  let docs: ReturnType<typeof generated>[] = [];
  let listRequests = 0;
  let releaseGeneration!: () => void;
  const generationResponse = new Promise<void>((resolve) => { releaseGeneration = resolve; });
  await page.route("**/merchant/meal-slots?*", (route) => {
    listRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs }) });
  });
  await page.route("**/merchant/meal-slots/generate-menus", async (route) => {
    await generationResponse;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ docs: [generated("生成响应菜单")], relaxedRules: [] })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  await page.locator(".menu-meal-card").filter({ hasText: "午餐" })
    .locator("taro-button-core").filter({ hasText: /^生成午餐$/ }).click();
  docs = [generated("返回后刷新菜单")];
  await taroButton(page, /^刷新$/).click();
  const requestsBeforeFinish = listRequests;
  releaseGeneration();
  await expect.poll(() => listRequests).toBeGreaterThan(requestsBeforeFinish);
  await expect(page.locator(".menu-meal-card").filter({ hasText: "午餐" })).toContainText("返回后刷新菜单");
});

test("换一道只替换所选菜，无候选时保留菜单并引导菜品库", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const lunch = {
    ...slot("2026-07-22", "lunch"),
    id: 701,
    orderStatus: "draft",
    orderDeadline: null
  };
  const dinner = { ...slot("2026-07-22", "dinner"), id: 702, orderStatus: "open" };
  const swapped = {
    ...lunch,
    menuItems: lunch.menuItems.map((item, index) => index === 0
      ? { ...item, offeringId: 21, nameSnapshot: "糖醋排骨" }
      : item)
  };
  let attempts = 0;
  const requestBodies: unknown[] = [];
  await page.route("**/merchant/meal-slots?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [lunch, dinner] })
  }));
  await page.route("**/merchant/meal-slots/*/swap-menu-item", (route) => {
    requestBodies.push(route.request().postDataJSON());
    attempts += 1;
    return route.fulfill(attempts === 1 ? {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ doc: swapped, relaxedRules: ["recent-offering"] })
    } : {
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "no-swap-candidate", message: "没有可替换的同类菜品" })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  const lunchCard = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  const dinnerCard = page.locator(".menu-meal-card").filter({ hasText: "晚餐" });
  await lunchCard.locator("taro-button-core").filter({ hasText: /^换一道$/ }).click();
  const sheet = page.locator(".menu-swap-sheet");
  await expect(sheet.getByText("选择要换掉的菜", { exact: true })).toBeVisible();
  await expect(sheet.locator(".menu-swap-option")).toHaveCount(5);
  await sheet.getByLabel("换掉 红烧肉", { exact: true }).click();
  await expect(lunchCard).toContainText("糖醋排骨");
  await expect(lunchCard).not.toContainText("红烧肉");
  for (const name of ["香菇滑鸡", "清炒时蔬", "家常豆腐", "番茄蛋汤"]) {
    await expect(lunchCard).toContainText(name);
  }
  await expect(lunchCard).toContainText("本次已放宽：近 7 日不重复菜");
  expect(requestBodies[0]).toEqual({ offeringId: 1 });
  await expect(dinnerCard.locator("taro-button-core").filter({ hasText: /^换一道$/ })).toHaveCount(0);

  await lunchCard.locator("taro-button-core").filter({ hasText: /^换一道$/ }).click();
  await sheet.getByLabel("换掉 香菇滑鸡", { exact: true }).click();
  await expect(lunchCard).toContainText("没有合适的同类菜品，请先补充菜品库");
  await expect(lunchCard).toContainText("糖醋排骨 · 香菇滑鸡 · 清炒时蔬 · 家常豆腐 · 番茄蛋汤");
  expect(requestBodies[1]).toEqual({ offeringId: 2 });
  await lunchCard.locator("taro-button-core").filter({ hasText: /^去菜品库$/ }).click();
  await expect(page).toHaveURL(/pages\/merchant\/offerings\/index/);
});

test("不同餐次可并行换菜且仅锁定各自餐次", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const docs = ["lunch", "dinner"].map((occasion, index) => ({
    ...slot("2026-07-22", occasion as "lunch" | "dinner"),
    id: 711 + index,
    orderStatus: "draft",
    orderDeadline: null
  }));
  let releaseLunch!: () => void;
  let releaseDinner!: () => void;
  const lunchResponse = new Promise<void>((resolve) => { releaseLunch = resolve; });
  const dinnerResponse = new Promise<void>((resolve) => { releaseDinner = resolve; });
  await page.route("**/merchant/meal-slots?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs })
  }));
  await page.route("**/merchant/meal-slots/*/swap-menu-item", async (route) => {
    const isLunch = route.request().url().includes("/711/");
    await (isLunch ? lunchResponse : dinnerResponse);
    const original = docs[isLunch ? 0 : 1]!;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        doc: {
          ...original,
          menuItems: original.menuItems.map((item, index) => index === 0
            ? { ...item, offeringId: isLunch ? 31 : 32, nameSnapshot: isLunch ? "午餐新菜" : "晚餐新菜" }
            : item)
        },
        relaxedRules: []
      })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  const lunchCard = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  const dinnerCard = page.locator(".menu-meal-card").filter({ hasText: "晚餐" });
  await lunchCard.locator("taro-button-core").filter({ hasText: /^换一道$/ }).click();
  await page.locator(".menu-swap-sheet").getByLabel("换掉 红烧肉", { exact: true }).click();
  await expect.poll(() => lunchCard.locator("taro-button-core").filter({ hasText: /^换菜中$/ })
    .evaluate((element) => element.hasAttribute("disabled"))).toBe(true);
  await dinnerCard.locator("taro-button-core").filter({ hasText: /^换一道$/ }).click();
  await page.locator(".menu-swap-sheet").getByLabel("换掉 红烧肉", { exact: true }).click();
  await expect.poll(() => dinnerCard.locator("taro-button-core").filter({ hasText: /^换菜中$/ })
    .evaluate((element) => element.hasAttribute("disabled"))).toBe(true);

  await page.locator(".menu-day").filter({ hasText: "周四" }).click();
  await expect(page.getByText("2026-07-23", { exact: true })).toBeVisible();
  await page.locator(".menu-day").filter({ hasText: "周三" }).click();
  releaseDinner();
  await expect(dinnerCard).toContainText("晚餐新菜");
  await expect.poll(() => lunchCard.locator("taro-button-core").filter({ hasText: /^换菜中$/ })
    .evaluate((element) => element.hasAttribute("disabled"))).toBe(true);
  releaseLunch();
  await expect(lunchCard).toContainText("午餐新菜");
  await expect(dinnerCard).toContainText("晚餐新菜");
});

test("换菜延迟响应不污染新工作周", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const firstWeekSlot = {
    ...slot("2026-07-22", "lunch"), id: 721, orderStatus: "draft", orderDeadline: null
  };
  const nextWeekSlot = {
    ...slot("2026-07-27", "lunch"), id: 722, orderStatus: "draft", orderDeadline: null,
    menuItems: menuItems.map((item, index) => index === 0 ? { ...item, nameSnapshot: "下周原菜单" } : item)
  };
  let releaseSwap!: () => void;
  const swapResponse = new Promise<void>((resolve) => { releaseSwap = resolve; });
  await page.route("**/merchant/meal-slots?*", (route) => {
    const from = new URL(route.request().url()).searchParams.get("from");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ docs: from === "2026-07-27" ? [nextWeekSlot] : [firstWeekSlot] })
    });
  });
  await page.route("**/merchant/meal-slots/*/swap-menu-item", async (route) => {
    await swapResponse;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        doc: {
          ...firstWeekSlot,
          menuItems: firstWeekSlot.menuItems.map((item, index) => index === 0
            ? { ...item, nameSnapshot: "上周迟到换菜" }
            : item)
        },
        relaxedRules: ["recent-offering"]
      })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  const lunchCard = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  await lunchCard.locator("taro-button-core").filter({ hasText: /^换一道$/ }).click();
  await page.locator(".menu-swap-sheet").getByLabel("换掉 红烧肉", { exact: true }).click();
  await page.getByLabel("下一周").click();
  await expect(page.getByText("7月27日－31日", { exact: true })).toBeVisible();
  await expect(lunchCard).toContainText("下周原菜单");
  releaseSwap();
  await page.waitForResponse("**/merchant/meal-slots/*/swap-menu-item");
  await expect(lunchCard).toContainText("下周原菜单");
  await expect(lunchCard).not.toContainText("上周迟到换菜");
  await expect(page.getByText("本次已放宽：近 7 日不重复菜", { exact: true })).toHaveCount(0);
});

test("同周旧刷新不回滚换菜结果", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const original = {
    ...slot("2026-07-22", "lunch"), id: 731, orderStatus: "draft", orderDeadline: null
  };
  const swapped = {
    ...original,
    menuItems: original.menuItems.map((item, index) => index === 0
      ? { ...item, offeringId: 41, nameSnapshot: "刷新后的新菜" }
      : item)
  };
  let listRequests = 0;
  let deferRefresh = false;
  let releaseRefresh!: () => void;
  const refreshResponse = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  await page.route("**/merchant/meal-slots?*", async (route) => {
    listRequests += 1;
    if (deferRefresh) await refreshResponse;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs: [original] }) });
  });
  await page.route("**/merchant/meal-slots/*/swap-menu-item", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ doc: swapped, relaxedRules: [] })
  }));

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  const lunchCard = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  await expect(lunchCard).toContainText("红烧肉");
  const requestsBeforeRefresh = listRequests;
  deferRefresh = true;
  await taroButton(page, /^刷新$/).click();
  await expect.poll(() => listRequests).toBeGreaterThan(requestsBeforeRefresh);
  await lunchCard.locator("taro-button-core").filter({ hasText: /^换一道$/ }).click();
  await page.locator(".menu-swap-sheet").getByLabel("换掉 红烧肉", { exact: true }).click();
  await expect(lunchCard).toContainText("刷新后的新菜");
  releaseRefresh();
  await expect(lunchCard).toContainText("刷新后的新菜");
  await expect(lunchCard).not.toContainText("红烧肉");
});

test("同餐次换菜期间阻止重新生成", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const generated = (firstName: string) => ({
    ...slot("2026-07-22", "lunch"),
    id: 672,
    orderStatus: "draft",
    orderDeadline: null,
    menuItems: menuItems.map((item, index) => index === 0 ? { ...item, nameSnapshot: firstName } : item)
  });
  let releaseSwap!: () => void;
  const swapResponse = new Promise<void>((resolve) => { releaseSwap = resolve; });
  await page.route("**/merchant/meal-slots?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [generated("原菜单")] })
  }));
  await page.route("**/merchant/meal-slots/*/swap-menu-item", async (route) => {
    await swapResponse;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ doc: generated("迟到换菜菜单"), relaxedRules: ["recent-offering"] })
    });
  });
  await page.route("**/merchant/meal-slots/generate-menus", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ docs: [generated("重新生成菜单")], relaxedRules: [] })
  }));

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  const lunchCard = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  await lunchCard.locator("taro-button-core").filter({ hasText: /^换一道$/ }).click();
  await page.locator(".menu-swap-sheet").getByLabel("换掉 原菜单", { exact: true }).click();
  await expect.poll(() => lunchCard.locator("taro-button-core").filter({ hasText: /^重新生成午餐$/ })
    .evaluate((element) => element.hasAttribute("disabled"))).toBe(true);
  const response = page.waitForResponse("**/merchant/meal-slots/*/swap-menu-item");
  releaseSwap();
  await response;
  await expect(lunchCard).toContainText("迟到换菜菜单");
  await expect(lunchCard).toContainText("本次已放宽：近 7 日不重复菜");
});

test("并行覆盖确认按操作排队显示", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const docs = ["lunch", "dinner"].map((occasion, index) => ({
    ...slot("2026-07-22", occasion as "lunch" | "dinner"),
    id: 681 + index,
    orderStatus: "draft",
    orderDeadline: null
  }));
  let releaseLunch!: () => void;
  let releaseDinner!: () => void;
  const lunchResponse = new Promise<void>((resolve) => { releaseLunch = resolve; });
  const dinnerResponse = new Promise<void>((resolve) => { releaseDinner = resolve; });
  await page.route("**/merchant/meal-slots?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs })
  }));
  await page.route("**/merchant/meal-slots/generate-menus", async (route) => {
    const target = route.request().postDataJSON().targets[0] as { date: string; occasion: "lunch" | "dinner" };
    await (target.occasion === "lunch" ? lunchResponse : dinnerResponse);
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "meal-slots-exist",
        message: "目标餐次已有菜单，请确认覆盖",
        existingTargets: [target]
      })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  const lunch = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  const dinner = page.locator(".menu-meal-card").filter({ hasText: "晚餐" });
  await lunch.locator("taro-button-core").filter({ hasText: /^重新生成午餐$/ }).click();
  await dinner.locator("taro-button-core").filter({ hasText: /^重新生成晚餐$/ }).click();
  const confirmation = page.locator(".menu-replace-confirmation");
  releaseDinner();
  await expect(confirmation).toContainText("2026-07-22 晚餐");
  releaseLunch();
  await expect(confirmation).toContainText("2026-07-22 晚餐");
  await confirmation.locator("taro-button-core").filter({ hasText: /^取消$/ }).click();
  await expect(confirmation).toContainText("2026-07-22 午餐");
  await confirmation.locator("taro-button-core").filter({ hasText: /^取消$/ }).click();
  await expect(confirmation).toHaveCount(0);
});

test("成功刷新后撤销旧覆盖确认", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  let docs: ReturnType<typeof slot>[] = [];
  let generationRequests = 0;
  await page.route("**/merchant/meal-slots?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs })
  }));
  await page.route("**/merchant/meal-slots/generate-menus", (route) => {
    generationRequests += 1;
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: "meal-slots-exist",
        message: "目标餐次已有菜单，请确认覆盖",
        existingTargets: [{ date: "2026-07-22", occasion: "lunch" }]
      })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  await taroButton(page, /^生成本周午晚餐$/).click();
  const confirmation = page.locator(".menu-replace-confirmation");
  await expect(confirmation).toContainText("2026-07-22 午餐");
  docs = [slot("2026-07-22", "lunch"), slot("2026-07-22", "dinner")];
  await taroButton(page, /^刷新$/).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator(".menu-meal-card").filter({ hasText: "午餐" })).toContainText("红烧肉");
  await expect(page.locator(".menu-meal-card").filter({ hasText: "晚餐" })).toContainText("红烧肉");
  expect(generationRequests).toBe(1);
});

test("整周重新生成只覆盖草稿并保留后端原始目标", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const docs = [
    { ...slot("2026-07-20", "lunch"), id: 701, orderStatus: "draft", orderDeadline: null },
    { ...slot("2026-07-21", "dinner"), id: 702, orderStatus: "draft", orderDeadline: null },
    { ...slot("2026-07-22", "lunch"), id: 703, orderStatus: "open" },
    { ...slot("2026-07-22", "dinner"), id: 704, orderStatus: "closed" }
  ];
  const bodies: Array<{ targets: Array<{ date: string; occasion: string }>; replaceExisting: boolean }> = [];
  await page.route("**/merchant/meal-slots?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs })
  }));
  await page.route("**/merchant/meal-slots/generate-menus", (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (body.targets.length === 1 && body.targets[0].date === "2026-07-23" &&
      body.targets[0].occasion === "dinner") {
      return route.fulfill({ status: 502, contentType: "application/json", body: "{}" });
    }
    if (!body.replaceExisting) {
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "meal-slots-exist",
          message: "目标餐次已有菜单，请确认覆盖",
          existingTargets: [{ date: "2026-07-20", occasion: "lunch" }]
        })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ docs: docs.slice(0, 2), relaxedRules: [] })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  await expect(page.locator(".menu-meal-card").filter({ hasText: "午餐" })
    .locator("taro-button-core").filter({ hasText: /^重新生成午餐$/ })).toHaveCount(0);
  await expect(page.locator(".menu-meal-card").filter({ hasText: "晚餐" })
    .locator("taro-button-core").filter({ hasText: /^重新生成晚餐$/ })).toHaveCount(0);
  await taroButton(page, /^重新生成$/).click();
  expect(bodies[0]).toEqual({
    targets: [
      { date: "2026-07-20", occasion: "lunch" },
      { date: "2026-07-21", occasion: "dinner" }
    ],
    replaceExisting: false
  });
  const confirmation = page.locator(".menu-replace-confirmation");
  await expect(confirmation).toContainText("2026-07-20 午餐");
  await expect(confirmation).not.toContainText("2026-07-21 晚餐");
  await page.locator(".menu-day").filter({ hasText: "周四" }).click();
  await page.locator(".menu-meal-card").filter({ hasText: "晚餐" })
    .locator("taro-button-core").filter({ hasText: /^生成晚餐$/ }).click();
  await expect(page.getByText("生成未完成，部分目标可能已保存，请核对当前菜单", { exact: true })).toBeVisible();
  await expect(confirmation).toBeVisible();
  await confirmation.locator("taro-button-core").filter({ hasText: /^确认重新生成$/ }).click();
  await expect.poll(() => bodies.length).toBe(3);
  expect(bodies[2]).toEqual({ ...bodies[0], replaceExisting: true });
  await expect(confirmation).toHaveCount(0);
});

test("生成单餐与工作周菜单、确认覆盖并换一道菜", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-05T01:00:00.000Z") });
  const suffix = Date.now().toString(36);
  const rows = [
    ...Array.from({ length: 20 }, (_, index) => `菜单荤-${suffix}-${index} 主料荤-${suffix}-${index} 荤`),
    ...Array.from({ length: 20 }, (_, index) => `菜单素-${suffix}-${index} 主料素-${suffix}-${index} 素`),
    ...Array.from({ length: 10 }, (_, index) => `菜单汤-${suffix}-${index} 主料汤-${suffix}-${index} 汤`)
  ];

  await page.goto("/");
  await openOfferingImport(page);
  await offeringImportInput(page).fill(rows.join("\n"));
  await taroButton(page, /^预览导入$/).click();
  await expect(page.getByText("可新增 50 行，重名 0 行，错误 0 行")).toBeVisible();
  await taroButton(page, /^确认导入$/).click();
  await expect(page.getByText("新增 50 行，覆盖 0 行，跳过 0 行，失败 0 行")).toBeVisible();

  await taroButton(page, /^菜单$/).click();
  await expect(page.getByText("本周菜单", { exact: true })).toBeVisible();
  await expect(page.getByText("8月3日－7日", { exact: true })).toBeVisible();
  const lunchCard = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  const singleRequest = page.waitForRequest((request) =>
    request.url().endsWith("/merchant/meal-slots/generate-menus") && request.method() === "POST");
  const generatedAt = Date.now();
  await lunchCard.locator("taro-button-core").filter({ hasText: /^生成午餐$/ }).click();
  expect((await singleRequest).postDataJSON()).toEqual({
    targets: [{ date: "2026-08-05", occasion: "lunch" }],
    replaceExisting: false
  });
  await expect(lunchCard.locator(".menu-meal-names")).toBeVisible();
  expect(Date.now() - generatedAt).toBeLessThan(3_000);

  const firstName = (await lunchCard.locator(".menu-meal-names").innerText()).split(" · ")[0]!;
  await lunchCard.locator("taro-button-core").filter({ hasText: /^换一道$/ }).click();
  await page.locator(".menu-swap-sheet").getByLabel(`换掉 ${firstName}`, { exact: true }).click();
  await expect.poll(async () => (await lunchCard.locator(".menu-meal-names").innerText()).split(" · "))
    .not.toContain(firstName);

  await lunchCard.locator("taro-button-core").filter({ hasText: /^重新生成午餐$/ }).click();
  const confirmation = page.locator(".menu-replace-confirmation");
  await expect(confirmation).toContainText("2026-08-05 午餐");
  await confirmation.locator("taro-button-core").filter({ hasText: /^取消$/ }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(lunchCard.locator(".menu-meal-names")).toBeVisible();

  await lunchCard.locator("taro-button-core").filter({ hasText: /^重新生成午餐$/ }).click();
  const replaceRequest = page.waitForRequest((request) =>
    request.url().endsWith("/merchant/meal-slots/generate-menus") &&
    request.method() === "POST" && request.postDataJSON().replaceExisting === true);
  await confirmation.locator("taro-button-core").filter({ hasText: /^确认重新生成$/ }).click();
  expect((await replaceRequest).postDataJSON()).toEqual({
    targets: [{ date: "2026-08-05", occasion: "lunch" }],
    replaceExisting: true
  });

  const fillRequest = page.waitForRequest((request) =>
    request.url().endsWith("/merchant/meal-slots/generate-menus") &&
    request.method() === "POST" && request.postDataJSON().targets.length === 9);
  await taroButton(page, /^补齐本周菜单$/).click();
  const fillBody = (await fillRequest).postDataJSON();
  expect(fillBody.replaceExisting).toBe(false);
  expect(fillBody.targets).toHaveLength(9);
  expect(fillBody.targets).not.toContainEqual({ date: "2026-08-05", occasion: "lunch" });
  await page.locator(".menu-day").filter({ hasText: "周五" }).click();
  await expect(page.locator(".menu-meal-card").filter({ hasText: "晚餐" }).locator(".menu-meal-names")).toBeVisible();

  await page.getByLabel("下一周").click();
  await expect(page.getByText("8月10日－14日", { exact: true })).toBeVisible();
  const weekRequest = page.waitForRequest((request) =>
    request.url().endsWith("/merchant/meal-slots/generate-menus") &&
    request.method() === "POST" && request.postDataJSON().targets.length === 10);
  await taroButton(page, /^生成本周午晚餐$/).click();
  const weekBody = (await weekRequest).postDataJSON();
  expect(weekBody.replaceExisting).toBe(false);
  expect(weekBody.targets).toHaveLength(10);
  await page.locator(".menu-day").filter({ hasText: "周五" }).click();
  await expect(page.locator(".menu-meal-card").filter({ hasText: "晚餐" }).locator(".menu-meal-names")).toBeVisible();
});

test("从目标餐次预填配置并在返回后刷新当前工作周", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  const dates = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"];
  let docs = dates.flatMap((date, dateIndex) => (["lunch", "dinner"] as const).map((occasion, occasionIndex) => ({
    ...slot(date, occasion),
    id: 800 + dateIndex * 2 + occasionIndex,
    orderStatus: date === "2026-07-22" && occasion === "dinner" ? "draft" as const : "open" as const,
    orderDeadline: date === "2026-07-22" && occasion === "dinner"
      ? null
      : "2026-07-24T10:00:00.000Z",
    priceCents: null
  })));
  const ranges: string[] = [];
  await page.route("**/merchant/meal-slots?*", (route) => {
    const url = new URL(route.request().url());
    ranges.push(`${url.searchParams.get("from")}:${url.searchParams.get("to")}`);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ docs }) });
  });
  await page.route("**/merchant/booking-batches", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] })
  }));
  await page.route("**/merchant/meal-slots/805/booking-config", (route) => {
    const input = route.request().postDataJSON();
    docs = docs.map((doc) => doc.id === 805 ? { ...doc, ...input } : doc);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ doc: docs.find(({ id }) => id === 805) })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  const dinnerCard = page.locator(".menu-meal-card").filter({ hasText: "晚餐" });
  await expect(dinnerCard).toContainText("待设置");
  await dinnerCard.locator("taro-button-core").filter({ hasText: /^设置价格与截止时间$/ }).click();
  await expect(page).toHaveURL(/pages\/merchant\/batches\/index\?weekStart=2026-07-20&date=2026-07-22&occasion=dinner$/);
  await expect(page.getByRole("textbox", { name: "批次起始日期" })).toHaveValue("2026-07-20");
  await expect.poll(() => ranges.filter((range) => range === "2026-07-20:2026-07-24").length).toBeGreaterThan(1);
  const target = page.locator(".batch-slot.target");
  await expect(target).toContainText("2026-07-22 晚餐");
  await expect(target).toContainText("当前餐次");
  await target.getByRole("textbox", { name: "截止时间" }).fill("2026-07-22T10:30");
  const configured = page.waitForRequest("**/merchant/meal-slots/805/booking-config");
  await target.locator("taro-button-core").filter({ hasText: /^开放预订$/ }).click();
  expect((await configured).postDataJSON()).toEqual({
    priceCents: null,
    orderDeadline: "2026-07-22T02:30:00.000Z",
    orderStatus: "open"
  });

  const requestsBeforeReturn = ranges.length;
  await taroButton(page, /^返回菜单$/).click();
  await expect(page).toHaveURL(
    /pages\/merchant\/menu\/index\?weekStart=2026-07-20&date=2026-07-22&occasion=dinner$/
  );
  await expect.poll(() => ranges.length).toBeGreaterThan(requestsBeforeReturn);
  const returnedMenu = page.locator(".menu-page:visible");
  const returnedDinner = returnedMenu.locator(".menu-meal-card").filter({ hasText: "晚餐" });
  await expect(returnedMenu.locator(".menu-day.selected")).toContainText("周三");
  await expect(returnedDinner).toContainText("预订中");
  await expect(returnedDinner).toContainText("商家默认价");
  await expect(returnedDinner).toContainText("10:30 截止");
  await returnedMenu.locator("taro-button-core").filter({ hasText: /^查看预订与分享$/ }).click();
  expect(new URL(page.url()).search).toBe("?weekStart=2026-07-20");
  await expect(page.getByRole("textbox", { name: "批次起始日期" })).toHaveValue("2026-07-20");
});

test("配置页冷启动返回时把工作周和目标日期交给菜单页", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-12T01:00:00.000Z") });
  const ranges: string[] = [];
  await page.route("**/merchant/booking-batches", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ docs: [] })
  }));
  await page.route("**/merchant/meal-slots?*", (route) => {
    const url = new URL(route.request().url());
    ranges.push(`${url.searchParams.get("from")}:${url.searchParams.get("to")}`);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ docs: [{ ...slot("2026-07-29", "dinner"), id: 899, orderStatus: "draft" }] })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/home\/index/);
  await page.goto("/pages/merchant/batches/index?weekStart=2026-07-27&date=2026-07-29&occasion=dinner");
  await expect(page.locator(".batch-slot.target")).toContainText("2026-07-29 晚餐");
  await taroButton(page, /^返回菜单$/).click();
  await expect(page).toHaveURL(
    /pages\/merchant\/menu\/index\?weekStart=2026-07-27&date=2026-07-29&occasion=dinner$/
  );
  const returnedMenu = page.locator(".menu-page:visible");
  await expect(returnedMenu.getByText("7月27日－31日", { exact: true })).toBeVisible();
  await expect(returnedMenu.locator(".menu-day.selected")).toContainText("周三");
  expect(ranges).toContain("2026-07-27:2026-07-31");
});

test("预订配置只接受最后一次餐次加载且批次失败不阻断餐次", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-07-22T01:00:00.000Z") });
  let julyRequests = 0;
  let releaseAutoLoad!: () => void;
  const autoLoad = new Promise<void>((resolve) => { releaseAutoLoad = resolve; });
  await page.route("**/merchant/booking-batches", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.route("**/merchant/meal-slots?*", async (route) => {
    const from = new URL(route.request().url()).searchParams.get("from");
    if (from === "2026-07-20") {
      julyRequests += 1;
      if (julyRequests === 2) await autoLoad;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ docs: [{ ...slot("2026-07-22", "dinner"), id: 901, orderStatus: "draft" }] })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ docs: [{ ...slot("2026-07-27", "lunch"), id: 902, orderStatus: "draft" }] })
    });
  });

  await page.goto("/");
  await taroButton(page, /^开发登录$/).click();
  await taroButton(page, /^菜单$/).click();
  await page.locator(".menu-meal-card").filter({ hasText: "晚餐" })
    .locator("taro-button-core").filter({ hasText: /^设置价格与截止时间$/ }).click();
  await expect.poll(() => julyRequests).toBe(2);

  const configPage = page.locator(".batches-page:visible");
  await configPage.getByRole("textbox", { name: "批次起始日期" }).fill("2026-07-27");
  await configPage.locator("taro-button-core").filter({ hasText: /^查看餐次$/ }).click();
  await expect(configPage.locator(".batch-slot")).toContainText("2026-07-27 午餐");
  releaseAutoLoad();
  await expect(configPage.locator(".batch-slot")).toContainText("2026-07-27 午餐");
  await expect(configPage.getByText("2026-07-22 晚餐", { exact: true })).toHaveCount(0);
});

test("配置餐次后创建、复制并关闭预订批次", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const future = new Date(Date.now() + (120 + Date.now() % 100) * 86_400_000);
  const daysUntilWednesday = (3 - future.getUTCDay() + 7) % 7;
  const target = new Date(future.getTime() + daysUntilWednesday * 86_400_000);
  const targetDate = target.toISOString().slice(0, 10);
  const deadline = new Date(target.getTime() - 86_400_000).toISOString().slice(0, 10);
  const rows = [
    `批次荤一-${suffix} 牛肉-${suffix} 荤`,
    `批次荤二-${suffix} 猪肉-${suffix} 荤`,
    `批次素一-${suffix} 青菜-${suffix} 素`,
    `批次素二-${suffix} 豆腐-${suffix} 素`,
    `批次汤-${suffix} 番茄-${suffix} 汤`
  ];
  await page.clock.install({ time: new Date(`${targetDate}T01:00:00.000Z`) });
  await page.goto("/");
  await openOfferingImport(page);
  await offeringImportInput(page).fill(rows.join("\n"));
  await taroButton(page, /^预览导入$/).click();
  await taroButton(page, /^确认导入$/).click();
  await expect(page.getByText("新增 5 行，覆盖 0 行，跳过 0 行，失败 0 行")).toBeVisible();
  await taroButton(page, /^菜单$/).click();
  await expect(page.locator(".menu-selected-date")).toContainText(targetDate);
  const lunchCard = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  await lunchCard.locator("taro-button-core").filter({ hasText: /^生成午餐$/ }).click();
  await expect(lunchCard.locator(".menu-meal-names")).toBeVisible();
  await lunchCard.locator("taro-button-core").filter({ hasText: /^设置价格与截止时间$/ }).click();

  const startedAt = Date.now();
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

test("专用页面新建和选择顾客、显式更新与重提后继续订单生命周期", async ({ page }) => {
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

  await page.clock.install({ time: new Date("2026-09-21T01:00:00.000Z") });
  await page.goto("/");
  await openOfferingImport(page);
  await offeringImportInput(page).fill(rows.join("\n"));
  await taroButton(page, /^预览导入$/).click();
  await taroButton(page, /^确认导入$/).click();
  await expect(page.getByText("新增 5 行，覆盖 0 行，跳过 0 行，失败 0 行")).toBeVisible();

  await taroButton(page, /^菜单$/).click();
  await expect(page.locator(".menu-selected-date")).toContainText("2026-09-21");
  const lunchCard = page.locator(".menu-meal-card").filter({ hasText: "午餐" });
  await lunchCard.locator("taro-button-core").filter({ hasText: /^生成午餐$/ }).click();
  await expect(lunchCard.locator(".menu-meal-names")).toBeVisible();
  await taroButton(page, /^订单$/).click();

  await expect(page.getByText("餐次订单", { exact: true })).toBeVisible();
  await expect(page.locator(".page-state")).toContainText("请填写日期并查看午餐或晚餐订单");
  await page.getByRole("textbox", { name: "订单日期" }).fill("2099-01-01");
  await taroButton(page, /^查看午餐订单$/).click();
  await expect(page.locator(".page-state")).toContainText("餐次订单加载失败，请检查日期后重试");
  await page.getByRole("textbox", { name: "订单日期" }).fill("2026-09-21");
  await taroButton(page, /^查看午餐订单$/).click();
  await expect(page.locator(".page-state")).toContainText("当前餐次还没有订单，可手动补录待确认订单");
  await expect(page.getByText("已确认 0 单，共 0 份；未付 0 单，待送 0 单", { exact: true })).toBeVisible();

  await taroButton(page, /^手动加单$/).click();
  await expect(page).toHaveURL(/pages\/merchant\/orders\/add\/index/);
  await page.getByRole("textbox", { name: "顾客称呼" }).fill(displayName);
  await page.getByRole("textbox", { name: "顾客地址" }).fill(address);
  await page.getByRole("spinbutton").fill("2");
  await page.getByRole("textbox", { name: "备注" }).fill("少辣");
  await taroButton(page, /^保存待确认订单$/).click();
  const orderCard = page.locator(".order-card").filter({ hasText: displayName });
  await expect(orderCard).toContainText("2 份");

  await taroButton(page, /^手动加单$/).click();
  await page.locator(".manual-profile").filter({ hasText: displayName }).click();
  await page.getByRole("spinbutton").fill("3");
  await taroButton(page, /^保存待确认订单$/).click();
  await expect(taroButton(page, /^确认更新现有待确认订单$/)).toBeVisible();
  await page.getByRole("spinbutton").fill("4");
  await expect(taroButton(page, /^确认更新现有待确认订单$/)).toHaveCount(0);
  await taroButton(page, /^保存待确认订单$/).click();
  await taroButton(page, /^确认更新现有待确认订单$/).click();
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

  await taroButton(page, /^手动加单$/).click();
  await page.locator(".manual-profile").filter({ hasText: displayName }).click();
  await page.getByRole("spinbutton").fill("6");
  await taroButton(page, /^保存待确认订单$/).click();
  await taroButton(page, /^确认重提已取消订单$/).click();
  await expect(lifecycleCard).toContainText("业务：草稿；付款：未付；配送：待送");
  await expect(lifecycleCard).toContainText("6 份");

  await lifecycleCard.getByLabel(`确认 ${displayName}`).click();
  await expect(lifecycleCard).toContainText("业务：已确认；付款：未付；配送：待送");
  const secondName = `批量顾客-${suffix}`;
  const secondAddress = `1A-${suffix}`;
  await taroButton(page, /^手动加单$/).click();
  await taroButton(page, /^新建顾客资料$/).click();
  await page.getByRole("textbox", { name: "顾客称呼" }).fill(secondName);
  await page.getByRole("textbox", { name: "顾客地址" }).fill(secondAddress);
  await page.getByRole("spinbutton").fill("2");
  await taroButton(page, /^保存待确认订单$/).click();
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
