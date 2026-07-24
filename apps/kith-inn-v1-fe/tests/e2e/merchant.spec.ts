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
  await enterOfferings(page);
  await page.getByLabel("停用 并发菜A").click();
  await page.getByLabel("停用 并发菜B").click();
  await expect.poll(() => patchRequests).toEqual([901, 902]);
  await expect(page.getByLabel("停用 并发菜A")).toHaveAttribute("disabled", "");
  await expect(page.getByLabel("停用 并发菜B")).toHaveAttribute("disabled", "");

  releaseFirst();
  await expect(page.getByLabel("恢复 并发菜A")).toBeVisible();
  await expect(page.getByLabel("停用 并发菜B")).toHaveAttribute("disabled", "");
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
  await enterOfferings(page);
  await page.getByLabel("编辑 顺序菜B").click();
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
  await enterOfferings(page);
  const input = page.getByRole("textbox", { name: "每行一道菜" });
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
  await enterOfferings(page);
  const input = page.getByRole("textbox", { name: "每行一道菜" });
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
