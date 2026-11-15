import { expect, test } from "@playwright/test";
import { policy, personal, guardian } from "../fixtures/privacy";
import { emptyRecordSummary } from "../fixtures/records";

test("requires separate choices before calendar data, then exposes rights in the menu", async ({ page }) => {
  let person = false, child = false;
  let savedPersonal = { ...personal, ai: false, images: false }, savedGuardian = { ...guardian, ai: false, images: false };
  const reads: string[] = [], choices: unknown[] = [];
  const baby = { id: "privacy-baby", name: "合成宝宝" };
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url()), body = route.request().method() === "POST" ? route.request().postDataJSON() : undefined;
    const json = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === "/api/app/privacy/policy") return json(policy);
    if (url.pathname === "/api/app/privacy/status") return json({ policy, consentCurrent: person, guardianCurrent: child, canManage: true, consent: person ? savedPersonal : null, guardian: child ? savedGuardian : null });
    if (url.pathname === "/api/app/privacy/consent") { choices.push(body); savedPersonal = body; person = true; return json({}); }
    if (url.pathname === "/api/app/privacy/guardian") { choices.push(body); savedGuardian = { ...body.consent, isOwn: true }; child = true; return json({}); }
    if (url.pathname === "/api/app/privacy/requests" || url.pathname === "/api/app/privacy/deletions" || url.pathname === "/api/app/safety") return json({ data: [] });
    if (url.pathname === "/api/app/auth/context") return json({ authenticated: true, identityId: "privacy-person", legacyLinked: true, hasBaby: true, baby, babies: [baby] });
    if (url.pathname === "/api/app/records/snapshot") { reads.push(url.pathname); return json({ activities: [], events: [], questions: [], summary: emptyRecordSummary() }); }
    if (url.pathname === "/api/app/activities/latest") return json(null);
    if (url.pathname === "/api/app/chat") return json({ babyId: baby.id, conversationId: "privacy-test-chat", turns: [], pending: [], pendingCount: 0 });
    return json([]);
  });
  await page.goto("/");
  await expect(page.getByText("本人的选择", { exact: true })).toBeVisible();
  expect(reads).toEqual([]);
  const choose = (label: string) => page.locator(".privacy-choice").filter({ hasText: label }).locator("input").check();
  await choose("我已阅读并同意隐私及服务说明"); await choose("我是成年照护者"); await choose("同意为记录照护而处理敏感信息");
  await page.getByText("保存本人选择", { exact: true }).click();
  await expect(page.getByText("已保存本人选择")).toBeVisible(); expect(reads).toEqual([]);
  expect(choices[0]).toMatchObject({ ai: false, images: false });
  await choose("我是这位宝宝的成年监护人"); await choose("同意为照护记录处理宝宝的敏感信息");
  await page.getByText("保存监护授权", { exact: true }).click();
  await expect(page.getByText("已保存监护授权")).toBeVisible();
  await page.getByText("返回日历", { exact: true }).click();
  await expect(page.locator(".bubu-day-card")).toBeVisible(); expect(reads.length).toBeGreaterThan(0);
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-menu-footer").getByText("隐私与安全", { exact: true }).click();
  await expect(page.getByText("申请注销本人账号", { exact: true })).toBeVisible();
  await expect.poll(async () => (await page.locator(".privacy-center").last().boundingBox())?.x ?? 1000).toBeLessThan(40);
  await page.screenshot({ path: "test-results/privacy-center.png" });
});

test("shows delayed group notices with both times and keeps acknowledgement scoped to the baby", async ({ page }) => {
  const baby = { id: "safety-baby", name: "合成宝宝" }, seen: unknown[] = [];
  const sentAt = "2026-10-23T00:05:00Z", observedAt = "2026-10-24T00:30:00Z";
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url()), json = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === "/api/app/auth/context") return json({ authenticated: true, identityId: "safety-parent", legacyLinked: true, hasBaby: true, baby, babies: [baby] });
    if (url.pathname === "/api/app/privacy/policy") return json(policy);
    if (url.pathname === "/api/app/privacy/status") return json({ policy, consentCurrent: true, guardianCurrent: true, canManage: true, consent: personal, guardian });
    if (url.pathname === "/api/app/safety") return json({ data: [{ id: "synthetic-notice", babyId: baby.id, source: "group", sentAt, observedAt, message: `原消息时间：${sentAt}；采集时间：${observedAt}。这不代表当前仍在发生。请向现场照护者核实。` }] });
    if (url.pathname === "/api/app/safety/acknowledge") { seen.push(route.request().postDataJSON()); return json({ acknowledged: true }); }
    if (url.pathname === "/api/app/records/snapshot") return json({ activities: [], events: [], questions: [], summary: emptyRecordSummary() });
    if (url.pathname === "/api/app/activities/latest") return json(null);
    if (url.pathname === "/api/app/chat") return json({ babyId: baby.id, conversationId: "safety-test-chat", turns: [], pending: [], pendingCount: 0 });
    return json([]);
  });
  await page.goto("/");
  await expect(page.locator(".safety-notices")).toContainText(sentAt);
  await expect(page.locator(".safety-notices")).toContainText(observedAt);
  await expect(page.locator(".safety-notices")).toContainText("这不代表当前仍在发生");
  await page.getByText("我已阅读，会向现场照护者核实", { exact: true }).click();
  expect(seen).toEqual([{ babyId: baby.id, signalId: "synthetic-notice" }]);
  await expect(page.locator(".safety-notices")).toHaveCount(0);
});

test("keeps baby selection available when the current baby needs guardian approval", async ({ page }) => {
  const babies = [{ id: "blocked-child", name: "待授权宝宝" }, { id: "allowed-child", name: "已授权宝宝" }];
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url()), json = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === "/api/app/auth/context") return json({ authenticated: true, identityId: "two-baby-parent", legacyLinked: true, hasBaby: true, baby: babies[0], babies });
    if (url.pathname === "/api/app/privacy/policy") return json(policy);
    if (url.pathname === "/api/app/privacy/status") return json({ policy, consentCurrent: true, guardianCurrent: false, canManage: false, consent: personal, guardian: null });
    return json({ data: [] });
  });
  await page.goto("/"); await expect(page.getByText("请联系拥有管理权限的监护人完成宝宝授权。", { exact: true })).toBeVisible();
  await page.getByLabel("打开菜单", { exact: true }).click();
  await expect(page.locator(".diary-baby-name")).toContainText("待授权宝宝");
  await page.locator(".diary-baby-name").click();
  await expect(page.getByText("已授权宝宝", { exact: true })).toBeVisible();
});
