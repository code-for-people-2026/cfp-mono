import { expect, test } from "@playwright/test";
import { policy } from "../fixtures/privacy";

test("reports an unavailable policy, retries it, and requires a fresh choice before login", async ({ page }) => {
  let available = false, exchanges = 0;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/app/privacy/policy") return available
      ? route.fulfill({ json: policy })
      : route.fulfill({ status: 502, contentType: "text/html", body: "<h1>502 Bad Gateway</h1>" });
    if (path === "/api/identity/legacy-login") { exchanges++; return route.fulfill({ status: 401, json: { error: "合成账号回执", code: "LEGACY_CREDENTIALS_INVALID" } }); }
    return route.fulfill({ status: 401, json: { error: "请登录", code: "UNAUTHORIZED" } });
  });
  await page.goto("/");
  await expect(page.getByText("隐私说明暂时无法加载，请检查网络后重试。", { exact: true })).toBeVisible();
  await expect(page.locator(".privacy-choice input")).not.toBeChecked();
  await expect(page.locator(".privacy-choice input")).toBeDisabled();
  await expect(page.locator(".login-card .primary-button")).toHaveAttribute("disabled", "");
  await expect(page.locator(".brand-mark img")).toBeVisible();
  await page.screenshot({ path: "test-results/login-policy-unavailable.png", fullPage: true });
  available = true;
  await page.getByText("重试读取说明", { exact: true }).click();
  await expect(page.getByText("阅读隐私、儿童信息及服务说明", { exact: true })).toBeVisible();
  await expect(page.locator(".privacy-choice input")).not.toBeChecked();
  await page.screenshot({ path: "test-results/login-policy-recovered.png", fullPage: true });
  await page.locator('input[placeholder="请输入用户名或邮箱"]').fill("synthetic-parent");
  await page.locator('input[placeholder="请输入密码"]').fill("synthetic-password");
  await page.locator(".privacy-choice input").check();
  await page.getByText("登录", { exact: true }).click();
  await expect.poll(() => exchanges).toBe(1);
  await expect(page.getByText("请先阅读说明并主动同意本次登录。", { exact: true })).toHaveCount(0);
});

test("reconnect refreshes policy as well as identity without preserving a stale choice", async ({ page }) => {
  let ready = false, policyReads = 0;
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/app/privacy/policy") { policyReads++; return route.fulfill({ json: { ...policy, ready } }); }
    return route.fulfill({ status: 401, json: { error: "请登录", code: "UNAUTHORIZED" } });
  });
  await page.goto("/");
  await expect(page.getByText("服务暂未就绪，请稍后重试。", { exact: true })).toBeVisible();
  await expect(page.locator(".privacy-choice input")).toBeDisabled();
  ready = true;
  await page.getByText("重新连接", { exact: true }).click();
  await expect.poll(() => policyReads).toBe(2);
  await expect(page.locator(".privacy-choice input")).toBeEnabled();
  await expect(page.locator(".privacy-choice input")).not.toBeChecked();
});
