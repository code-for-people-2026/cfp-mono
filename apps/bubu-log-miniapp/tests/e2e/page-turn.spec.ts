import { expect, test, type CDPSession, type Page } from "@playwright/test";

const baby = { id: "page-turn-baby", name: "小满", fullName: null, avatarUrl: null, isDefault: true };
const context = { authenticated: true, hasBaby: true, baby, babies: [baby], defaultBabyId: baby.id };
const records = Array.from({ length: 5 }, (_, dayIndex) => {
  const date = `2026-10-${20 + dayIndex}`;
  const previousDate = `2026-10-${19 + dayIndex}`;
  return [
    { id: `${date}-sleep`, babyId: baby.id, type: "SLEEP", startTime: `${previousDate}T20:00:00+08:00`, endTime: `${date}T07:00:00+08:00` },
    { id: `${date}-milk`, babyId: baby.id, type: "BOTTLE", startTime: `${date}T08:30:00+08:00`, endTime: `${date}T08:50:00+08:00`, milkAmount: 100 + dayIndex * 10, milkSource: "FORMULA" },
    { id: `${date}-outdoor`, babyId: baby.id, type: "OUTDOOR", startTime: `${date}T10:00:00+08:00`, endTime: `${date}T17:30:00+08:00` },
  ];
}).flat();
const daily = Array.from({ length: 5 }, (_, index) => ({
  id: `page-turn-stat-${index}`, babyId: baby.id, date: `2026-10-${20 + index}`,
  sleepCount: 1, totalSleepMinutes: 660, totalMilkAmount: 120, totalPumpMilkAmount: 0, diaperCount: 1,
}));

async function syntheticApp(page: Page) {
  await page.clock.setSystemTime(new Date("2026-10-24T12:00:00+08:00"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname === "/api/auth/csrf") return json({ csrfToken: "page-turn-csrf" });
    if (url.pathname === "/api/app/auth/context") return json(context);
    if (url.pathname === "/api/app/baby-profile") return json({ ...baby, birthDate: "2026-06-23" });
    if (url.pathname === "/api/app/activities") {
      const date = url.searchParams.get("date");
      const startTimeGte = url.searchParams.get("startTimeGte");
      const startTimeLt = url.searchParams.get("startTimeLt");
      if (startTimeGte != null || startTimeLt != null) {
        if (startTimeGte == null || startTimeLt == null) return json({ error: "Missing activity time range" }, 400);
        const start = Date.parse(startTimeGte);
        const end = Date.parse(startTimeLt);
        return json(records.filter((record) => Date.parse(record.startTime) >= start && Date.parse(record.startTime) < end));
      }
      return json(records.filter((record) => record.startTime.slice(0, 10) === date));
    }
    if (url.pathname === "/api/app/activities/latest") {
      const type = url.searchParams.get("types")?.split(",").at(-1);
      return json(records.filter((record) => !type || record.type === type).at(-1) ?? null);
    }
    if (url.pathname === "/api/app/daily-stats") {
      const start = url.searchParams.get("startDate");
      const end = url.searchParams.get("endDate");
      if (start == null || end == null) return json({ error: "Missing daily statistics range" }, 400);
      return json(daily.filter((row) => row.date >= start && row.date <= end));
    }
    return json({ error: `Unexpected endpoint: ${url.pathname}` }, 404);
  });
}

async function sendTouch(session: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", point = { x: 0, y: 0 }) {
  await session.send("Input.dispatchTouchEvent", {
    type, touchPoints: type === "touchEnd" ? [] : [{ ...point, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
  });
}

async function dragActiveScroll(page: Page, dy: number, finish = true): Promise<CDPSession> {
  const box = await page.locator(".bubu-paper-current .bubu-day-scroll").boundingBox();
  if (!box) throw new Error("Missing active day scroll");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const session = await page.context().newCDPSession(page);
  try {
    await sendTouch(session, "touchStart", point);
    for (let step = 1; step <= 12; step++) {
      await page.waitForTimeout(16);
      await sendTouch(session, "touchMove", { x: point.x, y: point.y + dy * step / 12 });
    }
    if (!finish) return session;
    await page.waitForTimeout(16);
    await sendTouch(session, "touchEnd");
    return session;
  } finally {
    if (finish) await session.detach();
  }
}

type TouchPoint = { x: number; y: number };
type HeldTouch = { session: CDPSession; pageBox: { x: number; y: number; width: number; height: number }; point: TouchPoint };

async function beginTouchAtCurrentScroll(page: Page): Promise<HeldTouch> {
  const pageBox = await page.locator(".bubu-paper-current .bubu-day-scroll").boundingBox();
  if (!pageBox) throw new Error("Missing active day scroll");
  const point = { x: pageBox.x + pageBox.width / 2, y: pageBox.y + pageBox.height / 2 };
  const session = await page.context().newCDPSession(page);
  await sendTouch(session, "touchStart", point);
  return { session, pageBox, point };
}

async function moveHeldTouch(page: Page, touch: HeldTouch, target: TouchPoint, steps = 6): Promise<void> {
  const from = touch.point;
  for (let step = 1; step <= steps; step++) {
    await page.waitForTimeout(16);
    await sendTouch(touch.session, "touchMove", {
      x: from.x + (target.x - from.x) * step / steps,
      y: from.y + (target.y - from.y) * step / steps,
    });
  }
  touch.point = target;
}

async function layerRotation(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    const matrix = new DOMMatrix(transform === "none" ? undefined : transform);
    return Math.atan2(matrix.m12, matrix.m11) * 180 / Math.PI;
  });
}

async function expectRotatedLayer(page: Page, selector: string): Promise<number> {
  await expect.poll(() => layerRotation(page, selector).then(Math.abs)).toBeGreaterThan(0.05);
  await expect.poll(() => layerRotation(page, selector).then(Math.abs)).toBeLessThanOrEqual(8);
  return layerRotation(page, selector);
}

async function expectFlatLayer(page: Page, selector: string): Promise<void> {
  await expect.poll(() => layerRotation(page, selector).then(Math.abs)).toBeLessThanOrEqual(0.01);
}

async function expectVisibleCurl(page: Page, layer: string): Promise<void> {
  const curl = page.locator(`${layer} .bubu-paper-curl`);
  await expect(curl).toHaveCount(1);
  await expect.poll(() => curl.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const opacity = Number(getComputedStyle(element).opacity);
    return Number.isFinite(opacity) && opacity > 0 && Math.max(rect.width, rect.height) > 5;
  })).toBe(true);
}

async function expectVisibleCastShadow(page: Page, layer: string): Promise<void> {
  const shadow = page.locator(`${layer} .bubu-paper-cast-shadow`);
  await expect(shadow).toHaveCount(1);
  await expect.poll(() => shadow.evaluate((element) => {
    const opacity = Number(getComputedStyle(element).opacity);
    return Number.isFinite(opacity) && opacity > 0;
  })).toBe(true);
}

async function expectIdleDecorations(page: Page): Promise<void> {
  await expect.poll(() => page.locator(".bubu-paper-curl, .bubu-paper-cast-shadow").evaluateAll((elements) => (
    elements.every((element) => Number(getComputedStyle(element).opacity) === 0)
  ))).toBe(true);
}

type TitleWindow = Window & { __bubuDateTitleHistory?: string[] };

async function startTitleHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const title = document.querySelector(".date-title");
    const history = [title?.textContent ?? ""];
    const observer = new MutationObserver(() => {
      const current = document.querySelector(".date-title")?.textContent ?? "";
      if (current !== history[history.length - 1]) history.push(current);
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    (window as TitleWindow).__bubuDateTitleHistory = history;
    return history;
  });
}

async function titleHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as TitleWindow).__bubuDateTitleHistory ?? []);
}

async function elementTranslation(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    return new DOMMatrix(transform === "none" ? undefined : transform).m42;
  });
}

const currentTranslation = (page: Page) => elementTranslation(page, ".bubu-paper-current");

async function expectHeldGeometry(page: Page, dy: number) {
  const viewportHeight = await page.locator(".bubu-timeline-viewport").evaluate((element) => element.getBoundingClientRect().height);
  if (dy > 0) {
    await expect.poll(() => currentTranslation(page)).toBe(0);
    const neighborY = () => elementTranslation(page, ".bubu-paper-neighbor-prev");
    await expect.poll(neighborY).toBeGreaterThanOrEqual(-viewportHeight + 103);
    await expect.poll(neighborY).toBeLessThanOrEqual(-viewportHeight + 117);
  } else {
    await expect.poll(() => currentTranslation(page)).toBeGreaterThanOrEqual(-113);
    await expect.poll(() => currentTranslation(page)).toBeLessThanOrEqual(-107);
    await expect.poll(() => elementTranslation(page, ".bubu-paper-neighbor-next")).toBe(0);
  }
}

async function expectPreloadedNeighbor(page: Page, direction: "next" | "prev", quantityLabel: string) {
  const side = `.bubu-paper-neighbor-${direction}`;
  await expect(page.locator(side)).toHaveCount(1);
  await expect(page.locator(`${side} .bubu-timeline-position`)).toHaveCount(1);
  await expect(page.locator(`${side} .bubu-timeline-position .bubu-event-label`)).toHaveText(quantityLabel);
}

async function holdFullPull(page: Page, dy: number, title = page.locator(".date-title")) {
  const heldDate = (await title.textContent()) ?? "";
  const session = await dragActiveScroll(page, dy, false);
  try {
    await expectHeldGeometry(page, dy);
    await expect(title).toHaveText(heldDate);
    await sendTouch(session, "touchEnd");
  } finally {
    await session.detach();
  }
}

test("top-down pull keeps its touch anchor through the full previous-page turn", async ({ page }) => {
  await syntheticApp(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  await expect(title).toContainText("今日（周六）");
  await page.locator(".bubu-paper-current .bubu-day-scroll").evaluate((element) => { element.scrollTop = 0; });
  await expectPreloadedNeighbor(page, "prev", "瓶喂 130ml");
  await holdFullPull(page, 110);
  await expect(title).toContainText("昨日（周五）");
});

test("bottom-up pull keeps its touch anchor through the full next-page turn", async ({ page }) => {
  await syntheticApp(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  await expect(title).toContainText("今日（周六）");
  await page.getByLabel("上一段日期", { exact: true }).click();
  await expect(title).toContainText("昨日（周五）");
  await page.locator(".bubu-paper-current .bubu-day-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expectPreloadedNeighbor(page, "next", "瓶喂 140ml");
  await holdFullPull(page, -110);
  await expect(title).toContainText("今日（周六）");
});

test("horizontal previous-turn curl follows the cross-axis origin and recoils without decoration residue", async ({ page }) => {
  await syntheticApp(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  await expect(title).toContainText("今日（周六）");
  const heldTitle = await title.textContent();

  const touch = await beginTouchAtCurrentScroll(page);
  try {
    const origin = touch.point;
    await moveHeldTouch(page, touch, { x: origin.x + 110, y: origin.y + 35 });
    await expectPreloadedNeighbor(page, "prev", "瓶喂 130ml");
    await expect(title).toHaveText(heldTitle ?? "");
    const firstAngle = await expectRotatedLayer(page, ".bubu-paper-neighbor-prev");
    await expectFlatLayer(page, ".bubu-paper-current");
    await expectVisibleCurl(page, ".bubu-paper-neighbor-prev");
    await expectVisibleCastShadow(page, ".bubu-paper-neighbor-prev");

    await moveHeldTouch(page, touch, { x: origin.x + 110, y: origin.y - 35 });
    const secondAngle = await expectRotatedLayer(page, ".bubu-paper-neighbor-prev");
    expect(firstAngle * secondAngle).toBeLessThan(0);
    await expectFlatLayer(page, ".bubu-paper-current");
    await expect(title).toHaveText(heldTitle ?? "");

    await moveHeldTouch(page, touch, { x: origin.x + 8, y: origin.y });
    await sendTouch(touch.session, "touchEnd");
    await page.waitForTimeout(250);
    await expect(title).toHaveText(heldTitle ?? "");
    await expectIdleDecorations(page);
  } finally {
    await touch.session.detach();
  }
});

test("horizontal next-turn rotates the current sheet, preloads the real next page, and refuses today's future", async ({ page }) => {
  await syntheticApp(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  await expect(title).toContainText("今日（周六）");
  await page.getByLabel("上一段日期", { exact: true }).click();
  await expect(title).toContainText("昨日（周五）");
  const heldTitle = await title.textContent();
  await startTitleHistory(page);

  const touch = await beginTouchAtCurrentScroll(page);
  try {
    const origin = touch.point;
    await moveHeldTouch(page, touch, { x: origin.x - 110, y: origin.y - 25 });
    await expectPreloadedNeighbor(page, "next", "瓶喂 140ml");
    await expect(title).toHaveText(heldTitle ?? "");
    await expectRotatedLayer(page, ".bubu-paper-current");
    await expectFlatLayer(page, ".bubu-paper-neighbor-next");
    await sendTouch(touch.session, "touchEnd");
  } finally {
    await touch.session.detach();
  }

  await expect(title).toContainText("今日（周六）");
  await page.waitForTimeout(250);
  await expect(title).toContainText("今日（周六）");
  expect(await titleHistory(page)).toEqual([heldTitle ?? "", "今日（周六）"]);

  const forbiddenTouch = await beginTouchAtCurrentScroll(page);
  try {
    const origin = forbiddenTouch.point;
    await moveHeldTouch(page, forbiddenTouch, { x: origin.x - 110, y: origin.y });
    await expect(title).toContainText("今日（周六）");
    await expectIdleDecorations(page);
    await sendTouch(forbiddenTouch.session, "touchEnd");
    await expect(title).toContainText("今日（周六）");
  } finally {
    await forbiddenTouch.session.detach();
  }
});

test("ordinary scrolling collapses and restores the day summary without losing navigation", async ({ page }) => {
  await syntheticApp(page);
  await page.goto("/");
  const summary = page.locator(".collapsible-day-summary");
  await expect(summary).toBeVisible();
  expect(await summary.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(0);
  await dragActiveScroll(page, -120);
  await expect.poll(() => summary.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
  await dragActiveScroll(page, 80);
  await expect.poll(() => summary.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(0);
  await expect(page.locator(".calendar-navigation")).toBeVisible();
});
