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
