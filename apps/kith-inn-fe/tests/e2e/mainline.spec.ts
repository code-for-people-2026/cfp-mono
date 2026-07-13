import { expect, test } from "@playwright/test";
import type { Fulfillment, ServiceSlot } from "@cfp/kith-inn-shared";
import { MAINLINE_ORDER_TEXT } from "./fixtures/fixed-llm-server";
import {
  MAINLINE_BE,
  MAINLINE_LLM,
  apiLogin,
  expectOrderAggregate,
  freezeMainlineDate,
  readOrderAggregate,
} from "./fixtures/mainline";

test.beforeEach(async ({ page }) => freezeMainlineDate(page));

test("E2E-ORDER-001：H5 接龙 preview 到确认订单贯通真实 PostgreSQL", async ({ page, request }) => {
  const token = await apiLogin(request);
  await expect(readOrderAggregate(request, token)).resolves.toEqual({ orders: [], fulfillments: [] });
  expect((await request.post(`${MAINLINE_LLM}/chat/completions`, {
    data: { messages: [{ role: "user", content: "未登记场景" }] },
  })).status()).toBe(422);

  await page.goto("/");
  const loginResponse = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/auth/dev-login`);
  await page.getByText("开发登录（跳过微信）", { exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/pages\/today\/index/);

  await page.getByRole("textbox", { name: "粘接龙，或说 26B 送了" }).fill(MAINLINE_ORDER_TEXT);
  const chatResponse = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/chat` && response.request().method() === "POST");
  await page.getByText("↑", { exact: true }).click();
  expect((await chatResponse).status()).toBe(200);
  await expect(page.getByText("新增 3", { exact: false })).toBeVisible();
  await expect(page.getByText("新增 · 2026-07-13 午餐 · 王燕萍 · 2份", { exact: true })).toBeVisible();
  await expect(page.getByText("新顾客", { exact: false })).toHaveCount(3);
  await expect(readOrderAggregate(request, token)).resolves.toEqual({ orders: [], fulfillments: [] });

  const reconcileResponse = page.waitForResponse((response) => response.url() === `${MAINLINE_BE}/chat/confirm-operation`);
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
    const responsePromise = page.waitForResponse((response) => /\/orders\/[^/]+\/confirm$/.test(new URL(response.url()).pathname));
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
