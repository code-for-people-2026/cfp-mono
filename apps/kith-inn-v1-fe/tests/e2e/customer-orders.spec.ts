import { expect, test, type APIResponse } from "@playwright/test";

const BE = "http://127.0.0.1:3311";

test("顾客修改取消自有订单，桃子确认后锁单且停用资料不影响历史", async ({ page, request }) => {
  const suffix = Date.now().toString(36);
  const profileName = `自助顾客-${suffix}`;
  let first = new Date(Date.now() + (220 + Date.now() % 700) * 86_400_000);
  let dates: string[] = [];
  let deadline = "";
  const login = await request.post(`${BE}/auth/operator/dev-login`, { data: { openid: "taozi-v1-dev-openid" } });
  const operatorHeaders = { Authorization: `Bearer ${(await login.json() as { token: string }).token}` };
  const text = [`自助荤一-${suffix} 牛肉 荤`, `自助荤二-${suffix} 猪肉 荤`, `自助素一-${suffix} 青菜 素`,
    `自助素二-${suffix} 豆腐 素`, `自助汤-${suffix} 番茄 汤`].join("\n");
  expect((await request.post(`${BE}/merchant/offerings/import/commit`, {
    headers: operatorHeaders, data: { text, conflicts: [] }
  })).ok()).toBe(true);
  let generated: APIResponse;
  for (let attempt = 0; ; attempt += 1) {
    dates = [first, new Date(first.getTime() + 86_400_000)].map((date) => date.toISOString().slice(0, 10));
    deadline = new Date(first.getTime() - 86_400_000).toISOString();
    generated = await request.post(`${BE}/merchant/meal-slots/generate-menus`, { headers: operatorHeaders,
      data: { targets: dates.map((date) => ({ date, occasion: "lunch" })), replaceExisting: false } });
    if (generated.status() !== 409 || attempt === 9) break;
    first = new Date(first.getTime() + 2 * 86_400_000);
  }
  expect(generated.ok(), `菜单生成返回 ${generated.status()}`).toBe(true);
  const slots = (await generated.json() as { docs: Array<{ id: string | number }> }).docs;
  for (const slot of slots) expect((await request.patch(`${BE}/merchant/meal-slots/${slot.id}/booking-config`, {
    headers: operatorHeaders, data: { priceCents: 3000, orderDeadline: deadline, orderStatus: "open" }
  })).ok()).toBe(true);
  const created = await request.post(`${BE}/merchant/booking-batches`, { headers: operatorHeaders,
    data: { title: `我的预订-${suffix}`, mealSlotIds: slots.map(({ id }) => id) } });
  const { doc, share } = await created.json() as { doc: { publicId: string }; share: { path: string } };
  const customerLogin = await request.post(`${BE}/auth/customer/dev-session`, {
    data: { openid: "e2e-customer-openid", batchPublicId: doc.publicId }
  });
  const customerHeaders = { Authorization: `Bearer ${(await customerLogin.json() as { token: string }).token}` };
  const reserved = await request.post(`${BE}/customer/reservations`, { headers: customerHeaders, data: {
    batchPublicId: doc.publicId, profile: { newProfile: { displayName: profileName, address: "3A" } },
    displayName: profileName, address: "3A", items: dates.map((date) => ({
      target: { date, occasion: "lunch" }, quantity: 2, resubmitCanceled: false
    }))
  } });
  const orderIds = (await reserved.json() as { results: Array<{ doc: { id: string | number } }> })
    .results.map(({ doc: order }) => order.id);

  await page.goto(share.path);
  await page.getByText("查看我的预订", { exact: true }).click();
  const currentCards = page.locator(".customer-order-card").filter({ hasText: profileName });
  await expect(currentCards).toHaveCount(2);
  await expect(currentCards.getByText("待桃子确认", { exact: true })).toHaveCount(2);
  await currentCards.first().getByRole("spinbutton").fill("3");
  await currentCards.first().getByText("修改份数", { exact: true }).click();
  await expect(currentCards.first()).toContainText("3 份｜¥90.00");
  await currentCards.first().getByText("取消预订", { exact: true }).click();
  await currentCards.first().getByText("确认取消", { exact: true }).click();
  await expect(currentCards.first().getByText("已取消", { exact: true })).toBeVisible();
  expect((await request.post(`${BE}/merchant/orders/${orderIds[0]}/confirm`, { headers: operatorHeaders })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("桃子已确认，请在群里联系桃子", { exact: true })).toBeVisible();
  await page.getByText(`停用资料：${profileName}`, { exact: true }).click();
  await page.getByText(`确认停用${profileName}`, { exact: true }).click();
  await expect(page.getByText(`停用资料：${profileName}`, { exact: true })).toHaveCount(0);
  await expect(currentCards).toHaveCount(2);
});
