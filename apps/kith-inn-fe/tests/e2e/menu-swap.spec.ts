import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";
import type { MenuPlanView, Offering } from "@cfp/kith-inn-shared";
import { todayShanghai } from "../../src/logic/time";

const BE = "http://127.0.0.1:3310";

function addDays(iso: string, amount: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

async function expectOk(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(response.ok(), `${response.url()} → ${response.status()}`).toBe(true);
  return response;
}

async function generateLunch(request: APIRequestContext, token: string, date: string): Promise<MenuPlanView> {
  const response = await expectOk(await request.post(`${BE}/menu/generate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { targets: [{ date, occasion: "lunch" }] },
  }));
  const body = await response.json() as { plans: MenuPlanView[] };
  expect(body.plans).toHaveLength(1);
  return body.plans[0]!;
}

async function dishNames(card: Locator): Promise<string[]> {
  const swapButtons = card.locator("taro-button-core").filter({ hasText: /^换$/ });
  await expect(swapButtons).toHaveCount(5);
  return swapButtons.locator("..").locator("taro-text-core").allInnerTexts();
}

test("唯一冲突候选仍可换，并在 H5 显示放宽原因", async ({ page, request }) => {
  const login = await expectOk(await request.post(`${BE}/auth/dev-login`, {
    data: { openid: "taozi-dev-openid" },
  }));
  const { token } = await login.json() as { token: string };
  const headers = { Authorization: `Bearer ${token}` };

  const offeringsResponse = await request.get(`${BE}/offerings`, { headers });
  expect(offeringsResponse.ok()).toBe(true);
  const { offerings } = await offeringsResponse.json() as { offerings: Offering[] };
  const today = todayShanghai();
  const historyPlan = await generateLunch(request, token, addDays(today, -1));
  const currentPlan = await generateLunch(request, token, today);
  const targetIndex = currentPlan.dishes.findIndex((dish) => dish.category === "soup");
  const target = currentPlan.dishes[targetIndex]!;
  const candidate = offerings.find((offering) =>
    offering.active !== false &&
    offering.category === "soup" &&
    !currentPlan.dishes.some((dish) => String(dish.id) === String(offering.id))
  );
  expect(targetIndex).toBeGreaterThanOrEqual(0);
  expect(candidate).toBeDefined();

  if (!historyPlan.dishes.some((dish) => String(dish.id) === String(candidate!.id))) {
    const historySoupIndex = historyPlan.dishes.findIndex((dish) => dish.category === "soup");
    const historySoup = historyPlan.dishes[historySoupIndex]!;
    await expectOk(await request.post(`${BE}/menu/plans/${historyPlan.planId}/swap`, {
      headers,
      data: {
        dishId: historySoup.id,
        dishIndex: historySoupIndex,
        replacementId: candidate!.id,
      },
    }));
  }

  for (const offering of offerings) {
    if (
      offering.active !== false &&
      offering.category === "soup" &&
      String(offering.id) !== String(target.id) &&
      String(offering.id) !== String(candidate!.id)
    ) {
      await expectOk(await request.delete(`${BE}/offerings/${offering.id}`, { headers }));
    }
  }

  await page.goto("/");
  await page.getByText("开发登录（跳过微信）", { exact: true }).click();
  await expect(page).toHaveURL(/pages\/today\/index/);
  await page.getByText("菜单", { exact: true }).click();
  await expect(page).toHaveURL(/pages\/menu\/index/);
  const lunchCard = page.locator(".card").filter({
    has: page.getByText("午餐", { exact: true }),
  }).first();
  await expect(lunchCard).toBeVisible();
  await expect.poll(() => dishNames(lunchCard)).toEqual(currentPlan.dishes.map((dish) => dish.name));

  const swapResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/menu/plans/${currentPlan.planId}/swap`) &&
    response.request().method() === "POST"
  );
  await lunchCard.getByText(target.name, { exact: true }).locator("..").locator("taro-button-core").click();
  const swapResponse = await swapResponsePromise;
  expect(swapResponse.status()).toBe(200);
  const swapBody = await swapResponse.json() as {
    plan: MenuPlanView;
    relaxedRules: string[];
  };
  expect(swapBody.relaxedRules).toContain("recent-offering");

  const expectedNames = currentPlan.dishes.map((dish, index) => index === targetIndex ? candidate!.name : dish.name);
  await expect.poll(() => dishNames(lunchCard)).toEqual(expectedNames);
  await expect(lunchCard.getByText("菜品池较小，本次允许：", { exact: false })).toBeVisible();
  await expect(lunchCard.getByText("近 7 天已安排过同一道菜", { exact: false })).toBeVisible();
});
