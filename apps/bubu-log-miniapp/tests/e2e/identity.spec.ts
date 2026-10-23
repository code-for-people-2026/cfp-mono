import { expect, test, type Page } from "@playwright/test";
import { emptyRecordSummary } from "../fixtures/records";

// Run against a BUBU_AUTH_MODE=sidecar H5 build. All accounts and records are synthetic.
test.skip(process.env.BUBU_AUTH_MODE !== "sidecar", "Build with BUBU_AUTH_MODE=sidecar to test identity UI");
const baby = { id: "identity-test-baby", name: "小满" };
const unbound = { authenticated: true, identityId: "identity-test-user", legacyLinked: false, hasBaby: false, baby: null, babies: [], defaultBabyId: null };
const family = { ...unbound, hasBaby: true, baby, babies: [baby], defaultBabyId: baby.id };
async function fixture(page: Page, signedIn = false, legacyLinked = false) {
  let loggedIn = signedIn;
  let hasBaby = false;
  let linked = legacyLinked;
  let revoked = false;
  const requests: Array<{ path: string; body: unknown }> = [];
  const current = () => ({ ...(hasBaby && !revoked ? family : unbound), legacyLinked: linked });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body: unknown = request.method() === "POST" ? request.postDataJSON() : undefined;
    requests.push({ path: url.pathname, body });
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (url.pathname === "/api/identity/legacy-login") { loggedIn = true; linked = true; hasBaby = true; return json({ token: "must-not-persist", expiresAt: "2030-01-01T00:00:00Z", context: current() }); }
    if (url.pathname === "/api/identity/logout") { loggedIn = false; return json({}); }
    if (!loggedIn) return json({ error: "请登录", code: "UNAUTHORIZED" }, 401);
    if (url.pathname === "/api/app/auth/context") return json(current());
    if (url.pathname === "/api/identity/family") { hasBaby = true; return json({ context: current() }); }
    if (url.pathname === "/api/identity/invitations/accept") { hasBaby = true; return json({ context: current() }); }
    if (url.pathname === "/api/identity/bind-legacy") {
      if ((body as { password?: string }).password !== "valid-old-password") return json({ code: "LEGACY_CREDENTIALS_INVALID", error: "原账号凭证错误" }, 401);
      linked = true; hasBaby = true;
      return json({ token: "rotated-must-not-persist", expiresAt: "2030-01-01T00:00:00Z", context: current() });
    }
    expect(url.searchParams.get("babyId")).toBe(baby.id);
    if (revoked) return json({ code: "BABY_FORBIDDEN", error: "照护权限已撤销" }, 403);
    if (url.pathname === "/api/app/activities/latest") return json(null);
    if (url.pathname === "/api/app/records/snapshot") return json({ activities: [], events: [], questions: [], summary: emptyRecordSummary() });
    if (url.pathname === "/api/app/records/sync") return json([]);
    if (url.pathname === "/api/app/activities" || url.pathname === "/api/app/daily-stats") return json([]);
    return json({ error: "Unexpected endpoint" }, 404);
  });
  return { requests, revoke: () => { revoked = true; } };
}
async function menu(page: Page, label: string) {
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-drawer").locator("taro-button-core").filter({ has: page.getByText(label, { exact: true }) }).click();
}

test("H5 legacy exchange restores an existing baby and signs out without storing tokens", async ({ page }) => {
  const { requests } = await fixture(page);
  await page.goto("/");
  await page.locator('input[placeholder="请输入用户名或邮箱"]').fill("parent");
  await page.locator('input[placeholder="请输入密码"]').fill("old-password");
  await page.getByText("登录", { exact: true }).click();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  expect(requests.some((request) => request.path === "/api/identity/family")).toBe(false);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("must-not-persist");
  await page.reload();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  await menu(page, "退出登录");
  await expect(page.locator('input[placeholder="请输入密码"]')).toBeVisible();
  await expect(page.locator(".bubu-day-card")).toHaveCount(0);
});

test("an already authenticated unbound identity can create its first baby from only a nickname", async ({ page }) => {
  const { requests } = await fixture(page, true);
  await page.goto("/");
  await expect(page.getByText("开始记录宝宝的日常", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/identity-first-baby.png", fullPage: true });
  await page.locator('input[placeholder="怎么称呼宝宝"]').fill("小满");
  await page.locator(".identity-setup .primary-button").click();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  expect(requests.find((request) => request.path === "/api/identity/family")?.body).toEqual({ name: "小满" });
});

test("a linked old account with no baby gets association guidance and invitation access", async ({ page }) => {
  await fixture(page, true, true);
  await page.goto("/");
  await expect(page.getByText("原账号尚未关联宝宝", { exact: true })).toBeVisible();
  await expect(page.getByText("创建宝宝", { exact: true })).toHaveCount(0);
  await expect(page.getByText("绑定已有账号", { exact: true })).toHaveCount(0);
  await expect(page.locator('input[placeholder="粘贴家人提供的邀请码"]')).toBeVisible();
});

test("an invited caregiver sees a calendar without binding, and revocation clears that baby's view", async ({ page }) => {
  const setup = await fixture(page, true);
  await page.goto("/");
  await page.getByText("使用邀请码", { exact: true }).click();
  await page.locator('input[placeholder="粘贴家人提供的邀请码"]').fill("caregiver-invite");
  await page.getByText("加入照护", { exact: true }).click();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  expect(setup.requests.find((request) => request.path === "/api/identity/invitations/accept")?.body).toEqual({ code: "caregiver-invite" });
  expect(setup.requests.some((request) => request.path === "/api/identity/bind-legacy")).toBe(false);
  setup.revoke();
  await menu(page, "刷新数据");
  await expect(page.locator(".bubu-day-card")).toHaveCount(0);
  await expect(page.getByText("开始记录宝宝的日常", { exact: true })).toBeVisible();
  await expect(page.locator('input[placeholder="请输入密码"]')).toHaveCount(0);
});

test("wrong legacy credentials keep the identity and successful binding opens existing records", async ({ page }) => {
  await fixture(page, true);
  await page.goto("/");
  await page.getByText("绑定已有账号", { exact: true }).click();
  await page.locator('input[placeholder="原宝宝日记账号"]').fill("parent");
  await page.locator('input[placeholder="请输入原账号密码"]').fill("wrong-password");
  await page.getByText("验证并绑定", { exact: true }).click();
  await expect(page.getByText("原账号凭证错误", { exact: true })).toBeVisible();
  await expect(page.locator('input[placeholder="请输入原账号密码"]')).toHaveValue("");
  await page.locator('input[placeholder="请输入原账号密码"]').fill("valid-old-password");
  await page.getByText("验证并绑定", { exact: true }).click();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  await menu(page, "设置");
  await expect(page.getByText("已关联原宝宝日记账号", { exact: true })).toBeVisible();
  await expect.poll(async () => (await page.locator(".settings-page").boundingBox())?.x).toBe(0);
  await page.screenshot({ path: "test-results/identity-settings.png", fullPage: true });
});
