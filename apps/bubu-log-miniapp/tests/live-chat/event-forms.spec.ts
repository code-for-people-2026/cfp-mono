import { expect, test, type Page, type Request, type Route } from "@playwright/test";

test.skip(process.env.BUBU_CHAT_EVENT_FORMS !== "1", "Run this scenario in the event-forms chat fixture");

type SnapshotEvent = {
  id?: string;
  facts?: {
    type?: string;
    milkAmount?: unknown;
    milkItems?: Array<{ id?: string; milkSource?: string; milkDescription?: string; milkAmount?: unknown }>;
    durationMinutes?: unknown;
    burpSuccess?: unknown;
    hasPee?: unknown;
    hasPoop?: unknown;
    peeAmount?: unknown;
    poopColor?: unknown;
    breastFirmness?: unknown;
  };
};

type SourceResponse = {
  babyId: string;
  eventId: string;
  messages: Array<{
    id: string;
    kind: string;
    senderId: string | null;
    senderName?: string;
    sentAt: string;
    text: string | null;
  }>;
  unavailableCount: number;
};

type TestLocator = ReturnType<Page["locator"]>;

async function login(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-23T20:00:00+08:00"));
  await page.goto("/");
  await page.locator('input[placeholder="请输入用户名或邮箱"]').fill("old-alice");
  await page.locator('input[placeholder="请输入密码"]').fill("correct-password");
  await page.locator(".privacy-choice input").check();
  await page.getByText("登录", { exact: true }).click();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
}

async function setSharedOptionValues(page: Page, option: string, values: readonly number[]) {
  await page.locator(".record-options-activity").filter({ hasText: option }).click();
  await expect(page.locator(".record-options-option-title")).toHaveText(option);
  const clear = page.locator(".record-options-clear");
  if (await clear.isEnabled()) await clear.click();
  const input = page.getByLabel(`添加${option}`, { exact: true }).locator("input");
  for (const value of values) {
    await input.fill(String(value));
    await page.locator(".record-options-add-button").click();
  }
  await expect(page.locator(".record-options-value")).toHaveCount(values.length);
  for (const [index, value] of values.entries()) {
    await expect(page.getByLabel(`${option}第${index + 1}项`, { exact: true }).locator("input")).toHaveValue(String(value));
  }
}

async function configureSharedOptions(page: Page) {
  await page.getByLabel("打开菜单", { exact: true }).click();
  await expect(page.locator(".diary-drawer")).toBeVisible();
  await page.locator(".diary-drawer taro-button-core").filter({ has: page.getByText("设置", { exact: true }) }).click();
  await expect(page.locator(".settings-page")).toBeVisible();
  await page.getByLabel("打开宝宝共用的记录常用选项", { exact: true }).click();
  await expect(page.locator(".record-options-page")).toBeVisible();

  await setSharedOptionValues(page, "瓶喂奶量", [70, 110]);
  await page.locator(".record-options-group").filter({ hasText: "时长" }).click();
  await setSharedOptionValues(page, "睡眠时长", [25, 50]);

  const save = page.locator(".record-options-primary");
  if (!await save.evaluate(element => element.hasAttribute("disabled"))) {
    const saved = page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/app/care-preferences" && response.request().method() === "PATCH"
    );
    await save.click();
    expect((await saved).status()).toBe(200);
    await expect(page.locator(".record-options-notice")).toHaveText("已保存，全家共用");
  }

  await page.locator(".record-options-back").click();
  await expect(page.locator(".settings-page")).toBeVisible();
  await page.locator(".settings-navigation .text-button").click();
  await expect(page.locator(".chat-entry")).toBeVisible();
  await page.reload();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-drawer taro-button-core").filter({ has: page.getByText("设置", { exact: true }) }).click();
  await expect(page.locator(".settings-page")).toBeVisible();
  await page.getByLabel("打开宝宝共用的记录常用选项", { exact: true }).click();
  await expect(page.locator(".record-options-page")).toBeVisible();
  await page.locator(".record-options-group").filter({ hasText: "时长" }).click();
  await page.locator(".record-options-activity").filter({ hasText: "睡眠时长" }).click();
  await expect(page.locator(".record-options-option-title")).toHaveText("睡眠时长");
  await expect(page.getByLabel("睡眠时长第1项", { exact: true }).locator("input")).toHaveValue("25");
  await expect(page.getByLabel("睡眠时长第2项", { exact: true }).locator("input")).toHaveValue("50");
  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await expectNoHorizontalOverflow(page);
    if (width === 360) {
      const activities = await page.locator(".record-options-activity").evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        return { top: Math.round(box.top), width: Math.round(box.width) };
      }));
      expect(activities[1]?.top).toBe(activities[0]?.top);
      expect(Math.max(...activities.map(item => item.width))).toBeLessThan(200);
      const deletes = await page.locator(".record-options-delete").evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().width)));
      expect(deletes).toEqual([44, 44]);
    }
    await page.screenshot({ path: `test-results/bubu-event-forms-settings-${width}x${height}.png` });
  }
  await page.locator(".record-options-group").filter({ hasText: "奶量" }).click();
  await page.locator(".record-options-activity").filter({ hasText: "瓶喂奶量" }).click();
  await expect(page.getByLabel("瓶喂奶量第1项", { exact: true }).locator("input")).toHaveValue("70");
  await expect(page.getByLabel("瓶喂奶量第2项", { exact: true }).locator("input")).toHaveValue("110");

  await page.locator(".record-options-back").click();
  await expect(page.locator(".settings-page")).toBeVisible();
  await page.locator(".settings-navigation .text-button").click();
  await expect(page.locator(".chat-entry")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
}

async function openChat(page: Page) {
  await page.locator(".chat-entry").click();
  await expect(page.locator(".bubu-chat-page")).toBeVisible();
  await expect(page.locator(".bubu-chat-title")).toHaveText("开始记录");
}

async function send(page: Page, text: string) {
  await page.locator(".bubu-chat-text textarea").fill(text);
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/chat" && response.request().method() === "POST");
  await page.getByLabel("发送消息", { exact: true }).click();
  const response = await posted;
  expect(response.status()).toBe(200);
  const body = await response.json() as { turn: { requestId: string } };
  let finished: { turn: { status: string } } | undefined;
  await expect.poll(async () => {
    const result = await page.request.get(`/api/app/chat/request?babyId=baby-a&requestId=${body.turn.requestId}`);
    finished = await result.json() as { turn: { status: string } };
    return finished.turn.status;
  }).toBe("completed");
  await expect(page.locator(".bubu-chat-text textarea")).toBeEditable();
  return page.locator(".bubu-chat-reply").last();
}

async function backHome(page: Page) {
  await page.getByLabel("返回", { exact: true }).click();
  await expect(page.locator(".chat-entry")).toBeVisible();
  await expect(page.locator(".bubu-chat-page")).toHaveCount(0);
}

function field(page: Page, label: string) {
  return page.locator(".bubu-chat-form-field").filter({ hasText: label }).first();
}

async function skipToNext(page: Page) {
  await page.getByLabel("下一个待补充事件", { exact: true }).click();
}

async function goToPrevious(page: Page) {
  await page.getByLabel("上一个待补充事件", { exact: true }).click();
}

async function expectTaroDisabled(locator: TestLocator) {
  expect(await locator.evaluate(element => element.hasAttribute("disabled"))).toBe(true);
}

async function pendingCount(page: Page) {
  const text = await page.locator(".bubu-chat-step-count").innerText();
  const match = /待补充\s*·\s*(\d+)\s*\/\s*(\d+)/.exec(text);
  if (!match) throw Error(`Invalid pending step count: ${text}`);
  return { index: Number(match[1]), total: Number(match[2]), text };
}

async function ensureForm(page: Page, titleText: string) {
  const title = page.locator(".bubu-chat-step-title").first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await expect(title).toBeVisible();
    if ((await title.innerText()).includes(titleText)) return pendingCount(page);
    await skipToNext(page);
  }
  throw new Error(`Expected the ${titleText} form to be reachable among pending events`);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const elements = [...document.body.querySelectorAll<HTMLElement>("*")];
    const protruding = elements.flatMap(element => {
      const box = element.getBoundingClientRect();
      return box.left < -1 || box.right > viewportWidth + 1
        ? [{ className: element.className, left: Math.round(box.left), right: Math.round(box.right) }]
        : [];
    });
    const nested = elements.flatMap(element => {
      const overflow = getComputedStyle(element).overflowX;
      return (overflow === "auto" || overflow === "scroll") && element.scrollWidth > element.clientWidth + 1
        ? [{ className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }]
        : [];
    });
    return {
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewportWidth,
      protruding: protruding.slice(0, 5),
      nested: nested.slice(0, 5),
    };
  })).toEqual({ overflow: 0, protruding: [], nested: [] });
}

async function assertCompactRoute(page: Page) {
  await expectNoHorizontalOverflow(page);
  await expect(page.locator(".bubu-chat-page > .bubu-chat-scroll")).toBeVisible();
  const composer = page.locator(".bubu-chat-composer");
  await expect(composer).toBeVisible();
  expect((await composer.boundingBox())?.height).toBeLessThan(120);
}

async function scrollWithinChatScroller(page: Page, locator: TestLocator) {
  await assertCompactRoute(page);
  await locator.evaluate(element => element.scrollIntoView({ block: "center" }));
  await expect.poll(async () => {
    const [target, scroller] = await Promise.all([locator.boundingBox(), page.locator(".bubu-chat-scroll").boundingBox()]);
    return !!target && !!scroller &&
      target.x >= scroller.x - 0.5 &&
      target.y >= scroller.y - 0.5 &&
      target.x + target.width <= scroller.x + scroller.width + 0.5 &&
      target.y + target.height <= scroller.y + scroller.height + 0.5;
  }, { message: "Expected the form control to be visible within the history scroller" }).toBe(true);
}

async function captureClosedFormScreenshots(page: Page, name: string) {
  const title = page.locator(".bubu-chat-step-title").first();

  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await scrollWithinChatScroller(page, title);
    await page.screenshot({ path: `test-results/bubu-event-forms-${name}-title-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function captureExpandedOriginalsScreenshots(page: Page, name: string) {
  const lastMessage = page.locator(".bubu-chat-original-message").last();
  await expect(lastMessage).toBeVisible();

  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await scrollWithinChatScroller(page, lastMessage);
    await page.screenshot({ path: `test-results/bubu-event-forms-${name}-source-avatars-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function captureFocusedCustomScreenshots(page: Page, input: TestLocator) {
  for (const [width, height] of [[390, 544], [360, 500]] as const) {
    await page.setViewportSize({ width, height });
    await input.focus();
    await scrollWithinChatScroller(page, input);
    const [inputBox, composerBox] = await Promise.all([input.boundingBox(), page.locator(".bubu-chat-composer").boundingBox()]);
    expect(inputBox?.y).toBeGreaterThanOrEqual(0);
    expect(inputBox ? inputBox.y + inputBox.height : height + 1).toBeLessThanOrEqual(height);
    expect(composerBox ? composerBox.y + composerBox.height : height + 1).toBeLessThanOrEqual(height);
    await page.screenshot({ path: `test-results/bubu-event-forms-custom-keyboard-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

function withSyntheticTimestamp(value: unknown): unknown {
  const addToPending = (items: unknown[]): unknown[] => {
    let added = false;
    return items.map(item => {
      if (added || !item || typeof item !== "object" || Array.isArray(item)) return item;
      const row = item as Record<string, unknown>;
      if (row.kind !== "fields" || !row.form || typeof row.form !== "object" || Array.isArray(row.form)) return item;
      const form = row.form as Record<string, unknown>;
      const controls = Array.isArray(form.controls) ? form.controls : [];
      if (controls.some(control => !!control && typeof control === "object" && !Array.isArray(control) && (control as Record<string, unknown>).field === "startTime")) return item;
      added = true;
      return {
        ...row,
        fields: [...(Array.isArray(row.fields) ? row.fields : []), "startTime"],
        form: {
          ...form,
          controls: [...controls, { field: "startTime", draftKey: "startTime", kind: "timestamp", label: "发生时间", referenceTime: "2026-10-23T08:00:00+08:00", allowUnknown: true }],
        },
      };
    });
  };
  if (Array.isArray(value)) return addToPending(value);
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  return Array.isArray(row.pending) ? { ...row, pending: addToPending(row.pending) } : value;
}

function withFiveSimpleForms(value: unknown): unknown {
  const pending = Array.from({ length: 5 }, (_, offset) => {
    const index = offset + 1;
    return {
      kind: "fields", id: `browser-question-${index}`, babyId: "baby-a", eventId: `browser-event-${index}`,
      version: 1, eventVersion: 1, fields: ["burpSuccess"], conflicts: [], duplicateCandidates: [], state: "open",
      form: {
        eventId: `browser-event-${index}`, eventVersion: 1, questionId: `browser-question-${index}`, questionVersion: 1,
        title: `待补事件 ${index}`, knownSummary: "", conflictMessages: [], duplicateCandidateIds: [],
        controls: [{ field: "burpSuccess", draftKey: "burpSuccess", kind: "boolean", label: "拍嗝结果", allowUnknown: true,
          options: [{ label: "是", value: "true" }, { label: "否", value: "false" }] }],
      },
    };
  });
  if (Array.isArray(value)) return pending;
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  return Array.isArray(row.pending) ? { ...row, pending, pendingCount: pending.length, replyQuestions: [] } : value;
}

test("keeps five event forms local and locks the page during the one final request", async ({ page }) => {
  await login(page);
  const replacePending = async (route: Route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: withFiveSimpleForms(await response.json()) });
  };
  await page.route("**/api/app/chat?**", replacePending);
  await page.route("**/api/app/records/pending?**", replacePending);
  await openChat(page);
  await expect(page.locator(".bubu-chat-step-count")).toHaveText("待补充 · 1 / 5");

  let postCount = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/app/chat" && request.method() === "POST") postCount += 1;
  });
  for (let index = 1; index <= 5; index += 1) {
    await page.locator(".bubu-chat-pending-form").getByText("是", { exact: true }).click();
    if (index < 5) {
      await page.locator("taro-button-core.bubu-chat-form-submit").filter({ hasText: "下一步" }).click();
      await expect(page.locator(".bubu-chat-step-count")).toHaveText(`待补充 · ${index + 1} / 5`);
      expect(postCount).toBe(0);
    }
  }

  let releasePost: () => void = () => {};
  const postGate = new Promise<void>(resolve => { releasePost = resolve; });
  await page.route("**/api/app/chat", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const request = route.request().postDataJSON() as {
      babyId: string; requestId: string; text: string; attachmentIds: string[]; context: { viewedDate: string };
      formBatch: Array<{ eventId: string; question: { eventVersion: number } }>;
    };
    await postGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ turn: {
        id: `turn-${request.requestId}`, requestId: request.requestId, babyId: request.babyId,
        createdAt: "2026-10-23T12:00:00.000Z", updatedAt: "2026-10-23T12:00:00.000Z", status: "completed",
        input: { text: request.text, attachmentIds: request.attachmentIds, context: request.context, formBatch: request.formBatch },
        assistantText: "5 项已保存", replyQuestions: [],
        receipts: [{ status: "saved", events: request.formBatch.map(item => ({ id: item.eventId, version: item.question.eventVersion + 1 })) }],
        pending: [], refreshRequired: false, batchProgress: { total: 5, completed: 5 },
      } }),
    });
  });

  const response = page.waitForResponse(item => new URL(item.url()).pathname === "/api/app/chat" && item.request().method() === "POST");
  const finalSubmit = page.locator("taro-button-core.bubu-chat-form-submit").filter({ hasText: "提交 5 项" });
  await finalSubmit.click();
  await expect.poll(() => postCount).toBe(1);
  await expect(page.locator(".bubu-chat-recovery.batch")).toContainText("正在保存 5 项");
  await expectTaroDisabled(page.getByLabel("返回", { exact: true }));
  await expectTaroDisabled(page.getByLabel("AI使用说明", { exact: true }));
  await expectTaroDisabled(page.getByLabel("添加照片", { exact: true }));
  await expectTaroDisabled(page.getByLabel("切换语音", { exact: true }));
  await expect(page.locator(".bubu-chat-text textarea")).toBeDisabled();
  await expectTaroDisabled(finalSubmit);
  const navigation = page.locator(".bubu-chat-step-nav-button");
  await expect(navigation).toHaveCount(2);
  expect(await navigation.evaluateAll(buttons => buttons.every(button => button.hasAttribute("disabled")))).toBe(true);
  await finalSubmit.evaluate(element => (element as HTMLElement).click());
  await page.waitForTimeout(100);
  expect(postCount).toBe(1);
  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/bubu-event-forms-five-saving-${width}x${height}.png` });
  }
  releasePost();
  expect((await response).status()).toBe(200);
  await expect(page.locator(".bubu-chat-step-count")).toHaveCount(0);
  expect(postCount).toBe(1);
});

test("renders custom timestamp pickers with native-safe spacing", async ({ page }) => {
  await login(page);
  const intercept = async (route: Route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: withSyntheticTimestamp(await response.json()) });
  };
  await page.route("**/api/app/chat?**", intercept);
  await page.route("**/api/app/records/pending?**", intercept);
  await openChat(page);
  const timestamp = field(page, "发生时间");
  await expect(timestamp).toBeVisible();
  await timestamp.getByText("自定义", { exact: true }).click();
  const pickers = timestamp.locator(".bubu-chat-time-row");
  await expect(pickers).toBeVisible();
  await expect(pickers.locator(".bubu-chat-time-picker")).toHaveCount(2);
  expect(await pickers.evaluate(element => {
    const style = getComputedStyle(element);
    return { gap: style.gap, marginTop: style.marginTop };
  })).toEqual({ gap: "10px", marginTop: "10px" });
  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await scrollWithinChatScroller(page, pickers);
    await page.screenshot({ path: `test-results/bubu-event-forms-custom-date-inline-${width}x${height}.png` });
  }
  await expectNoHorizontalOverflow(page);
});

test("keeps simulated fixture originals collapsed and renders both labelled messages on demand", async ({ page }) => {
  let sourceFetches = 0;
  await page.route("**/api/app/records/sources?**", async route => {
    sourceFetches += 1;
    const url = new URL(route.request().url());
    expect(url.searchParams.get("babyId")).toBe("baby-a");
    const eventId = url.searchParams.get("eventId");
    expect(eventId).toBeTruthy();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        babyId: "baby-a", eventId, unavailableCount: 0,
        messages: [
          { id: "acceptance-test:aunt", kind: "test", label: "测试记录 · 模拟消息", senderId: "acceptance-test:aunt", senderName: "阿姨（测试）", sentAt: "2026-11-14T00:00:00.000Z", text: "刚给宝宝喂完奶粉。" },
          { id: "acceptance-test:dad", kind: "test", label: "测试记录 · 模拟消息", senderId: "acceptance-test:dad", senderName: "爸爸（测试）", sentAt: "2026-11-14T00:01:00.000Z", text: "奶瓶已经洗好了。" },
        ],
      }),
    });
  });
  await login(page);
  await openChat(page);
  await ensureForm(page, "瓶喂");

  const original = page.locator(".bubu-chat-pending-form .bubu-chat-original").first();
  const toggle = original.locator(".bubu-chat-original-toggle");
  await expect(toggle).toHaveText("查看原消息");
  await expect(original.locator(".bubu-chat-original-body")).toHaveCount(0);
  expect(sourceFetches).toBe(0);

  await toggle.click();
  expect(sourceFetches).toBe(1);
  const messages = original.locator(".bubu-chat-original-message");
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(0).locator(".bubu-chat-original-meta")).toHaveText("测试记录 · 模拟消息 · 阿姨（测试） · 2026-11-14 08:00");
  await expect(messages.nth(1).locator(".bubu-chat-original-meta")).toHaveText("测试记录 · 模拟消息 · 爸爸（测试） · 2026-11-14 08:01");
  await expect(messages.nth(0).locator(".bubu-chat-original-text")).toHaveText("刚给宝宝喂完奶粉。");
  await expect(messages.nth(1).locator(".bubu-chat-original-text")).toHaveText("奶瓶已经洗好了。");
  await expect(messages.locator(".bubu-chat-original-avatar-fallback")).toHaveText(["阿", "爸"]);
  await expect(messages.locator(".bubu-chat-original-avatar")).toHaveCount(0);

  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await scrollWithinChatScroller(page, messages.last());
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/bubu-test-originals-${width}x${height}.png` });
  }
});

test("completes required event-form fields and expands only their exact original messages", async ({ page }) => {
  let sourceFetches = 0;
  const countSourceFetch = (request: Request) => {
    if (new URL(request.url()).pathname === "/api/app/records/sources" && request.method() === "GET") sourceFetches += 1;
  };
  page.on("request", countSourceFetch);
  await login(page);
  await configureSharedOptions(page);
  await openChat(page);

  const initialCount = await pendingCount(page);
  expect(initialCount).toMatchObject({ index: 1, total: 2 });
  await expect(page.locator(".bubu-chat-automatic")).toHaveCount(1);
  await expect(page.locator(".bubu-chat-automatic").first()).toContainText("已整理微信群记录");
  await expect(page.locator(".bubu-chat-automatic-event")).toHaveCount(3);
  await expect(page.locator(".bubu-chat-user")).toHaveCount(0);
  await expect(page.locator(".bubu-chat-pending-form")).toHaveCount(1);

  const initialSnapshotResponse = await page.request.get("/api/app/records/snapshot?babyId=baby-a");
  expect(initialSnapshotResponse.status()).toBe(200);
  const initialSnapshot = await initialSnapshotResponse.json() as { events: SnapshotEvent[] };
  expect(initialSnapshot.events).toHaveLength(3);
  const initialEventIds = initialSnapshot.events.map(event => event.id);

  const bottle = await ensureForm(page, "瓶喂");
  expect(bottle.total).toBe(2);
  await expect(page.getByText("补充说明", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "不知道", exact: true })).toHaveCount(0);
  const milk = field(page, "实际喝入奶量");
  await expect(milk.locator("input")).toHaveCount(0);
  await expect(milk.getByText("70 ml", { exact: true })).toBeVisible();
  await expect(milk.getByText("110 ml", { exact: true })).toBeVisible();
  await expect(field(page, "时长")).toHaveCount(0);
  await expect(field(page, "结束时间或时长")).toHaveCount(0);
  await expect(field(page, "拍嗝结果")).toHaveCount(0);
  await expect(field(page, "乳房触感")).toHaveCount(0);
  await expect(field(page, "便便颜色")).toHaveCount(0);
  await expect(field(page, "尿量")).toHaveCount(0);
  await expect(page.getByText("结束日期", { exact: true })).toHaveCount(0);
  await expect(page.getByText("结束时间", { exact: true })).toHaveCount(0);
  await captureClosedFormScreenshots(page, "bottle-default-choices");

  await page.getByText("补充说明", { exact: true }).click();
  const inlineText = page.getByLabel("补充说明自定义内容", { exact: true }).locator("textarea");
  await inlineText.fill("不知道");
  await expect(page.locator(".bubu-chat-composer .bubu-chat-text textarea")).toHaveValue("");
  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await scrollWithinChatScroller(page, inlineText);
    await page.screenshot({ path: `test-results/bubu-event-forms-text-inline-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await goToPrevious(page);
  await expect(page.locator(".bubu-chat-step-title")).toContainText("睡眠");
  await skipToNext(page);
  const restoredInlineText = page.getByLabel("补充说明自定义内容", { exact: true }).locator("textarea");
  await expect(restoredInlineText).toHaveValue("不知道");
  await restoredInlineText.fill("");
  await page.getByText("补充说明", { exact: true }).click();
  await expect(page.getByLabel("补充说明自定义内容", { exact: true })).toHaveCount(0);

  const pendingToggle = page.locator(".bubu-chat-pending-form .bubu-chat-original-toggle").first();
  await expect(pendingToggle).toHaveText("查看原消息");
  expect(sourceFetches).toBe(0);
  const sourceResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/app/records/sources" && response.request().method() === "GET"
  );
  await pendingToggle.click();
  const sourceResponse = await sourceResponsePromise;
  expect(sourceResponse.status()).toBe(200);
  const sourceUrl = new URL(sourceResponse.url());
  expect(sourceUrl.searchParams.get("babyId")).toBe("baby-a");
  expect(sourceUrl.searchParams.get("eventId")).toBeTruthy();
  const source = await sourceResponse.json() as SourceResponse;
  expect(source.babyId).toBe("baby-a");
  expect(source.eventId).toBe(sourceUrl.searchParams.get("eventId"));
  expect(source.unavailableCount).toBe(0);
  expect(source.messages.map(message => ({
    kind: message.kind,
    senderId: message.senderId,
    senderName: message.senderName,
    sentAt: message.sentAt,
    text: message.text,
  }))).toEqual([
    { kind: "wechat", senderId: "sender-xiaolin", senderName: "小林", sentAt: "2026-10-23T08:00:00+08:00", text: "八点喝了羊奶200毫升，又喝了奶粉" },
    { kind: "wechat", senderId: "sender-xiaozhou", senderName: "小周", sentAt: "2026-10-23T08:01:00+08:00", text: "奶粉实际喝入量晚点补" },
  ]);
  expect(source.messages.every(message => typeof message.id === "string" && message.id.length > 0)).toBe(true);

  const expandedBottleMessages = page.locator(".bubu-chat-pending-form .bubu-chat-original-message");
  await expect(expandedBottleMessages).toHaveCount(2);
  await expect(expandedBottleMessages.filter({ hasText: "小林" })).toContainText("八点喝了羊奶200毫升，又喝了奶粉");
  await expect(expandedBottleMessages.filter({ hasText: "小周" })).toContainText("奶粉实际喝入量晚点补");
  await expect(page.getByText("今天天气不错，和照护记录无关")).toHaveCount(0);
  await captureExpandedOriginalsScreenshots(page, "bottle");
  await pendingToggle.click();
  await expect(expandedBottleMessages).toHaveCount(0);

  await milk.getByText("110 ml", { exact: true }).click();
  await expect(milk.locator("input")).toHaveCount(0);
  await milk.getByLabel(/实际喝入奶量自定义$/).click();
  await expect(milk.locator("input")).toBeVisible();
  await milk.locator("input").fill("0");
  await captureFocusedCustomScreenshots(page, milk.locator("input"));
  await backHome(page);
  await openChat(page);
  const bottleAfterReopen = await ensureForm(page, "瓶喂");
  expect(bottleAfterReopen.index).toBe(bottle.index);
  await expect(milk.locator("input")).toHaveValue("0");

  await page.reload();
  await expect(page.locator(".bubu-chat-page")).toBeVisible();
  await expect(page.locator(".bubu-chat-title")).toHaveText("开始记录");
  const bottleAfterReload = await ensureForm(page, "瓶喂");
  expect(bottleAfterReload.index).toBe(bottle.index);
  await expect(milk.locator("input")).toHaveValue("0");

  let skippedFormPosts = 0;
  const countFormPost = (request: Request) => {
    if (new URL(request.url()).pathname === "/api/app/chat" && request.method() === "POST") skippedFormPosts += 1;
  };
  page.on("request", countFormPost);
  const sleepDuration = field(page, "时长");
  try {
    await goToPrevious(page);
    await expect(page.locator(".bubu-chat-step-title")).toContainText("睡眠");
    await expect(await pendingCount(page)).toMatchObject({ index: bottleAfterReload.index - 1, total: bottleAfterReload.total });
    await expect(sleepDuration.locator("input")).toHaveCount(0);
    await expect(sleepDuration.getByText("25 分钟", { exact: true })).toBeVisible();
    await expect(sleepDuration.getByText("50 分钟", { exact: true })).toBeVisible();
    await expect(field(page, "拍嗝结果")).toHaveCount(0);
    await sleepDuration.getByText("50 分钟", { exact: true }).click();
    await page.locator("taro-button-core.bubu-chat-form-submit").filter({ hasText: "下一步" }).click();
    await expect(page.locator(".bubu-chat-step-title")).toContainText("瓶喂");
    await expect(await pendingCount(page)).toMatchObject({ index: bottleAfterReload.index, total: bottleAfterReload.total });
    await expect(milk.locator("input")).toHaveValue("0");
  } finally {
    page.off("request", countFormPost);
  }
  expect(skippedFormPosts).toBe(0);
  let releasePost: () => void = () => {};
  const postGate = new Promise<void>(resolve => { releasePost = resolve; });
  let batchPosts = 0;
  await page.route("**/api/app/chat", async route => {
    if (route.request().method() !== "POST") return route.continue();
    batchPosts += 1;
    await postGate;
    await route.continue();
  });
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/chat" && response.request().method() === "POST");
  const finalSubmit = page.locator("taro-button-core.bubu-chat-form-submit").filter({ hasText: "提交 2 项" });
  await finalSubmit.click();
  await expect(page.locator(".bubu-chat-recovery.batch")).toContainText("正在保存 2 项");
  expect(batchPosts).toBe(1);
  await expectTaroDisabled(page.getByLabel("返回", { exact: true }));
  await expectTaroDisabled(page.getByLabel("AI使用说明", { exact: true }));
  await expectTaroDisabled(page.getByLabel("添加照片", { exact: true }));
  await expectTaroDisabled(page.getByLabel("切换语音", { exact: true }));
  await expect(page.locator(".bubu-chat-text textarea")).toBeDisabled();
  await expectTaroDisabled(finalSubmit);
  const navigation = page.locator(".bubu-chat-step-nav-button");
  await expect(navigation).toHaveCount(2);
  expect(await navigation.evaluateAll(buttons => buttons.every(button => button.hasAttribute("disabled")))).toBe(true);
  await finalSubmit.evaluate(element => (element as HTMLElement).click());
  await page.waitForTimeout(100);
  expect(batchPosts).toBe(1);
  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/bubu-event-forms-batch-saving-${width}x${height}.png` });
  }
  releasePost();
  const response = await posted;
  expect(response.status()).toBe(200);
  const body = await response.json() as { turn: { requestId: string } };
  await expect.poll(async () => {
    const result = await page.request.get(`/api/app/chat/request?babyId=baby-a&requestId=${body.turn.requestId}`);
    return (await result.json() as { turn: { status: string } }).turn.status;
  }).toBe("completed");
  await page.unroute("**/api/app/chat");
  expect(batchPosts).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".bubu-chat-step-count")).toHaveCount(0);
  await expect(page.locator(".bubu-chat-pending-form")).toHaveCount(0);
  await expect(page.locator(".bubu-chat-form-field")).toHaveCount(0);

  const finalSnapshotResponse = await page.request.get("/api/app/records/snapshot?babyId=baby-a");
  expect(finalSnapshotResponse.status()).toBe(200);
  const finalSnapshot = await finalSnapshotResponse.json() as { events: SnapshotEvent[] };
  expect(finalSnapshot.events).toHaveLength(3);
  const byInitialRecordOrder = (a: string | undefined, b: string | undefined) =>
    initialEventIds.indexOf(a) - initialEventIds.indexOf(b);
  expect(finalSnapshot.events.map(event => event.id).sort(byInitialRecordOrder)).toEqual(initialEventIds);
  const finalBottle = finalSnapshot.events.find(event => event.facts?.type === "BOTTLE");
  const finalSleep = finalSnapshot.events.find(event => event.facts?.type === "SLEEP");
  const finalDiaper = finalSnapshot.events.find(event => event.facts?.type === "DIAPER");
  expect(finalBottle?.facts).toMatchObject({ milkAmount: 200, burpSuccess: false, milkItems: [
    { id: "browser-goat-milk", milkDescription: "羊奶", milkAmount: 200 },
    { id: "browser-formula", milkSource: "FORMULA", milkAmount: 0 },
  ] });
  expect(finalBottle?.facts ? "durationMinutes" in finalBottle.facts : false).toBe(false);
  expect(finalBottle?.facts ? "breastFirmness" in finalBottle.facts : false).toBe(false);
  expect(finalSleep?.facts).toMatchObject({ durationMinutes: 50 });
  expect(finalDiaper?.facts).toMatchObject({ hasPee: true, hasPoop: true, peeAmount: "LARGE" });
  expect(finalDiaper?.facts ? "poopColor" in finalDiaper.facts : false).toBe(false);

  await page.reload();
  await expect(page.locator(".bubu-chat-page")).toBeVisible();
  await expect(page.locator(".bubu-chat-automatic").first()).toContainText("已整理微信群记录");
  await expect(page.locator(".bubu-chat-automatic")).toHaveCount(1);
  await expect(page.locator(".bubu-chat-automatic-event")).toHaveCount(3);
  await expect(page.locator(".bubu-chat-step-count")).toHaveCount(0);
  await expect(page.locator(".bubu-chat-form-field")).toHaveCount(0);
  await expect(page.locator(".bubu-chat-pending-form")).toHaveCount(0);

  const diaperHistoryRow = page.locator(".bubu-chat-automatic-event-row").filter({ hasText: "换尿布" });
  await expect(diaperHistoryRow).toHaveCount(1);
  const diaperHistoryToggle = diaperHistoryRow.locator(".bubu-chat-original-toggle");
  const diaperSourceResponsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/app/records/sources" && response.request().method() === "GET"
  );
  await scrollWithinChatScroller(page, diaperHistoryToggle);
  await diaperHistoryToggle.click();
  const diaperSourceResponse = await diaperSourceResponsePromise;
  expect(diaperSourceResponse.status()).toBe(200);
  const diaperHistoryMessages = diaperHistoryRow.locator(".bubu-chat-original-message");
  await expect(diaperHistoryMessages).toHaveCount(1);
  await expect(diaperHistoryMessages.filter({ hasText: "小陈" })).toContainText("十点换尿布，有尿也有便");
  await diaperHistoryToggle.click();
  await expect(diaperHistoryMessages).toHaveCount(0);
  expect(sourceFetches).toBe(2);

  await backHome(page);
  page.off("request", countSourceFetch);
});

test("shows one complete two-item bottle receipt without creating another pending form", async ({ page }) => {
  await login(page);
  const beforeResponse = await page.request.get("/api/app/records/snapshot?babyId=baby-a&date=2026-10-23");
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json() as { events: SnapshotEvent[] };
  await openChat(page);
  const pendingBefore = await page.locator(".bubu-chat-pending-form").count();

  const reply = await send(page, "晚上喝奶 200 羊奶，150 奶粉");
  await expect(reply).toContainText("羊奶 200 毫升");
  await expect(reply).toContainText("奶粉 150 毫升");
  await expect(reply).toContainText("合计 350 毫升");
  await expect(page.locator(".bubu-chat-pending-form")).toHaveCount(pendingBefore);

  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await scrollWithinChatScroller(page, reply);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/bubu-event-forms-complete-two-item-receipt-${width}x${height}.png` });
  }

  const afterResponse = await page.request.get("/api/app/records/snapshot?babyId=baby-a&date=2026-10-23");
  expect(afterResponse.status()).toBe(200);
  const after = await afterResponse.json() as { events: SnapshotEvent[] };
  expect(after.events).toHaveLength(before.events.length + 1);
  const meal = after.events.find(event => event.facts?.milkItems?.some(item => item.id === "fixture-goat-milk"));
  expect(meal?.facts).toMatchObject({
    type: "BOTTLE",
    milkAmount: 350,
    milkItems: [
      { id: "fixture-goat-milk", milkDescription: "羊奶", milkAmount: 200 },
      { id: "fixture-formula", milkSource: "FORMULA", milkAmount: 150 },
    ],
  });
});

test("submits one common amount choice for only the missing detail of a two-item meal", async ({ page }) => {
  await login(page);
  await configureSharedOptions(page);
  const beforeResponse = await page.request.get("/api/app/records/snapshot?babyId=baby-a&date=2026-10-23");
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json() as { events: SnapshotEvent[] };
  await openChat(page);

  const reply = await send(page, "18点这餐羊奶200，奶粉奶量待补");
  await expect(reply).toContainText("羊奶 200 毫升");
  await expect(reply).toContainText("已知小计 200 毫升（非整餐总量）");
  await expect(page.locator(".bubu-chat-pending-form")).toHaveCount(1);
  const formulaAmount = field(page, "奶粉实际喝入奶量");
  await expect(formulaAmount.getByText("70 ml", { exact: true })).toBeVisible();
  await expect(formulaAmount.getByText("110 ml", { exact: true })).toBeVisible();
  await expect(formulaAmount.getByText("自定义", { exact: true })).toBeVisible();
  await formulaAmount.getByText("110 ml", { exact: true }).click();

  for (const [width, height] of [[390, 844], [360, 800]] as const) {
    await page.setViewportSize({ width, height });
    await scrollWithinChatScroller(page, formulaAmount);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: `test-results/bubu-event-forms-two-item-common-choice-${width}x${height}.png` });
  }

  const posted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app/chat" && response.request().method() === "POST");
  await page.locator("taro-button-core.bubu-chat-form-submit").filter({ hasText: "提交 1 项" }).click();
  const response = await posted;
  expect(response.status()).toBe(200);
  const body = await response.json() as { turn: { requestId: string } };
  await expect.poll(async () => {
    const result = await page.request.get(`/api/app/chat/request?babyId=baby-a&requestId=${body.turn.requestId}`);
    return (await result.json() as { turn: { status: string } }).turn.status;
  }).toBe("completed");
  await expect(page.locator(".bubu-chat-pending-form")).toHaveCount(0);

  const afterResponse = await page.request.get("/api/app/records/snapshot?babyId=baby-a&date=2026-10-23");
  expect(afterResponse.status()).toBe(200);
  const after = await afterResponse.json() as { events: SnapshotEvent[] };
  expect(after.events).toHaveLength(before.events.length + 1);
  const meal = after.events.find(event => event.facts?.milkItems?.some(item => item.id === "fixture-partial-goat"));
  expect(meal?.facts).toMatchObject({ milkAmount: 310, milkItems: [
    { id: "fixture-partial-goat", milkDescription: "羊奶", milkAmount: 200 },
    { id: "fixture-partial-formula", milkSource: "FORMULA", milkAmount: 110 },
  ] });
  const revisions = await page.request.get(`/api/app/records/revisions?babyId=baby-a&eventId=${meal?.id}`);
  expect(revisions.status()).toBe(200);
  expect(await revisions.json() as unknown[]).toHaveLength(2);
});
