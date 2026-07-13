import { expect, test, type Page, type Response } from "@playwright/test";
import type { Fulfillment, ServiceSlot } from "@cfp/kith-inn-shared";
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
  const response = page.waitForResponse((res) => res.url() === `${MAINLINE_BE}/chat/confirm-operation` && res.request().method() === "POST");
  await page.locator("taro-button-core").filter({ hasText: /^确认按本次更新$/ }).click();
  return response;
}

async function openOrders(page: Page, daysAfterToday: number) {
  await page.getByText("订单", { exact: true }).click();
  await expect(page).toHaveURL(/pages\/orders\/index/);
  const nextDay = page.locator("taro-button-core").filter({ hasText: /^后一天$/ });
  for (let day = 0; day < daysAfterToday; day++) await nextDay.click();
}

async function replayPost(page: Page, source: Response, count: number) {
  const request = source.request();
  const authorization = (await request.allHeaders()).authorization;
  return page.evaluate(async ({ url, authorization, body, count }) => Promise.all(Array.from({ length: count }, async () => {
    const response = await fetch(url, { method: "POST", headers: { Authorization: authorization, "content-type": "application/json" }, body: body ?? undefined });
    return { status: response.status, body: await response.json() as unknown };
  })), { url: request.url(), authorization, body: request.postData(), count });
}

test("E2E-ORDER-001：H5 接龙 preview 到确认订单贯通真实 PostgreSQL", async ({ page, request }) => {
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
  await expect(page.getByPlaceholder("填地址（如 3a27a）")).toBeVisible();
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
  const firstOperation = await confirmReconciliation(page);
  expect(firstOperation.status()).toBe(200);
  expect(await replayPost(page, firstOperation, 1)).toEqual([expect.objectContaining({ status: 200, body: expect.objectContaining({ alreadyCompleted: true }) })]);

  expect((await chat(page, MAINLINE_IDEMP_TEXT)).status()).toBe(200);
  await expect(page.getByText("不变 1", { exact: false }).last()).toBeVisible();
  expect((await confirmReconciliation(page)).status()).toBe(200);
  const draft = await readOrderAggregate(request, token, MAINLINE_IDEMP_DATE);
  expect(draft.orders).toHaveLength(1);
  expect(draft.orders[0]!.items).toEqual([expect.objectContaining({ quantity: 2 })]);

  await openOrders(page, 2);
  const confirmPromise = page.waitForResponse((res) => /\/orders\/[^/]+\/confirm$/.test(new URL(res.url()).pathname) && res.request().method() === "POST");
  await page.locator("taro-button-core").filter({ hasText: /^确认订单$/ }).click();
  const firstConfirm = await confirmPromise;
  expect(firstConfirm.status()).toBe(200);
  const retries = await replayPost(page, firstConfirm, 3);
  expect(retries).toEqual(Array(3).fill(expect.objectContaining({ status: 200, body: expect.objectContaining({ alreadyConfirmed: true }) })));
  const final = await readOrderAggregate(request, token, MAINLINE_IDEMP_DATE);
  expect(final.orders).toEqual([expect.objectContaining({ status: "confirmed", items: [expect.objectContaining({ quantity: 2 })] })]);
  expect(final.fulfillments).toEqual([expect.objectContaining({ status: "pending", order: expect.objectContaining({ id: final.orders[0]!.id }) })]);
});
