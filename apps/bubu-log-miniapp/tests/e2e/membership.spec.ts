import { expect, test, type Page } from "@playwright/test";
import { emptyRecordSummary } from "../fixtures/records";
import type { MembershipStatus } from "../../src/membership/contracts";

test.skip(process.env.BUBU_AUTH_MODE === "legacy", "Membership is provided by the independent service");
test.use({ timezoneId: "America/Los_Angeles" });
const baby = { id: "membership-baby", name: "示例宝宝" };
const free: MembershipStatus = { babyId: baby.id, version: 0, status: "free", label: "限时免费", message: "首期限时免费，截止时间尚未设置。", startsAt: null, endsAt: null,
  entitlements: { chat: true, collection: true, history: true }, payment: { enabled: false } };

async function fixture(page: Page) {
  let current = free;
  let failure = false;
  const activity = { id: "history-feeding", babyId: baby.id, type: "BOTTLE", startTime: "2026-10-23T08:00:00Z", milkAmount: 90 };
  await page.clock.setFixedTime(new Date("2026-10-23T20:00:00+08:00"));
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (url.pathname === "/api/app/auth/context") return json({ authenticated: true, identityId: "membership-caregiver", legacyLinked: false, hasBaby: true, baby, babies: [baby] });
    expect(url.searchParams.get("babyId")).toBe(baby.id);
    if (url.pathname === "/api/app/membership") return failure ? json({ error: "服务状态读取失败", code: "MEMBERSHIP_UNAVAILABLE" }, 503) : json(current);
    if (url.pathname === "/api/app/records/snapshot") return json({ activities: [activity], events: [], questions: [], summary: emptyRecordSummary() });
    if (url.pathname === "/api/app/activities") return json([activity]);
    if (url.pathname === "/api/app/activities/latest") return json(null);
    if (url.pathname === "/api/app/chat") return json({ babyId: baby.id, conversationId: "membership-chat", turns: [], pending: [], pendingCount: 0 });
    if (["/api/app/records/sync", "/api/app/records/pending", "/api/app/daily-stats"].includes(url.pathname)) return json([]);
    return json({ error: "Unexpected endpoint" }, 404);
  });
  return { update: (value: MembershipStatus) => { current = value; }, fail: (value: boolean) => { failure = value; } };
}
async function openMenu(page: Page) { await page.getByLabel("打开菜单", { exact: true }).click(); }
async function closeMenu(page: Page) { await page.getByLabel("关闭菜单", { exact: true }).click(); }

test("an unconfigured free service has no invented dates or purchase entry", async ({ page }) => {
  await fixture(page); await page.goto("/"); await openMenu(page);
  await expect(page.locator(".diary-service-label")).toHaveText("限时免费");
  await expect(page.locator(".diary-service-date")).toHaveCount(0);
  await expect(page.locator(".diary-service-status")).toContainText("授权照护者共享服务");
  await expect(page.locator(".diary-drawer")).not.toContainText(/购买|账单|倒计时|模型选择/);
  await page.screenshot({ path: "test-results/membership-free-menu.png", fullPage: true });
});

test("server pause, expiry and restoration remain explainable while historical facts stay readable", async ({ page }) => {
  const service = await fixture(page);
  await page.goto("/");
  for (const [status, label, message] of [["paused", "服务已暂停", "正在核对服务设置，恢复后可以继续。"], ["expired", "免费体验已到期", "已设置的免费体验已结束，历史记录继续保留。"]] as const) {
    service.update({ ...free, version: 2, status, label, message, endsAt: "2026-10-22T00:00:00Z", entitlements: { chat: false, collection: false, history: true } });
    await openMenu(page);
    await expect(page.locator(".diary-service-label")).toHaveText(label);
    await expect(page.locator(".diary-service-message")).toHaveText(message);
    await expect(page.locator(".diary-service-date")).toContainText("2026/10/22");
    await page.locator(".diary-menu-link").filter({ has: page.getByText("历史数据", { exact: true }) }).click();
    await expect(page.locator(".record-row")).toContainText(/90\s*ml/);
  }
  service.update({ ...free, version: 3, message: "服务已恢复，当前可免费使用。" });
  await openMenu(page);
  await expect(page.locator(".diary-service-label")).toHaveText("限时免费");
  await expect(page.locator(".diary-service-date")).toHaveCount(0);
});

test("a failed refresh removes free status and retry shows only configured dates", async ({ page }) => {
  const service = await fixture(page);
  await page.goto("/"); await openMenu(page);
  await expect(page.locator(".diary-service-label")).toHaveText("限时免费");
  await closeMenu(page); service.fail(true); await openMenu(page);
  await expect(page.locator(".diary-service-label")).toHaveText("暂时无法读取服务状态");
  await expect(page.locator(".diary-service-status")).not.toContainText("限时免费");
  await page.screenshot({ path: "test-results/membership-unavailable-menu.png", fullPage: true });
  service.fail(false);
  service.update({ ...free, version: 2, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", message: "免费体验已延长，以此服务状态为准。" });
  await page.getByText("重试读取", { exact: true }).click();
  await expect(page.locator(".diary-service-label")).toHaveText("限时免费");
  await expect(page.locator(".diary-service-date")).toHaveCount(2);
  await expect(page.locator(".diary-service-date").first()).toHaveText("开始时间：2026/10/01 08:00");
  await expect(page.locator(".diary-service-date").last()).toHaveText("截止时间：2026/11/01 08:00");
  await expect(page.locator(".diary-service-message")).toContainText("已延长");
});
