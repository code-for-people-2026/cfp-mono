import { expect, test } from "@playwright/test";

const BE = "http://127.0.0.1:3311";
const PUBLIC_RISK_COPY = /点餐|外卖|团购|平台/;

test("顾客从分享页完成资料与多餐次登记并看到部分结果", async ({ page, request }) => {
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
    data: { targets: [{ date, occasion: "lunch" }, { date, occasion: "dinner" }], replaceExisting: false }
  });
  const { docs } = await generated.json() as { docs: Array<{ id: string | number }> };
  for (const [index, slot] of docs.entries()) expect((await request.patch(`${BE}/merchant/meal-slots/${slot.id}/booking-config`, {
    headers, data: { priceCents: 2800 + index * 200, orderDeadline: deadline, orderStatus: "open" }
  })).ok()).toBe(true);
  const created = await request.post(`${BE}/merchant/booking-batches`, {
    headers,
    data: { title: `顾客多餐预订-${suffix}`, mealSlotIds: docs.map(({ id }) => id) }
  });
  const { doc, share } = await created.json() as {
    doc: { id: string | number };
    share: { path: string };
  };

  await page.goto("/pages/booking/index");
  await expect(page.getByText("这个预订登记链接已失效，请从原预订卡片重新进入", { exact: true })).toBeVisible();
  await expect(page.locator(".page-state")).toContainText("请从原预订卡片重新进入");
  const firstStarted = Date.now();
  await page.goto(share.path);
  await expect(page.getByText(`顾客多餐预订-${suffix}`, { exact: true })).toBeVisible();
  await expect(page.getByText("桃子", { exact: true })).toBeVisible();
  await expect(page.getByText("¥28.00 / 份", { exact: true })).toBeVisible();
  for (const name of menuNames) await expect(page.getByText(name, { exact: true })).toHaveCount(2);
  await expect(page.getByText("可登记", { exact: true })).toHaveCount(2);
  await expect(page.getByText("用于桃子识别订单和送餐地址", { exact: true })).toBeVisible();
  await expect(page.locator(".booking-page")).not.toContainText(PUBLIC_RISK_COPY);
  await page.getByRole("textbox", { name: "称呼" }).fill("王阿姨");
  await page.getByRole("textbox", { name: "送餐地址" }).fill("3A-1201");
  await page.getByRole("spinbutton").nth(0).fill("2");
  await page.getByRole("spinbutton").nth(1).fill("1");
  await page.getByText("查看确认摘要", { exact: true }).click();
  await expect(page.getByText("总计：¥86.00", { exact: true })).toBeVisible();
  expect((await request.patch(`${BE}/merchant/meal-slots/${docs[0]!.id}/booking-config`, {
    headers, data: { priceCents: 2900, orderDeadline: deadline, orderStatus: "open" }
  })).ok()).toBe(true);
  await page.getByText("确认提交", { exact: true }).click();
  await expect(page.getByText("餐次价格已更新，请重新确认", { exact: true })).toBeVisible();
  await page.getByText("查看确认摘要", { exact: true }).click();
  await expect(page.getByText("总计：¥88.00", { exact: true })).toBeVisible();
  await page.getByText("确认提交", { exact: true }).dblclick();
  await expect(page.getByText("登记成功", { exact: true })).toHaveCount(2);
  await expect(page.getByText("查看我的预订", { exact: true })).toBeVisible();
  expect(Date.now() - firstStarted).toBeLessThan(90_000);
  let lunchOrderId: string | number | undefined;
  for (const occasion of ["lunch", "dinner"]) {
    const orders = await (await request.get(`${BE}/merchant/orders?date=${date}&occasion=${occasion}`, { headers })).json() as
      { docs: Array<{ id: string | number; source: string; displayName: string }> };
    const matches = orders.docs.filter(({ source, displayName }) => source === "customer-card" && displayName === "王阿姨");
    expect(matches).toHaveLength(1);
    if (occasion === "lunch") lunchOrderId = matches[0]!.id;
  }
  expect((await request.post(`${BE}/merchant/orders/${lunchOrderId}/cancel`, { headers })).ok()).toBe(true);
  await page.getByText("继续修改", { exact: true }).click();
  await page.getByText("查看确认摘要", { exact: true }).click();
  await page.getByText("确认提交", { exact: true }).click();
  await expect(page.getByText("失败：订单已取消，请确认后重登记", { exact: true })).toBeVisible();
  await page.getByText("确认重新登记已取消餐次", { exact: true }).click();
  await page.getByText("确认提交", { exact: true }).click();
  await expect(page.getByText("已重新登记", { exact: true })).toBeVisible();
  let raceCloseStatus = 0;
  await page.route("**/public/booking-batches/**", async (route) => {
    const response = await route.fetch();
    raceCloseStatus = (await request.patch(`${BE}/merchant/meal-slots/${docs[1]!.id}/booking-config`, {
      headers, data: { priceCents: 3000, orderDeadline: deadline, orderStatus: "closed" }
    })).status();
    await route.fulfill({ response });
  }, { times: 1 });
  await page.getByText("继续修改", { exact: true }).click();
  await page.getByText("查看确认摘要", { exact: true }).click();
  await page.getByText("确认提交", { exact: true }).click();
  await expect(page.getByText("已更新", { exact: true })).toBeVisible();
  await expect(page.getByText("失败：餐次已关闭登记", { exact: true })).toBeVisible();
  expect(raceCloseStatus).toBe(200);
  await page.reload();
  await expect(page).toHaveURL(/pages\/booking\/index\?batch=/);
  await expect(page.getByText(`顾客多餐预订-${suffix}`, { exact: true })).toBeVisible();
  const returningStarted = Date.now();
  await expect(page.getByText(/王阿姨.*3A-1201/)).toBeVisible();
  await page.getByRole("textbox", { name: "送餐地址" }).fill("本次地址");
  await page.getByRole("spinbutton").first().fill("3");
  await page.getByText("查看确认摘要", { exact: true }).click();
  await page.getByText("确认提交", { exact: true }).click();
  await expect(page.getByText("已更新", { exact: true })).toBeVisible();
  expect(Date.now() - returningStarted).toBeLessThan(45_000);
  const customerToken = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.kith_inn_v1_customer_session) as { data: string };
    return (JSON.parse(stored.data) as { token: string }).token;
  });
  const profilesResponse = await request.get(`${BE}/customer/profiles`, {
    headers: { Authorization: `Bearer ${customerToken}` }
  });
  const profiles = await profilesResponse.json() as { docs: Array<{ address: string }> };
  expect(profilesResponse.status(), JSON.stringify(profiles)).toBe(200);
  expect(profiles.docs).toEqual([expect.objectContaining({ address: "3A-1201" })]);

  const expiringDeadline = new Date(Date.now() + 5_000).toISOString();
  expect((await request.patch(`${BE}/merchant/meal-slots/${docs[0]!.id}/booking-config`, {
    headers, data: { priceCents: 2900, orderDeadline: expiringDeadline, orderStatus: "open" }
  })).ok()).toBe(true);
  await page.waitForTimeout(5_100);
  await page.reload();
  await expect(page.getByText("已过登记截止时间；如需登记请联系桃子", { exact: true })).toBeVisible();

  expect((await request.patch(`${BE}/merchant/booking-batches/${doc.id}`, {
    headers,
    data: { status: "closed" }
  })).ok()).toBe(true);
  let readOnlyProfileRequests = 0;
  await page.route("**/customer/profiles", async (route) => {
    readOnlyProfileRequests += 1;
    await route.fulfill({ status: 500, json: { error: "temporary", message: "临时失败" } });
  });
  await page.reload();
  await expect(page.getByText("批次已关闭", { exact: true })).toBeVisible();
  await expect(page.getByText("本批次已关闭，仅供查看；如有疑问请联系桃子", { exact: true })).toHaveCount(2);
  await expect(page.locator(".page-state")).toContainText("当前批次暂无可登记餐次");
  expect(readOnlyProfileRequests).toBe(0);
  await page.getByText("查看个人信息用途说明", { exact: true }).click();
  await expect(page.locator(".privacy-page")).not.toContainText(PUBLIC_RISK_COPY);
  await expect(page.getByText(
    "称呼用于当前商家识别您的预订登记，地址用于按约定送达。",
    { exact: true }
  )).toBeVisible();
  await expect(page.getByText(
    "首次提交新资料时，会先保存为常用资料；即使餐次登记因状态变化失败，该资料仍会保留。",
    { exact: true }
  )).toBeVisible();
});
