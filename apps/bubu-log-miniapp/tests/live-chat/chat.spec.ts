import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.BUBU_CHAT_EVENT_FORMS === "1", "Run this scenario in the default chat fixture");

type SnapshotEvent = {
  facts?: { type?: string; startTime?: string; hasPoop?: unknown; hasPee?: unknown; poopColor?: unknown };
  states?: { hasPoop?: string };
};

// Real H5 -> authenticated HTTP -> Payload -> SDK MCP -> controlled provider.
// No intercepted requests, real account, real group, or external model is used.
async function send(page: Page, text: string) {
  await page.locator(".bubu-chat-text textarea").fill(text);
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/chat" && response.request().method() === "POST");
  await page.getByLabel("发送消息", { exact: true }).click();
  const response = await posted;
  expect(response.status()).toBe(200);
  const body = await response.json() as { turn: { requestId: string } };
  let finished: { turn: { status: string; [key: string]: unknown } } | undefined;
  await expect.poll(async () => {
    const result = await page.request.get(`/api/app/chat/request?babyId=baby-a&requestId=${body.turn.requestId}`);
    finished = await result.json() as { turn: { status: string; [key: string]: unknown } };
    return finished.turn.status === "processing" ? "processing" : "finished";
  }).toBe("finished");
  expect(finished?.turn.status, JSON.stringify(finished?.turn)).toBe("completed");
  await expect(page.locator(".bubu-chat-text textarea")).toBeEditable();
  await expect(page.locator(".bubu-chat-reply").last()).not.toContainText("正在理解");
  return page.locator(".bubu-chat-reply").last();
}

async function menu(page: Page, label: string) {
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-drawer taro-button-core").filter({ has: page.getByText(label, { exact: true }) }).click();
}

function pendingField(page: Page, label: string) {
  return page.locator(".bubu-chat-pending-form .bubu-chat-form-field").filter({ hasText: label }).first();
}

async function snapshotEvents(page: Page, babyId = "baby-a") {
  const response = await page.request.get(`/api/app/records/snapshot?babyId=${babyId}&date=2026-10-23`);
  expect(response.status()).toBe(200);
  return (await response.json() as { events: SnapshotEvent[] }).events;
}

async function openChat(page: Page) {
  await page.locator(".chat-entry").click();
  await expect(page.locator(".bubu-chat-page")).toBeVisible();
  await expect(page.locator(".bubu-chat-title")).toHaveText("开始记录");
}

async function openChatFromMenu(page: Page) {
  await page.getByLabel("打开菜单", { exact: true }).click();
  await expect(page.locator(".diary-drawer")).toBeVisible();
  await page.locator(".diary-drawer taro-button-core").filter({ has: page.getByText("开始记录", { exact: true }) }).click();
  await expect(page.locator(".bubu-chat-page")).toBeVisible();
}

async function backHome(page: Page) {
  await page.getByLabel("返回", { exact: true }).click();
  await expect(page.locator(".diary-navigation-row")).toBeVisible();
  await expect(page.locator(".bubu-chat-page")).toHaveCount(0);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth,
    ...[...document.body.querySelectorAll<HTMLElement>("*")].map(element => element.scrollWidth),
  ) - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function captureViewports(page: Page, route: "home" | "menu" | "chat", action?: () => Promise<void>) {
  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await expectNoHorizontalOverflow(page);
    if (route === "chat") {
      await expect(page.locator(".bubu-chat-scroll")).toBeVisible();
      await expect(page.locator(".bubu-chat-page > .bubu-chat-scroll")).toBeVisible();
      const composer = page.locator(".bubu-chat-composer");
      const box = await composer.boundingBox();
      expect(box?.height).toBeLessThan(120);
    }
    await page.screenshot({ path: `test-results/chat-live-${route}-${width}x${height}.png`, fullPage: true });
  }
  if (action) await action();
  await page.setViewportSize({ width: 390, height: 844 });
}

async function assertCompactRoute(page: Page) {
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".bubu-chat-scroll")).toBeVisible();
  await expect(page.locator(".bubu-chat-page > .bubu-chat-scroll")).toBeVisible();
  const composer = page.locator(".bubu-chat-composer");
  await expect(composer).toBeVisible();
  expect((await composer.boundingBox())?.height).toBeLessThan(120);
}

test("records a feeding conversation, confirms a captioned image, edits facts and keeps babies separate", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-23T20:00:00+08:00"));
  await page.goto("/");
  await page.locator('input[placeholder="请输入用户名或邮箱"]').fill("old-alice");
  await page.locator('input[placeholder="请输入密码"]').fill("correct-password");
  await page.locator(".privacy-choice input").check();
  await page.getByText("登录", { exact: true }).click();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  await expect(page.locator(".chat-entry-pending")).toHaveCount(0);
  await captureViewports(page, "home");
  await page.getByLabel("打开菜单", { exact: true }).click();
  await expect(page.locator(".diary-drawer")).toBeVisible();
  await captureViewports(page, "menu");
  await page.getByLabel("关闭菜单", { exact: true }).click();

  await openChat(page);
  await expect(page).toHaveURL(/\/pages\/chat\/index\?.*babyId=baby-a/);
  await expect(page.locator(".bubu-chat-title")).toHaveText("开始记录");
  await expect(page.locator(".bubu-chat-baby")).toHaveText("合成宝宝一");
  await expect(page.locator(".bubu-chat-step-count")).toHaveCount(0);
  await assertCompactRoute(page);
  await captureViewports(page, "chat");

  await page.locator(".bubu-chat-text textarea").fill("喝奶了");
  await backHome(page);
  await openChat(page);
  await expect(page).toHaveURL(/\/pages\/chat\/index\?.*date=2026-10-23/);
  await expect(page.locator(".bubu-chat-text textarea")).toHaveValue("喝奶了");

  await expect(await send(page, "喝奶了")).toContainText(/已保留|待核对/);
  await expect(page.locator(".bubu-chat-pending-form")).toContainText(/亲喂|瓶喂/);
  await expect(await send(page, "奶瓶，奶粉")).toContainText(/已保留|还需补充/);
  await expect(page.locator(".bubu-chat-pending-form")).toContainText(/冲泡|实际喝入|奶量/);
  await expect(await send(page, "泡了120，剩了20，是同一瓶")).toContainText(/100\s*ml|100\s*毫升/);
  await page.screenshot({ path: "test-results/chat-live-feeding.png", fullPage: true });

  const countBeforeRegeneration = (await snapshotEvents(page)).length;
  await expect(await send(page, "触发选择题校验")).toContainText("这项内容需要选择后才能继续");
  const regeneratedQuestion = page.locator(".bubu-chat-questions").last();
  await expect(regeneratedQuestion.getByText("这次是哪一种？", { exact: true })).toBeVisible();
  await expect(regeneratedQuestion.locator(".bubu-chat-choice")).toHaveCount(2);
  await expect(page.locator(".bubu-chat-scroll")).not.toContainText("请告诉我你选哪一个");
  expect((await snapshotEvents(page)).length).toBe(countBeforeRegeneration);

  // A chat route owns its reload; it does not have to pass through home first.
  await page.reload();
  await expect(page.locator(".bubu-chat-page")).toBeVisible();
  await expect(page.locator(".bubu-chat-user").filter({ hasText: "喝奶了" })).toHaveCount(1);
  await backHome(page);
  await expect(page.locator(".stat-card").filter({ has: page.getByText("瓶", { exact: true }) })).toContainText("100 ml");

  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "小便" }).first().click();
  await page.getByText("在对话中修改这条记录", { exact: true }).click();
  await expect(page.locator(".bubu-chat-target")).toBeVisible();
  await expect(page.locator(".bubu-chat-user").filter({ hasText: "喝奶了" })).toHaveCount(1);
  const unknownReply = await send(page, "不知道有没有大便");
  await expect(unknownReply).toContainText("已保留");
  await expect(unknownReply).toContainText("不确定的信息已记下，不再重复追问");
  await expect(unknownReply).not.toContainText("便便是什么颜色");
  await expect(page.locator(".bubu-chat-pending-form")).toHaveCount(0);
  const eventsAfterUnknown = await snapshotEvents(page);
  const seededDiaper = eventsAfterUnknown.find(event => event.facts?.type === "DIAPER" && event.facts?.startTime === "2026-10-23T00:00:00.000Z");
  expect(seededDiaper?.states?.hasPoop).toBe("unknown");

  await page.getByLabel("添加照片", { exact: true }).click();
  const file = page.waitForEvent("filechooser");
  await page.getByText("从相册选择", { exact: true }).click();
  await (await file).setFiles({ name: "synthetic-diaper.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIYQAAAAASUVORK5CYII=", "base64") });
  await expect(page.locator(".bubu-chat-attachment")).toHaveCount(1);
  await expect(await send(page, "刚换的尿布")).toContainText(/已保留|还需补充/);
  await expect(page.locator(".bubu-chat-pending-form")).not.toHaveCount(0);
  await expect(pendingField(page, "是否有便")).toBeVisible();
  await expect(pendingField(page, "是否有尿")).toBeVisible();
  await expect(pendingField(page, "便便颜色")).toHaveCount(0);
  await page.screenshot({ path: "test-results/chat-live-image-pending.png", fullPage: true });
  await expect(await send(page, "有黄色便便，没有尿")).toContainText(/已保存|已记录/);
  const eventsAfterImage = await snapshotEvents(page);
  const imageDiaper = eventsAfterImage.find(event => event.facts?.type === "DIAPER" && event.facts?.startTime === "2026-10-23T11:55:00.000Z");
  expect(imageDiaper?.facts).toMatchObject({ hasPoop: true, hasPee: false, poopColor: "YELLOW" });

  await backHome(page);
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: /100\s*ml/ }).click();
  await page.getByText("在对话中修改这条记录", { exact: true }).click();
  await expect(page.locator(".bubu-chat-target")).toBeVisible();
  await expect(page).toHaveURL(/\/pages\/chat\/index\?.*babyId=baby-a/);
  await expect(await send(page, "这条实际喝入80，剩40，是同一瓶")).toContainText(/80\s*ml|80\s*毫升/);
  await backHome(page);
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

  await openChatFromMenu(page);
  await expect(page).toHaveURL(/\/pages\/chat\/index\?.*babyId=baby-b/);
  await expect(page.locator(".bubu-chat-baby")).toHaveText("合成宝宝二");
  await expect(page.locator(".bubu-chat-turn")).toHaveCount(0);
  await expect(page.locator(".bubu-chat-automatic")).toHaveCount(0);
  await expect(page.locator(".bubu-chat-pending-form")).toHaveCount(0);
  await expect(page.locator(".bubu-chat-text textarea")).toHaveValue("");
  expect(await snapshotEvents(page, "baby-b")).toEqual([]);
  await page.screenshot({ path: "test-results/chat-live-baby-isolation.png", fullPage: true });
});
