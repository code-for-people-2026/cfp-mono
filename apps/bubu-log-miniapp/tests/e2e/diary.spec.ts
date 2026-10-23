import { expect, test, type Page } from "@playwright/test";

// Synthetic records only: this suite never connects to a family account or database.
const baby = { id: "test-baby", name: "小满", fullName: null, avatarUrl: null, isDefault: true };
const context = { authenticated: true, hasBaby: true, baby, babies: [baby], defaultBabyId: baby.id };
const activity = (id: string, type: string, startTime: string, extra = {}) => ({ id, babyId: baby.id, type, startTime, ...extra });
const records = [
  activity("sleep", "SLEEP", "2026-10-22T23:00:00+08:00", { endTime: "2026-10-23T07:00:00+08:00" }),
  activity("milk", "BOTTLE", "2026-10-23T08:30:00+08:00", { endTime: "2026-10-23T08:45:00+08:00", milkAmount: 120, milkSource: "FORMULA", burpSuccess: true, notes: "测试记录：喝得很慢" }),
  activity("diaper", "DIAPER", "2026-10-23T09:15:00+08:00", { hasPee: true, peeAmount: "LARGE", hasPoop: true, poopColor: "YELLOW" }),
  activity("head", "HEAD_LIFT", "2026-10-23T10:00:00+08:00", { endTime: "2026-10-23T10:10:00+08:00" }),
];
const daily = Array.from({ length: 30 }, (_, i) => ({
  id: `stat-${i}`, babyId: baby.id, date: new Date(Date.UTC(2026, 9, 23 - i)).toISOString().slice(0, 10),
  sleepCount: 4, totalSleepMinutes: 450 + i * 9, totalMilkAmount: 420 + i * 6,
  totalPumpMilkAmount: 160 + i * 3, diaperCount: 4 + i % 3,
}));

async function fixture(page: Page, options: { authenticated?: boolean; failActivities?: boolean; failProfile?: boolean } = {}) {
  await page.clock.install({ time: new Date("2026-10-23T13:00:00+08:00") });
  let loggedIn = options.authenticated ?? true;
  const currentBaby = { ...baby };
  const requests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname === "/api/auth/csrf") return json({ csrfToken: "test-csrf" });
    if (url.pathname === "/api/auth/callback/credentials") { loggedIn = true; return json({ url: "http://127.0.0.1:4338" }); }
    if (url.pathname === "/api/auth/signout") { loggedIn = false; return json({ url: "http://127.0.0.1:4338" }); }
    if (url.pathname === "/api/app/auth/context") return loggedIn ? json({ ...context, baby: currentBaby, babies: [currentBaby] }) : json({ authenticated: false, hasBaby: false }, 401);
    if (!loggedIn) return json({ code: "UNAUTHORIZED" }, 401);
    expect(url.searchParams.get("babyId")).toBe(baby.id);
    expect(route.request().headers()["x-baby-id"]).toBe(baby.id);
    if (url.pathname === `/api/app/user-babies/${baby.id}` && route.request().method() === "PATCH") {
      if (options.failProfile) return json({ error: "已存在同名宝宝" }, 409);
      Object.assign(currentBaby, route.request().postDataJSON());
      return json({ data: currentBaby });
    }
    if (url.pathname === "/api/app/activities") {
      if (options.failActivities) return json({ error: "test outage" }, 503);
      return json(url.searchParams.get("date") === "2026-10-22" ? [] : records);
    }
    if (url.pathname === "/api/app/activities/latest") return json(records.find((row) => url.searchParams.get("types")?.includes(row.type)) || null);
    if (url.pathname.startsWith("/api/app/activities/")) return json(records.find((row) => row.id === url.pathname.split("/").pop()));
    if (url.pathname === "/api/app/daily-stats") return json(daily.filter((row) => row.date >= url.searchParams.get("startDate")! && row.date <= url.searchParams.get("endDate")!));
    return json({ error: "Unexpected endpoint" }, 404);
  });
  return requests;
}

async function menu(page: Page, label: string) {
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-drawer").locator("taro-button-core").filter({ has: page.getByText(label, { exact: true }) }).click();
}
async function calendarView(page: Page, label: string) {
  if (!await page.locator(".calendar-view-select").count()) await menu(page, "日历首页");
  await page.locator(".calendar-view-select").click();
  await page.locator(".calendar-view-option").filter({ hasText: new RegExp(`^${label}$`) }).click();
}

test("existing account opens day, week, heatmap, trends and read-only details", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests = await fixture(page, { authenticated: false });
  await page.goto("/");
  await page.locator('input[placeholder="请输入用户名或邮箱"]').fill("parent");
  await page.locator('input[placeholder="请输入密码"]').fill("test-password");
  await page.getByText("登录", { exact: true }).click();
  await expect(page.locator(".diary-title")).toHaveText("哺哺日记");
  await expect(page.locator(".stats-grid")).toContainText("120 ml");
  await page.screenshot({ path: "test-results/diary-day.png", fullPage: true });
  await calendarView(page, "周历");
  await expect(page.locator(".bubu-week-card")).toBeVisible();
  await page.screenshot({ path: "test-results/diary-week.png", fullPage: true });
  await calendarView(page, "月历");
  await expect(page.locator(".bubu-heatmap-card")).toBeVisible();
  await expect(page.locator(".data-note")).toBeVisible();
  await page.screenshot({ path: "test-results/diary-month.png", fullPage: true });
  await page.getByText("查看当天 ›", { exact: true }).click();
  await expect(page.locator(".record-row")).toHaveCount(1);
  await expect(page.locator(".record-row")).toContainText("睡眠");
  await calendarView(page, "月历");
  await page.getByText("奶量", { exact: true }).click();
  await page.getByText("查看当天 ›", { exact: true }).click();
  await expect(page.locator(".record-row")).toHaveCount(1);
  await expect(page.locator(".record-row")).toContainText("120");
  await menu(page, "趋势统计");
  await expect(page.locator(".data-note")).toBeVisible();
  await expect(page.locator(".bubu-chart-line").first()).toBeVisible();
  await expect(page.locator(".bubu-chart-point")).toHaveCount(28);
  await page.screenshot({ path: "test-results/diary-trends.png", fullPage: true });
  await page.getByText("14 天", { exact: true }).click();
  await expect(page.locator(".bubu-chart-point")).toHaveCount(56);
  await page.getByText("30 天", { exact: true }).click();
  await expect(page.locator(".bubu-chart-point")).toHaveCount(120);
  await menu(page, "历史数据");

  await expect(page.locator(".record-row")).toHaveCount(4);
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await expect(page.getByText("测试记录：喝得很慢", { exact: true }).last()).toBeVisible();
  await page.screenshot({ path: "test-results/diary-detail.png", fullPage: true });
  expect(requests.filter((request) => request.startsWith("POST /api/app"))).toEqual([]);
  expect(errors).toEqual([]);
});

test("failed reads show retry instead of zero-valued statistics", async ({ page }) => {
  await fixture(page, { failActivities: true });
  await page.goto("/");
  await expect(page.getByText("重试", { exact: true })).toBeVisible();
  await expect(page.locator(".stats-grid")).toHaveCount(0);
});

test("switching date removes previous records and logout clears the private view", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect(page.locator(".stats-grid")).toContainText("120 ml");
  await page.getByText("‹", { exact: true }).click();
  await expect(page.locator(".stats-grid")).toContainText("0 ml");
  await expect(page.locator(".stats-grid")).not.toContainText("120 ml");
  await menu(page, "退出登录");
  await expect(page.locator('input[placeholder="请输入密码"]')).toBeVisible();
  await expect(page.locator(".stats-grid")).toHaveCount(0);
});

test("menu settings persist baby names and return to the same calendar date", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  await page.getByLabel("上一段日期", { exact: true }).click();
  await expect(page.locator(".date-title")).toContainText("10月22日");
  await menu(page, "设置");
  await page.locator('input[placeholder="怎么称呼宝宝"]').fill("小米");
  await page.locator('input[placeholder="宝宝的大名"]').fill("测试姓名");
  await page.getByText("保存", { exact: true }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.getByText("‹ 返回", { exact: true }).click();
  await expect(page.locator(".date-title")).toContainText("10月22日");
  await page.getByLabel("打开菜单", { exact: true }).click();
  await expect(page.locator(".diary-baby-name")).toHaveText("小米");
  await page.screenshot({ path: "test-results/diary-menu.png", fullPage: true });
  await page.locator(".diary-menu-link").filter({ has: page.getByText("设置", { exact: true }) }).click();
  await expect(page.locator('input[placeholder="怎么称呼宝宝"]')).toHaveValue("小米");
  await expect(page.locator('input[placeholder="宝宝的大名"]')).toHaveValue("测试姓名");
  await page.screenshot({ path: "test-results/diary-settings.png", fullPage: true });
});

test("rejected name updates retain the draft and never report success", async ({ page }) => {
  await fixture(page, { failProfile: true });
  await page.goto("/");
  await menu(page, "设置");
  await page.locator('input[placeholder="怎么称呼宝宝"]').fill("重名宝宝");
  await page.getByText("保存", { exact: true }).click();
  await expect(page.getByText("已存在同名宝宝", { exact: true })).toBeVisible();
  await expect(page.getByText("已保存", { exact: true })).toHaveCount(0);
  await expect(page.locator('input[placeholder="怎么称呼宝宝"]')).toHaveValue("重名宝宝");
});
