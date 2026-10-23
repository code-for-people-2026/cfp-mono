import { expect, test, type Page } from "@playwright/test";

// Real H5 -> authenticated HTTP -> Payload -> SDK MCP -> controlled provider.
// No intercepted requests, real account, real group, or external model is used.
async function send(page: Page, text: string) {
  await page.locator(".bubu-chat-text textarea").fill(text);
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/chat" && response.request().method() === "POST");
  await page.getByLabel("发送消息", { exact: true }).click();
  const response = await posted;
  expect(response.status()).toBe(200);
  const body = await response.json() as { turn: { requestId: string } };
  await expect.poll(async () => {
    const result = await page.request.get(`/api/app/chat/request?babyId=baby-a&requestId=${body.turn.requestId}`);
    return (await result.json() as { turn: { status: string } }).turn.status;
  }).toBe("completed");
  await expect(page.locator(".bubu-chat-text textarea")).toBeEditable();
  await expect(page.locator(".bubu-chat-reply").last()).not.toContainText("正在理解");
  return page.locator(".bubu-chat-reply").last();
}
async function menu(page: Page, label: string) {
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-drawer taro-button-core").filter({ has: page.getByText(label, { exact: true }) }).click();
}

test("records a feeding conversation, confirms a captioned image, edits facts and keeps babies separate", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-23T20:00:00+08:00"));
  await page.goto("/");
  await page.locator('input[placeholder="请输入用户名或邮箱"]').fill("old-alice");
  await page.locator('input[placeholder="请输入密码"]').fill("correct-password");
  await page.getByText("登录", { exact: true }).click();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  await expect(page.locator(".bubu-chat-badge")).toHaveText("1");
  await page.locator(".bubu-chat-launcher").click();
  await expect(page.locator(".bubu-chat-question")).toContainText("尿");
  await page.locator(".bubu-chat-text textarea").fill("喝奶了");
  await page.getByLabel("收起对话", { exact: true }).click();
  await page.locator(".bubu-chat-launcher").click();
  await expect(page.locator(".bubu-chat-text textarea")).toHaveValue("喝奶了");
  await expect(await send(page, "喝奶了")).toContainText(/亲喂|奶瓶/);
  await expect(await send(page, "奶瓶，奶粉")).toContainText(/泡|冲|实际喝|喝了/);
  await expect(await send(page, "泡了120，剩了20，是同一瓶")).toContainText(/100\s*ml|100\s*毫升/);
  await expect(await send(page, "喂了10分钟，拍出嗝了")).toContainText(/已保存|已记录/);
  await page.screenshot({ path: "test-results/chat-live-feeding.png", fullPage: true });
  await page.getByLabel("收起对话", { exact: true }).click();
  await expect(page.locator(".stat-card").filter({ has: page.getByText("瓶", { exact: true }) })).toContainText("100 ml");
  await page.reload();
  await page.locator(".bubu-chat-launcher").click();
  await expect(page.locator(".bubu-chat-user").filter({ hasText: "喝奶了" })).toHaveCount(1);
  await page.locator(".bubu-chat-question").filter({ hasText: "尿" }).click();
  await expect(await send(page, "不知道尿量")).toContainText(/已保存|已记录/);
  await expect(page.locator(".bubu-chat-question")).toHaveCount(0);

  await page.getByLabel("添加照片", { exact: true }).click();
  const file = page.waitForEvent("filechooser");
  await page.getByText("从相册选择", { exact: true }).click();
  await (await file).setFiles({ name: "synthetic-diaper.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIYQAAAAASUVORK5CYII=", "base64") });
  await expect(page.locator(".bubu-chat-attachment")).toHaveCount(1);
  await expect(await send(page, "刚换的尿布")).toContainText(/确认|有尿|便便/);
  await expect(page.locator(".bubu-chat-question")).not.toHaveCount(0);
  await page.screenshot({ path: "test-results/chat-live-image-pending.png", fullPage: true });
  await expect(await send(page, "有黄色便便，没有尿")).toContainText(/已保存|已记录/);
  await page.getByLabel("收起对话", { exact: true }).click();
  await menu(page, "历史数据");
  await page.locator(".record-row").filter({ hasText: /100\s*ml/ }).click();
  await page.getByText("在对话中修改这条记录", { exact: true }).click();
  await expect(page.locator(".bubu-chat-target")).toBeVisible();
  await expect(await send(page, "这条实际喝入80，剩40，是同一瓶")).toContainText(/80\s*ml|80\s*毫升/);
  await page.getByLabel("收起对话", { exact: true }).click();
  await expect(page.locator(".record-row").filter({ hasText: /80\s*ml/ })).toHaveCount(1);
  await page.screenshot({ path: "test-results/chat-live-corrected-record.png", fullPage: true });
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-baby-name").click();
  // Taro's wheel intentionally handles taps on its mask, above the visible labels.
  const picker = page.locator(".weui-picker").filter({ hasText: "合成宝宝二" });
  const mask = picker.locator(".weui-picker__mask");
  await expect(mask).toBeVisible();
  const box = await mask.boundingBox();
  if (!box) throw new Error("Missing baby picker geometry");
  await mask.tap({ position: { x: box.width / 2, y: box.height / 2 + 34 } });
  await picker.getByText("确定", { exact: true }).click();
  await page.locator(".bubu-chat-launcher").click();
  await expect(page.locator(".bubu-chat-heading")).toContainText("合成宝宝二");
  await expect(page.locator(".bubu-chat-turn")).toHaveCount(0);
  await expect(page.locator(".bubu-chat-question")).toHaveCount(0);
  await expect(page.locator(".bubu-chat-text textarea")).toHaveValue("");
  await page.screenshot({ path: "test-results/chat-live-baby-isolation.png", fullPage: true });
});
