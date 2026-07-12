import { expect, test } from "@playwright/test";

const BE = "http://127.0.0.1:3311";

test("顾客静默登录后读取分享批次、恢复 query 并只读查看关闭状态", async ({ page, request }) => {
  const suffix = Date.now().toString(36);
  const target = new Date(Date.now() + (180 + Date.now() % 80) * 86_400_000);
  const date = target.toISOString().slice(0, 10);
  const deadline = new Date(target.getTime() - 86_400_000).toISOString();
  const login = await request.post(`${BE}/auth/operator/dev-login`, { data: { openid: "taozi-v1-dev-openid" } });
  const { token } = await login.json() as { token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const menuNames = [`顾客荤一-${suffix}`, `顾客荤二-${suffix}`, `顾客素一-${suffix}`, `顾客素二-${suffix}`, `顾客汤-${suffix}`];
  const text = [
    `${menuNames[0]} 牛肉 荤`,
    `${menuNames[1]} 猪肉 荤`,
    `${menuNames[2]} 青菜 素`,
    `${menuNames[3]} 豆腐 素`,
    `${menuNames[4]} 番茄 汤`
  ].join("\n");
  expect((await request.post(`${BE}/merchant/offerings/import/commit`, { headers, data: { text, conflicts: [] } })).ok()).toBe(true);
  const generated = await request.post(`${BE}/merchant/meal-slots/generate-menus`, {
    headers,
    data: { targets: [{ date, occasion: "lunch" }], replaceExisting: false }
  });
  const { docs } = await generated.json() as { docs: Array<{ id: string | number }> };
  expect((await request.patch(`${BE}/merchant/meal-slots/${docs[0]!.id}/booking-config`, {
    headers,
    data: { priceCents: 2800, orderDeadline: deadline, orderStatus: "open" }
  })).ok()).toBe(true);
  const created = await request.post(`${BE}/merchant/booking-batches`, {
    headers,
    data: { title: `顾客只读预订-${suffix}`, mealSlotIds: [docs[0]!.id] }
  });
  const { doc, share } = await created.json() as {
    doc: { id: string | number };
    share: { path: string };
  };

  await page.goto("/pages/booking/index");
  await expect(page.getByText("这个预订登记链接已失效", { exact: true })).toBeVisible();
  await page.goto(share.path);
  await expect(page.getByText(`顾客只读预订-${suffix}`, { exact: true })).toBeVisible();
  await expect(page.getByText("桃子", { exact: true })).toBeVisible();
  await expect(page.getByText("¥28.00 / 份", { exact: true })).toBeVisible();
  for (const name of menuNames) await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText("可登记", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/pages\/booking\/index\?batch=/);
  await expect(page.getByText(`顾客只读预订-${suffix}`, { exact: true })).toBeVisible();

  expect((await request.patch(`${BE}/merchant/booking-batches/${doc.id}`, {
    headers,
    data: { status: "closed" }
  })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByText("批次已关闭", { exact: true })).toBeVisible();
  await expect(page.getByText("本批次已关闭，仅供查看", { exact: true })).toBeVisible();
});
