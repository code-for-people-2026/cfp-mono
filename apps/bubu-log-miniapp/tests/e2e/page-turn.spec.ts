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

type TouchPoint = { x: number; y: number };
type HeldTouch = { session: CDPSession; point: TouchPoint };

async function beginTouchAtCurrentScroll(page: Page): Promise<HeldTouch> {
  const pageBox = await page.locator(".bubu-paper-current .bubu-day-scroll").boundingBox();
  if (!pageBox) throw new Error("Missing active day scroll");
  const point = { x: pageBox.x + pageBox.width / 2, y: pageBox.y + pageBox.height / 2 };
  const session = await page.context().newCDPSession(page);
  await sendTouch(session, "touchStart", point);
  return { session, point };
}

async function moveHeldTouch(page: Page, touch: HeldTouch, target: TouchPoint, steps = 6): Promise<void> {
  const from = touch.point;
  for (let step = 1; step <= steps; step += 1) {
    await page.waitForTimeout(16);
    await sendTouch(touch.session, "touchMove", {
      x: from.x + (target.x - from.x) * step / steps,
      y: from.y + (target.y - from.y) * step / steps,
    });
  }
  touch.point = target;
}

type TextGeometry = {
  key: string;
  text: string;
  x: number;
  y: number;
  preview: boolean;
  identity: boolean;
};

async function captureTextGeometry(page: Page): Promise<TextGeometry[]> {
  return page.locator(".bubu-timeline-viewport .bubu-event-label").evaluateAll((elements) => elements.map((element, index) => {
    const rect = element.getBoundingClientRect();
    let node: Element | null = element;
    let identity = true;
    while (node != null && !node.classList.contains("bubu-timeline-viewport")) {
      const transform = getComputedStyle(node).transform;
      const matrix = new DOMMatrix(transform === "none" ? undefined : transform);
      const isPreviewScroll = node.classList.contains("bubu-paper-preview-scroll");
      const identityHere = matrix.m11 === 1 && matrix.m22 === 1
        && matrix.m12 === 0 && matrix.m21 === 0
        && matrix.m41 === 0 && (isPreviewScroll ? matrix.m42 <= 0.01 : matrix.m42 === 0);
      identity = identity && identityHere;
      node = node.parentElement;
    }
    return {
      key: `${index}:${element.textContent ?? ""}`,
      text: element.textContent ?? "",
      x: rect.x,
      y: rect.y,
      preview: element.closest(".bubu-paper-preview-scroll") != null,
      identity,
    };
  }));
}

async function expectStationaryText(page: Page, before: TextGeometry[], requirePreview: boolean) {
  const after = await captureTextGeometry(page);
  expect(after.length).toBeGreaterThanOrEqual(before.length);
  expect(before.some((item) => !item.preview)).toBe(true);
  if (requirePreview) expect(before.some((item) => item.preview)).toBe(true);
  for (const initial of before) {
    const current = after.find((item) => item.key === initial.key && item.text === initial.text);
    expect(current, initial.key).toBeDefined();
    expect(current?.x).toBeCloseTo(initial.x, 1);
    expect(current?.y).toBeCloseTo(initial.y, 1);
    expect(current?.identity).toBe(true);
  }
}

async function expectIdentityLayers(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    await expect.poll(() => page.locator(selector).evaluate((element) => {
      let node: Element | null = element;
      let identity = true;
      while (node != null && !node.classList.contains("bubu-timeline-viewport")) {
        const transform = getComputedStyle(node).transform;
        const matrix = new DOMMatrix(transform === "none" ? undefined : transform);
        identity = identity && matrix.m11 === 1 && matrix.m22 === 1
          && matrix.m12 === 0 && matrix.m21 === 0
          && matrix.m41 === 0 && matrix.m42 === 0;
        node = node.parentElement;
      }
      return identity;
    })).toBe(true);
  }
}

type FoldGeometry = {
  points: TouchPoint[];
  areaRatio: number;
  diagonal: number;
};

async function foldGeometry(page: Page, layer: string, kind: "back" | "flat"): Promise<FoldGeometry> {
  return page.locator(`${layer} .bubu-paper-${kind === "back" ? "fold-back" : "sheet-clip"}`).evaluate((element) => {
    const viewportElement = document.querySelector(".bubu-timeline-viewport");
    const viewportRect = viewportElement?.getBoundingClientRect();
    if (!viewportRect) return { points: [], areaRatio: 0, diagonal: 0 };

    type LocalPoint = { x: number; y: number };
    const clipPolygon = (inputClip: LocalPoint[], subject: LocalPoint[]): LocalPoint[] => {
      let doubledClipArea = 0;
      for (let index = 0; index < inputClip.length; index += 1) {
        const current = inputClip[index];
        const next = inputClip[(index + 1) % inputClip.length];
        doubledClipArea += current.x * next.y - next.x * current.y;
      }
      const clip = doubledClipArea < 0 ? [...inputClip].reverse() : inputClip;
      let output = [...subject];
      const intersect = (a: LocalPoint, b: LocalPoint, c: LocalPoint, d: LocalPoint) => {
        const edgeX = d.x - c.x;
        const edgeY = d.y - c.y;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const denominator = dx * edgeY - dy * edgeX;
        const amount = (edgeX * (a.y - c.y) - edgeY * (a.x - c.x)) / denominator;
        return { x: a.x + amount * dx, y: a.y + amount * dy };
      };
      for (let edge = 0; edge < clip.length; edge += 1) {
        if (output.length === 0) break;
        const a = clip[edge];
        const b = clip[(edge + 1) % clip.length];
        const edgeX = b.x - a.x;
        const edgeY = b.y - a.y;
        const inputPoints = output;
        output = [];
        for (let index = 0; index < inputPoints.length; index += 1) {
          const current = inputPoints[index];
          const next = inputPoints[(index + 1) % inputPoints.length];
          const currentInside = edgeX * (current.y - a.y) - edgeY * (current.x - a.x) >= -0.5;
          const nextInside = edgeX * (next.y - a.y) - edgeY * (next.x - a.x) >= -0.5;
          if (currentInside) {
            output.push(current);
            if (!nextInside) output.push(intersect(current, next, a, b));
          } else if (nextInside) {
            output.push(intersect(current, next, a, b));
          }
        }
      }
      return output;
    };
    const parseClipPath = (clipPath: string, clipRect: DOMRect): LocalPoint[] => {
      const percentages = [...clipPath.matchAll(/(-?\d+(?:\.\d+)?)%/g)].map((match) => Number(match[1]));
      if (percentages.length < 6 || percentages.length % 2 !== 0) return [];
      const points: LocalPoint[] = [];
      for (let index = 0; index < percentages.length; index += 2) {
        points.push({
          x: clipRect.left + percentages[index] / 100 * clipRect.width,
          y: clipRect.top + percentages[index + 1] / 100 * clipRect.height,
        });
      }
      return points;
    };

    const rect = element.getBoundingClientRect();
    const clip = parseClipPath(getComputedStyle(element).clipPath, rect);
    const viewport = [
      { x: viewportRect.left, y: viewportRect.top },
      { x: viewportRect.right, y: viewportRect.top },
      { x: viewportRect.right, y: viewportRect.bottom },
      { x: viewportRect.left, y: viewportRect.bottom },
    ];
    let visible = clipPolygon(viewport, clip);
    const parent = element.closest(".bubu-paper-fold-region");
    if (parent instanceof HTMLElement) {
      const parentRect = parent.getBoundingClientRect();
      const parentClip = parseClipPath(getComputedStyle(parent).clipPath, parentRect);
      visible = clipPolygon(parentClip, visible);
    }

    let doubledArea = 0;
    let diagonal = 0;
    for (let index = 0; index < visible.length; index += 1) {
      const current = visible[index];
      const next = visible[(index + 1) % visible.length];
      doubledArea += current.x * next.y - next.x * current.y;
      const dx = Math.abs(next.x - current.x);
      const dy = Math.abs(next.y - current.y);
      const total = dx + dy;
      if (total > viewportRect.width * 0.06) diagonal = Math.max(diagonal, Math.min(dx, dy) / total);
    }
    return {
      points: visible,
      areaRatio: Math.abs(doubledArea) / 2 / (viewportRect.width * viewportRect.height),
      diagonal,
    };
  });
}

async function expectFold(page: Page, layer: string, initialFlat: string): Promise<FoldGeometry> {
  await expect(page.locator(`${layer} .bubu-paper-fold-region`)).toHaveCount(1);
  await expect(page.locator(`${layer} .bubu-paper-fold-back`)).toHaveCount(1);
  await expect(page.locator(`${layer} .bubu-paper-fold-shadow`)).toHaveCount(1);
  const geometry = await foldGeometry(page, layer, "back");
  expect(geometry.areaRatio).toBeGreaterThan(0.02);
  expect(geometry.diagonal).toBeGreaterThan(0.02);
  const flat = await page.locator(`${layer} .bubu-paper-sheet-clip`).evaluate((element) => getComputedStyle(element).clipPath);
  expect(flat).not.toBe(initialFlat);
  return geometry;
}

async function expectIdleFold(page: Page) {
  await expect(page.locator(".bubu-paper-fold-back, .bubu-paper-fold-shadow")).toHaveCount(0);
}

async function expectPreloadedNeighbor(page: Page, direction: "next" | "prev", quantityLabel: string) {
  const side = `.bubu-paper-neighbor-${direction}`;
  await expect(page.locator(side)).toHaveCount(1);
  await expect(page.locator(`${side} .bubu-day-preview-canvas`)).toHaveCount(1);
  await expect(page.locator(`${side} .bubu-day-scroll`)).toHaveCount(0);
  await expect(page.locator(`${side} .bubu-timeline-position .bubu-event-label`)).toHaveText(quantityLabel);
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

test("vertical previous-turn keeps text stationary while a diagonal fold covers current", async ({ page }) => {
  await syntheticApp(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  await expect(title).toContainText("今日（周六）");
  await page.locator(".bubu-paper-current .bubu-day-scroll").evaluate((element) => { element.scrollTop = 0; });
  await expectPreloadedNeighbor(page, "prev", "瓶喂 130ml");

  const touch = await beginTouchAtCurrentScroll(page);
  try {
    const origin = touch.point;
    await moveHeldTouch(page, touch, { x: origin.x + 8, y: origin.y + 18 }, 3);
    const text = await captureTextGeometry(page);
    const initialFlat = await page.locator(".bubu-paper-neighbor-prev .bubu-paper-sheet-clip")
      .evaluate((element) => getComputedStyle(element).clipPath);
    await moveHeldTouch(page, touch, { x: origin.x + 28, y: origin.y + 110 });
    await expect(title).toHaveText("今日（周六）");
    await expectPreloadedNeighbor(page, "prev", "瓶喂 130ml");
    await expectIdentityLayers(page, [".bubu-paper-current", ".bubu-paper-neighbor-prev"]);
    await expectStationaryText(page, text, true);
    await expectFold(page, ".bubu-paper-neighbor-prev", initialFlat);
    await sendTouch(touch.session, "touchEnd");
  } finally {
    await touch.session.detach();
  }
  await expect(title).toContainText("昨日（周五）");
});

test("vertical next-turn keeps text stationary while a diagonal fold reveals real next", async ({ page }) => {
  await syntheticApp(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  await expect(title).toContainText("今日（周六）");
  await page.getByLabel("上一段日期", { exact: true }).click();
  await expect(title).toContainText("昨日（周五）");
  await page.locator(".bubu-paper-current .bubu-day-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expectPreloadedNeighbor(page, "next", "瓶喂 140ml");

  const touch = await beginTouchAtCurrentScroll(page);
  try {
    const origin = touch.point;
    await moveHeldTouch(page, touch, { x: origin.x - 10, y: origin.y - 18 }, 3);
    const text = await captureTextGeometry(page);
    const initialFlat = await page.locator(".bubu-paper-current .bubu-paper-sheet-clip")
      .evaluate((element) => getComputedStyle(element).clipPath);
    await moveHeldTouch(page, touch, { x: origin.x - 30, y: origin.y - 110 });
    await expect(title).toHaveText("昨日（周五）");
    await expectPreloadedNeighbor(page, "next", "瓶喂 140ml");
    await expectIdentityLayers(page, [".bubu-paper-current", ".bubu-paper-neighbor-next"]);
    await expectStationaryText(page, text, true);
    await expectFold(page, ".bubu-paper-current", initialFlat);
    await sendTouch(touch.session, "touchEnd");
  } finally {
    await touch.session.detach();
  }
  await expect(title).toContainText("今日（周六）");
});

test("horizontal previous-turn reverses diagonal within one held gesture and recoils", async ({ page }) => {
  await syntheticApp(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  await expect(title).toContainText("今日（周六）");
  const heldTitle = await title.textContent();

  const touch = await beginTouchAtCurrentScroll(page);
  try {
    const origin = touch.point;
    await moveHeldTouch(page, touch, { x: origin.x + 18, y: origin.y }, 3);
    const text = await captureTextGeometry(page);
    const initialFlat = await page.locator(".bubu-paper-neighbor-prev .bubu-paper-sheet-clip")
      .evaluate((element) => getComputedStyle(element).clipPath);
    await moveHeldTouch(page, touch, { x: origin.x + 110, y: origin.y + 35 });
    await expectPreloadedNeighbor(page, "prev", "瓶喂 130ml");
    await expect(title).toHaveText(heldTitle ?? "");
    await expectIdentityLayers(page, [".bubu-paper-current", ".bubu-paper-neighbor-prev"]);
    await expectStationaryText(page, text, true);
    const positive = await expectFold(page, ".bubu-paper-neighbor-prev", initialFlat);

    await moveHeldTouch(page, touch, { x: origin.x + 110, y: origin.y - 35 });
    const negative = await foldGeometry(page, ".bubu-paper-neighbor-prev", "back");
    expect(negative.areaRatio).toBeGreaterThan(0.02);
    expect(negative.points.some((point, index) => (
      Math.abs(point.x - positive.points[index].x) > 2
      || Math.abs(point.y - positive.points[index].y) > 2
    ))).toBe(true);
    await expectIdentityLayers(page, [".bubu-paper-current", ".bubu-paper-neighbor-prev"]);
    await expect(title).toHaveText(heldTitle ?? "");

    await moveHeldTouch(page, touch, { x: origin.x + 8, y: origin.y });
    await sendTouch(touch.session, "touchEnd");
    await page.waitForTimeout(250);
    await expect(title).toHaveText(heldTitle ?? "");
    await expectIdleFold(page);
  } finally {
    await touch.session.detach();
  }
});

test("horizontal next-turn preloads the real next page and refuses today's future", async ({ page }) => {
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
    await moveHeldTouch(page, touch, { x: origin.x - 18, y: origin.y }, 3);
    const text = await captureTextGeometry(page);
    const initialFlat = await page.locator(".bubu-paper-current .bubu-paper-sheet-clip")
      .evaluate((element) => getComputedStyle(element).clipPath);
    await moveHeldTouch(page, touch, { x: origin.x - 110, y: origin.y - 25 });
    await expectPreloadedNeighbor(page, "next", "瓶喂 140ml");
    await expect(title).toHaveText(heldTitle ?? "");
    await expectIdentityLayers(page, [".bubu-paper-current", ".bubu-paper-neighbor-next"]);
    await expectStationaryText(page, text, true);
    await expectFold(page, ".bubu-paper-current", initialFlat);
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
    await expectIdleFold(page);
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
  const scroll = page.locator(".bubu-paper-current .bubu-day-scroll");
  const session = await page.context().newCDPSession(page);
  try {
    for (const dy of [-120, 80]) {
      const box = await scroll.boundingBox();
      if (!box) throw new Error("Missing active day scroll");
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await sendTouch(session, "touchStart", point);
      for (let step = 1; step <= 12; step += 1) {
        await page.waitForTimeout(16);
        await sendTouch(session, "touchMove", { x: point.x, y: point.y + dy * step / 12 });
      }
      await page.waitForTimeout(16);
      await sendTouch(session, "touchEnd");
      await page.waitForTimeout(40);
      if (dy === -120) await expect.poll(() => summary.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
    }
  } finally {
    await session.detach();
  }
  await expect.poll(() => summary.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(0);
  await expect(page.locator(".calendar-navigation")).toBeVisible();
});
