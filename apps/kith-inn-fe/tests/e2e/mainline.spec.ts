import { expect, test, type Locator, type Page, type Request, type Response } from "@playwright/test";
import type { Fulfillment, MenuPlanView, RelaxedRule, ServiceSlot } from "@cfp/kith-inn-shared";
import {
  MAINLINE_ADDRESS_DATE,
  MAINLINE_ADDRESS_TEXT,
  MAINLINE_CONFLICT_DATE_TEXT,
  MAINLINE_DATE,
  MAINLINE_IDEMP_DATE,
  MAINLINE_IDEMP_TEXT,
  MAINLINE_MISSING_DATE_TEXT,
  MAINLINE_ORDER_TEXT,
} from "./fixtures/fixed-llm-server";
import {
  MAINLINE_BE,
  MAINLINE_LLM,
  apiLogin,
  expectOrderAggregate,
  freezeMainlineDate,
  readDeliveryView,
  readMenuPlans,
  readOrderAggregate,
} from "./fixtures/mainline";

test.beforeEach(async ({ page }) => freezeMainlineDate(page));

async function login(page: Page) {
  await page.goto("/");
  const response = page.waitForResponse((res) => res.url() === `${MAINLINE_BE}/auth/dev-login` && res.request().method() === "POST");
  await page.getByText("开发登录（跳过微信）", { exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/pages\/today\/index/);
}

async function chat(page: Page, text: string): Promise<Response> {
  await page.getByRole("textbox", { name: "粘接龙，或说 26B 送了" }).fill(text);
  const response = page.waitForResponse((res) => res.url() === `${MAINLINE_BE}/chat` && res.request().method() === "POST");
  await page.getByText("↑", { exact: true }).click();
  return response;
}

async function confirmReconciliation(page: Page): Promise<Response> {
  const request = await startReconciliation(page);
  const response = await request.response();
  if (!response) throw new Error("confirm-operation response missing");
  return response;
}

async function startReconciliation(page: Page): Promise<Request> {
  const request = page.waitForRequest((req) => req.url() === `${MAINLINE_BE}/chat/confirm-operation` && req.method() === "POST");
  await page.locator("taro-button-core").filter({ hasText: /^确认按本次更新$/ }).click();
  return request;
}

async function openOrders(page: Page, daysAfterToday: number) {
  await page.getByText("订单", { exact: true }).click();
  await expect(page).toHaveURL(/pages\/orders\/index/);
  const nextDay = page.locator("taro-button-core").filter({ hasText: /^后一天$/ });
  for (let day = 0; day < daysAfterToday; day++) await nextDay.click();
}

async function replayPost(page: Page, request: Request, count: number) {
  const authorization = (await request.allHeaders()).authorization;
  return page.evaluate(async ({ url, authorization, body, count }) => Promise.all(Array.from({ length: count }, async () => {
    const response = await fetch(url, { method: "POST", headers: { Authorization: authorization, "content-type": "application/json" }, body: body ?? undefined });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  })), { url: request.url(), authorization, body: request.postData(), count });
}

async function dishNames(card: Locator): Promise<string[]> {
  const swapButtons = card.locator("taro-button-core").filter({ hasText: /^换$/ });
  await expect(swapButtons).toHaveCount(5);
  return swapButtons.locator("..").locator("taro-text-core").allInnerTexts();
}

const relaxedRuleZh: Record<RelaxedRule, string> = {
  "same-week-offering": "本周已安排过同一道菜",
  "same-day-main-ingredient": "当天主料重复",
  "recent-offering": "近 7 天已安排过同一道菜",
  "recent-main-ingredient": "近 7 天主料重复",
};

async function selectOrderCards(page: Page, payment: "付○" | "付✓", count = 3) {
  const cards = page.locator(".card").filter({ has: page.getByText(payment, { exact: true }) });
  await expect(cards).toHaveCount(3);
  for (let index = 0; index < count; index++) await cards.nth(index).locator(":scope > taro-view-core").first().click();
}

test("E2E-ORDER-001 / E2E-MAIN-001：H5 从接龙连续完成菜单、收款与送达", async ({ page, request }) => {
  const token = await apiLogin(request);
  await expect(readOrderAggregate(request, token)).resolves.toEqual({ orders: [], fulfillments: [] });
  expect((await request.post(`${MAINLINE_LLM}/chat/completions`, {
    data: { messages: [{ role: "user", content: "未登记场景" }] },
  })).status()).toBe(422);

  await page.goto("/");
  const loginResponse = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/auth/dev-login` && response.request().method() === "POST");
  await page.getByText("开发登录（跳过微信）", { exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/pages\/today\/index/);

  await page.getByRole("textbox", { name: "粘接龙，或说 26B 送了" }).fill(MAINLINE_ORDER_TEXT);
  const chatResponse = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/chat` && response.request().method() === "POST");
  await page.getByText("↑", { exact: true }).click();
  expect((await chatResponse).status()).toBe(200);
  await expect(page.getByText("新增 3", { exact: false }).last()).toBeVisible();
  await expect(page.getByText("新增 · 2026-07-13 午餐 · 王燕萍 · 2份", { exact: true })).toBeVisible();
  await expect(page.getByText("新顾客", { exact: false })).toHaveCount(3);
  await expect(readOrderAggregate(request, token)).resolves.toEqual({ orders: [], fulfillments: [] });

  const reconcileResponse = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/chat/confirm-operation` && response.request().method() === "POST");
  await page.locator("taro-button-core").filter({ hasText: /^确认按本次更新$/ }).click();
  expect((await reconcileResponse).status()).toBe(200);
  await expect(page.getByText("已按最新完整接龙更新：新增 3", { exact: false })).toBeVisible();
  await expect.poll(async () => (await readOrderAggregate(request, token)).orders.length).toBe(3);
  expectOrderAggregate(await readOrderAggregate(request, token), "draft");

  await page.getByText("订单", { exact: true }).click();
  await expect(page).toHaveURL(/pages\/orders\/index/);
  const buttons = page.locator("taro-button-core").filter({ hasText: /^确认订单$/ });
  await expect(buttons).toHaveCount(3);
  const slots: ServiceSlot[] = [];
  for (let remaining = 3; remaining > 0; remaining--) {
    const responsePromise = page.waitForResponse((response) => /\/orders\/[^/]+\/confirm$/.test(new URL(response.url()).pathname) && response.request().method() === "POST");
    await buttons.first().click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const result = (await response.json()) as { slots: ServiceSlot[]; fulfillments: Fulfillment[] };
    expect(result.fulfillments).toEqual([expect.objectContaining({ status: "pending" })]);
    expect(result.slots).toEqual([expect.objectContaining({ status: "open" })]);
    slots.push(...result.slots);
    await expect(buttons).toHaveCount(remaining - 1);
  }

  expect(new Set(slots.map((slot) => String(slot.id))).size).toBe(2);
  expect(slots.every((slot) => slot.date.startsWith("2026-07-13"))).toBe(true);
  await expect.poll(async () => (await readOrderAggregate(request, token)).orders.filter((order) => order.status === "confirmed").length).toBe(3);
  expectOrderAggregate(await readOrderAggregate(request, token), "confirmed");
  await expect(page.getByText("送○", { exact: true })).toHaveCount(3);
  await expect(page.getByText("付○", { exact: true })).toHaveCount(3);

  await page.getByText("菜单", { exact: true }).click();
  const lunchCard = page.locator(".card").filter({ has: page.getByText("午餐", { exact: true }) }).first();
  const dinnerCard = page.locator(".card").filter({ has: page.getByText("晚餐", { exact: true }) }).first();
  const lunchGenerated = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/menu/generate` && response.request().method() === "POST");
  await lunchCard.locator("taro-button-core").filter({ hasText: /^生成午餐$/ }).click();
  const original = ((await (await lunchGenerated).json()) as { plans: MenuPlanView[] }).plans[0]!;
  const dinnerGenerated = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/menu/generate` && response.request().method() === "POST");
  await dinnerCard.locator("taro-button-core").filter({ hasText: /^生成晚餐$/ }).click();
  const dinnerPlan = ((await (await dinnerGenerated).json()) as { plans: MenuPlanView[] }).plans[0]!;
  const targetIndex = original.dishes.findIndex((dish) => dish.category === "soup");
  expect(targetIndex).toBeGreaterThanOrEqual(0);
  const dinnerSoup = dinnerPlan.dishes.find((dish) => dish.category === "soup")!;
  expect(String(dinnerSoup.id)).not.toBe(String(original.dishes[targetIndex]!.id));

  const historyDayOffset = 3;
  for (let day = 0; day < historyDayOffset; day++) {
    await page.locator("taro-button-core").filter({ hasText: /^后一天 ▶$/ }).click();
  }
  const nextGenerated = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/menu/generate` && response.request().method() === "POST");
  await lunchCard.locator("taro-button-core").filter({ hasText: /^生成午餐$/ }).click();
  let nextPlan = ((await (await nextGenerated).json()) as { plans: MenuPlanView[] }).plans[0]!;
  const usedSoupIds = new Set([String(original.dishes[targetIndex]!.id), String(dinnerSoup.id)]);
  const nextSoupIndex = nextPlan.dishes.findIndex((dish) => dish.category === "soup");
  if (usedSoupIds.has(String(nextPlan.dishes[nextSoupIndex]!.id))) {
    const historySwap = page.waitForResponse((response) => response.url().endsWith(`/menu/plans/${nextPlan.planId}/swap`) && response.request().method() === "POST");
    await lunchCard.getByText(nextPlan.dishes[nextSoupIndex]!.name, { exact: true }).locator("..").locator("taro-button-core").click();
    const historySwapResponse = await historySwap;
    expect(historySwapResponse.status()).toBe(200);
    nextPlan = ((await historySwapResponse.json()) as { plan: MenuPlanView }).plan;
  }
  expect(new Set([String(original.dishes[targetIndex]!.id), String(dinnerSoup.id), String(nextPlan.dishes[nextSoupIndex]!.id)]).size).toBe(3);
  for (let day = 0; day < historyDayOffset; day++) {
    await page.locator("taro-button-core").filter({ hasText: /^◀ 前一天$/ }).click();
  }
  await expect.poll(() => dishNames(lunchCard)).toEqual(original.dishes.map((dish) => dish.name));

  const target = original.dishes[targetIndex]!;
  const swap = page.waitForResponse((response) => response.url().endsWith(`/menu/plans/${original.planId}/swap`) && response.request().method() === "POST");
  await lunchCard.getByText(target.name, { exact: true }).locator("..").locator("taro-button-core").click();
  const swapResponse = await swap;
  expect(swapResponse.status()).toBe(200);
  const swapped = await swapResponse.json() as { plan: MenuPlanView; relaxedRules: RelaxedRule[] };
  expect(swapped.relaxedRules.length).toBeGreaterThan(0);
  expect(String(swapped.plan.dishes[targetIndex]!.id)).not.toBe(String(target.id));
  expect(swapped.plan.dishes[targetIndex]!.name).not.toBe(target.name);
  const expectedNames = original.dishes.map((dish, index) => index === targetIndex ? swapped.plan.dishes[index]!.name : dish.name);
  expect(swapped.plan.dishes.map((dish) => dish.name)).toEqual(expectedNames);
  await expect.poll(() => dishNames(lunchCard)).toEqual(expectedNames);
  const fullRelaxation = `菜品池较小，本次允许：${swapped.relaxedRules.map((rule) => relaxedRuleZh[rule]).join("、")}`;
  await expect(lunchCard.getByText(fullRelaxation, { exact: true })).toBeVisible();

  const publish = page.waitForResponse((response) => response.url().endsWith(`/menu/plans/${original.planId}/publish`) && response.request().method() === "POST");
  await lunchCard.locator("taro-button-core").filter({ hasText: /^一键发布$/ }).click();
  const publishResponse = await publish;
  expect(publishResponse.status()).toBe(200);
  const { publishText } = await publishResponse.json() as { publishText: string };
  expect(publishText).toContain("#接龙");
  for (const name of expectedNames) expect(publishText).toContain(name);
  await expect(lunchCard.getByText("已发出", { exact: true })).toBeVisible();
  const persistedPlans = await readMenuPlans(request, token);
  expect(persistedPlans).toContainEqual(expect.objectContaining({
    planId: original.planId, status: "published", dishes: swapped.plan.dishes, publishText,
  }));

  await page.getByText("订单", { exact: true }).click();
  const confirmed = await readOrderAggregate(request, token);
  await selectOrderCards(page, "付○");
  const paid = confirmed.orders.map((order) => page.waitForResponse((response) => response.url().endsWith(`/orders/${String(order.id)}`) && response.request().method() === "PATCH"));
  await page.locator("taro-button-core").filter({ hasText: /^批量已付\(3\)$/ }).click();
  expect((await Promise.all(paid)).every((response) => response.status() === 200)).toBe(true);
  await expect.poll(async () => (await readOrderAggregate(request, token)).orders.every((order) => order.paymentStatus === "paid")).toBe(true);

  await selectOrderCards(page, "付✓", 2);
  const firstDelivery = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/delivery/fulfillments` && response.request().method() === "PATCH");
  await page.locator("taro-button-core").filter({ hasText: /^批量送达\(2\)$/ }).click();
  const firstDeliveryResponse = await firstDelivery;
  expect(firstDeliveryResponse.status()).toBe(200);
  const firstDeliveryBody = firstDeliveryResponse.request().postDataJSON() as { ids: Array<string | number>; set: { status: string } };
  expect(firstDeliveryBody.set).toEqual({ status: "done" });
  const firstDeliveryIds = firstDeliveryBody.ids.map(String).sort();
  expect(firstDeliveryIds).toHaveLength(2);
  expect(new Set(firstDeliveryIds).size).toBe(2);
  const afterFirstDelivery = await readOrderAggregate(request, token);
  expect(afterFirstDelivery.fulfillments.filter((fulfillment) => fulfillment.status === "done").map((fulfillment) => String(fulfillment.id)).sort()).toEqual(firstDeliveryIds);
  expect(afterFirstDelivery.fulfillments.filter((fulfillment) => fulfillment.status === "pending")).toHaveLength(1);

  const pendingCard = page.locator(".card").filter({ has: page.getByText("送○", { exact: true }) });
  await expect(pendingCard).toHaveCount(1);
  await pendingCard.locator(":scope > taro-view-core").first().click();
  const finalDelivery = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/delivery/fulfillments` && response.request().method() === "PATCH");
  await page.locator("taro-button-core").filter({ hasText: /^批量送达\(1\)$/ }).click();
  expect((await finalDelivery).status()).toBe(200);
  await expect(page.getByText("草稿 0 · 未付 0 · 待送 0", { exact: true })).toBeVisible();
  const settled = await readOrderAggregate(request, token);
  expect(settled.orders.every((order) => order.status === "confirmed" && order.paymentStatus === "paid")).toBe(true);
  expect(settled.fulfillments).toHaveLength(3);
  expect(settled.fulfillments.every((fulfillment) => fulfillment.status === "done")).toBe(true);
});

test("E2E-DATE-001：缺日期与周几冲突均提示补全且零写入", async ({ page, request }) => {
  const token = await apiLogin(request);
  const before = await readOrderAggregate(request, token, MAINLINE_DATE);
  await login(page);
  for (const [input, message] of [
    [MAINLINE_MISSING_DATE_TEXT, "日期依据无法解析：午餐"],
    [MAINLINE_CONFLICT_DATE_TEXT, "日期与周几不一致"],
  ] as const) {
    expect((await chat(page, input)).status()).toBe(200);
    await expect(page.getByText(message, { exact: false })).toBeVisible();
  }
  await expect(page.locator("taro-button-core").filter({ hasText: /^确认按本次更新$/ })).toHaveCount(0);
  expect(await readOrderAggregate(request, token, MAINLINE_DATE)).toEqual(before);
});

test("E2E-ADDRESS-001：H5 新客留空地址仍可确认并进入无地址组", async ({ page, request }) => {
  const token = await apiLogin(request);
  await expect(readOrderAggregate(request, token, MAINLINE_ADDRESS_DATE)).resolves.toEqual({ orders: [], fulfillments: [] });
  await login(page);
  expect((await chat(page, MAINLINE_ADDRESS_TEXT)).status()).toBe(200);
  await expect(page.getByRole("textbox", { name: "填地址（如 3a27a）" })).toBeVisible();
  expect((await confirmReconciliation(page)).status()).toBe(200);
  const draft = await readOrderAggregate(request, token, MAINLINE_ADDRESS_DATE);
  expect(draft.orders).toHaveLength(1);
  expect(draft.orders[0]).toMatchObject({ status: "draft", items: [expect.objectContaining({ quantity: 1 })] });
  expect(draft.orders[0]!.address ?? undefined).toBeUndefined();
  expect((typeof draft.orders[0]!.customer === "object" ? draft.orders[0]!.customer.address : "not-populated") ?? undefined).toBeUndefined();

  await openOrders(page, 1);
  const confirm = page.waitForResponse((res) => /\/orders\/[^/]+\/confirm$/.test(new URL(res.url()).pathname) && res.request().method() === "POST");
  await page.locator("taro-button-core").filter({ hasText: /^确认订单$/ }).click();
  expect((await confirm).status()).toBe(200);
  await expect(page.getByText("（无地址）", { exact: false })).toBeVisible();
  const delivery = await readDeliveryView(request, token, MAINLINE_ADDRESS_DATE);
  expect(delivery.sort).toEqual([expect.objectContaining({ address: "（无地址）", count: 1, fulfillments: [expect.objectContaining({ status: "pending" })] })]);
});

test("E2E-IDEMP-001：重复接龙、operation 重试与并发确认不重复经营数据", async ({ page, request }) => {
  const token = await apiLogin(request);
  await expect(readOrderAggregate(request, token, MAINLINE_IDEMP_DATE)).resolves.toEqual({ orders: [], fulfillments: [] });
  await login(page);
  expect((await chat(page, MAINLINE_IDEMP_TEXT)).status()).toBe(200);
  const operationRequest = await startReconciliation(page);
  const [firstOperation, operationRetries] = await Promise.all([operationRequest.response(), replayPost(page, operationRequest, 1)]);
  expect(firstOperation?.status()).toBe(200);
  expect(operationRetries).toEqual([expect.objectContaining({ status: 200, body: expect.objectContaining({ alreadyCompleted: true }) })]);

  expect((await chat(page, MAINLINE_IDEMP_TEXT)).status()).toBe(200);
  await expect(page.getByText("不变 1", { exact: false }).last()).toBeVisible();
  expect((await confirmReconciliation(page)).status()).toBe(200);
  const draft = await readOrderAggregate(request, token, MAINLINE_IDEMP_DATE);
  expect(draft.orders).toHaveLength(1);
  expect(draft.orders[0]!.items).toEqual([expect.objectContaining({ quantity: 2 })]);

  await openOrders(page, 2);
  const confirmPromise = page.waitForRequest((req) => /\/orders\/[^/]+\/confirm$/.test(new URL(req.url()).pathname) && req.method() === "POST");
  await page.locator("taro-button-core").filter({ hasText: /^确认订单$/ }).click();
  const confirmRequest = await confirmPromise;
  const [firstConfirm, retries] = await Promise.all([confirmRequest.response(), replayPost(page, confirmRequest, 3)]);
  if (!firstConfirm) throw new Error("order confirm response missing");
  const outcomes = [{ status: firstConfirm.status(), body: await firstConfirm.json() as Record<string, unknown> }, ...retries];
  expect(outcomes.every((outcome) => outcome.status === 200)).toBe(true);
  expect(outcomes.filter((outcome) => outcome.body.alreadyConfirmed === true)).toHaveLength(3);
  const final = await readOrderAggregate(request, token, MAINLINE_IDEMP_DATE);
  expect(final.orders).toEqual([expect.objectContaining({ status: "confirmed", items: [expect.objectContaining({ quantity: 2 })] })]);
  expect(final.fulfillments).toEqual([expect.objectContaining({ status: "pending", order: expect.objectContaining({ id: final.orders[0]!.id }) })]);
});
