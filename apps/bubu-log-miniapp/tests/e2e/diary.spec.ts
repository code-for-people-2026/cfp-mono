import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { privacyFixture } from "../fixtures/privacy";

test.skip(process.env.BUBU_AUTH_MODE !== "legacy", "Requires an explicit legacy H5 build");

// Synthetic records only: this suite never connects to a family account or database.
const baby = { id: "test-baby", name: "小满", fullName: null, avatarUrl: null, isDefault: true };
const context = { authenticated: true, hasBaby: true, baby, babies: [baby], defaultBabyId: baby.id };
const activity = (id: string, type: string, startTime: string, extra = {}) => ({ id, babyId: baby.id, type, startTime, ...extra });
const records = [
  activity("sleep", "SLEEP", "2026-10-22T23:00:00+08:00", { endTime: "2026-10-23T07:00:00+08:00" }),
  activity("milk", "BOTTLE", "2026-10-23T08:30:00+08:00", { endTime: "2026-10-23T08:45:00+08:00", milkAmount: 120, milkSource: "FORMULA", burpSuccess: true, notes: "测试记录：喝得很慢" }),
  activity("diaper", "DIAPER", "2026-10-23T09:15:00+08:00", { hasPee: true, peeAmount: "LARGE", hasPoop: true, poopColor: "YELLOW", poopPhotoUrl: "/test-photo.svg" }),
  activity("head", "HEAD_LIFT", "2026-10-23T10:00:00+08:00", { endTime: "2026-10-23T10:10:00+08:00" }),
];
const gappedSleepRecords = [
  activity("sleep-morning", "SLEEP", "2026-10-23T08:00:00+08:00", { endTime: "2026-10-23T09:00:00+08:00" }),
  activity("sleep-noon", "SLEEP", "2026-10-23T12:30:00+08:00", { endTime: "2026-10-23T14:00:00+08:00" }),
];
const lateForegroundRecords = [
  activity("late-milk", "BOTTLE", "2026-10-23T23:59:00+08:00", { milkAmount: 90, milkSource: "FORMULA" }),
];
const denseWeekRecords = [
  activity("dense-sleep", "SLEEP", "2026-10-23T07:30:00+08:00", { endTime: "2026-10-23T09:30:00+08:00" }),
  activity("dense-milk", "BOTTLE", "2026-10-23T08:30:00+08:00", { endTime: "2026-10-23T09:00:00+08:00", milkAmount: 120, milkSource: "FORMULA" }),
  activity("dense-pump", "PUMP", "2026-10-23T08:32:00+08:00", { endTime: "2026-10-23T08:45:00+08:00", milkAmount: 80 }),
  activity("dense-diaper", "DIAPER", "2026-10-23T08:33:00+08:00", { hasPee: true }),
];
const overflowWeekRecords = [
  activity("overflow-sleep", "SLEEP", "2026-10-23T07:30:00+08:00", { endTime: "2026-10-23T09:30:00+08:00" }),
  activity("overflow-milk", "BOTTLE", "2026-10-23T08:30:00+08:00", { endTime: "2026-10-23T09:00:00+08:00", milkAmount: 120, milkSource: "FORMULA" }),
  activity("overflow-pump", "PUMP", "2026-10-23T08:32:00+08:00", { endTime: "2026-10-23T08:45:00+08:00", milkAmount: 80 }),
  activity("overflow-milk-two", "BOTTLE", "2026-10-23T08:31:00+08:00", { endTime: "2026-10-23T09:05:00+08:00", milkAmount: 120, milkSource: "FORMULA" }),
  activity("overflow-diaper", "DIAPER", "2026-10-23T08:33:00+08:00", { hasPee: true }),
];
const fullwidthDayRecords = [
  ...denseWeekRecords,
  activity("fullwidth-outdoor", "OUTDOOR", "2026-10-23T10:00:00+08:00", { endTime: "2026-10-23T11:00:00+08:00" }),
];
const ringRecords = [
  ...records,
  activity("ring-breastfeed", "BREASTFEED", "2026-10-23T10:30:00+08:00", { endTime: "2026-10-23T10:50:00+08:00" }),
  activity("ring-outdoor", "OUTDOOR", "2026-10-23T15:00:00+08:00", { endTime: "2026-10-23T18:20:00+08:00" }),
];
const daily = Array.from({ length: 30 }, (_, i) => ({
  id: `stat-${i}`, babyId: baby.id, date: new Date(Date.UTC(2026, 9, 23 - i)).toISOString().slice(0, 10),
  sleepCount: 4, totalSleepMinutes: 450 + i * 9, totalMilkAmount: 420 + i * 6,
  totalPumpMilkAmount: 160 + i * 3, diaperCount: 4 + i % 3,
}));

type AuditPage = { data: unknown[]; total?: number; hasMore?: boolean };
type AuditOptions = {
  pages?: AuditPage[];
  pagesForCall?: Array<AuditPage | undefined>;
  failures?: number;
  status?: number;
  statusForCall?: Array<number | undefined>;
  gateFirst?: boolean;
};
type FixtureOptions = {
  authenticated?: boolean;
  failActivities?: boolean;
  failProfile?: boolean;
  babyProfileStatus?: number;
  babyProfileGateFirst?: boolean;
  recordsOverride?: typeof records;
  audit?: AuditOptions;
};

async function fixture(page: Page, options: FixtureOptions = {}) {
  await page.clock.setSystemTime(new Date("2026-10-23T13:00:00+08:00"));
  let loggedIn = options.authenticated ?? true;
  const currentBaby = { ...baby };
  const activeRecords = options.recordsOverride ?? records;
  const requests: string[] = [];
  const auditRequests: string[] = [];
  const auditQueries: Array<Record<string, string>> = [];
  let releaseAudit = () => {};
  const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
  let releaseBabyProfile = () => {};
  const babyProfileGate = new Promise<void>((resolve) => { releaseBabyProfile = resolve; });
  await page.route("**/test-photo.svg", (route) => route.fulfill({
    status: 200, contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#d29c9a"/></svg>',
  }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const privacy = privacyFixture(url.pathname); if (privacy !== undefined) return route.fulfill({ json: privacy });
    requests.push(`${route.request().method()} ${url.pathname}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (url.pathname === "/api/auth/csrf") return json({ csrfToken: "test-csrf" });
    if (url.pathname === "/api/auth/callback/credentials") { loggedIn = true; return json({ url: "http://127.0.0.1:4338" }); }
    if (url.pathname === "/api/auth/signout") { loggedIn = false; return json({ url: "http://127.0.0.1:4338" }); }
    if (url.pathname === "/api/app/auth/context") return loggedIn ? json({ ...context, baby: currentBaby, babies: [currentBaby] }) : json({ authenticated: false, hasBaby: false }, 401);
    if (!loggedIn) return json({ code: "UNAUTHORIZED" }, 401);
    expect(url.searchParams.get("babyId")).toBe(baby.id);
    expect(route.request().headers()["x-baby-id"]).toBe(baby.id);
    if (url.pathname === `/api/app/user-babies/${baby.id}` && route.request().method() === "PATCH") {
      if (options.failProfile) return json({ error: "已存在同名宝宝" }, 409);
      Object.assign(currentBaby, route.request().postDataJSON());
      return json({ data: currentBaby });
    }
    if (url.pathname === "/api/app/baby-profile") {
      if (options.babyProfileGateFirst) await babyProfileGate;
      if (options.babyProfileStatus) return json({ error: "test profile failure" }, options.babyProfileStatus);
      return json({ ...currentBaby, birthDate: "2026-06-23" });
    }
    if (url.pathname === "/api/app/audits") {
      const call = auditRequests.length;
      auditRequests.push("GET /api/app/audits");
      auditQueries.push(Object.fromEntries(url.searchParams.entries()));
      if (call === 0 && options.audit?.gateFirst) await auditGate;
      if (call < (options.audit?.failures ?? 0)) return json({ error: "test audit outage" }, 500);
      const callStatus = options.audit?.statusForCall?.[call] ?? options.audit?.status;
      if (callStatus) return json({ error: "Unauthorized", code: "UNAUTHORIZED" }, callStatus);
      const pageIndex = Math.floor(Number(url.searchParams.get("offset") ?? 0) / 200);
      const chosen = options.audit?.pagesForCall?.[call] ?? options.audit?.pages?.[pageIndex];
      const auditPage = chosen ?? { data: [], total: 0, hasMore: false };
      return json({ data: auditPage.data, total: auditPage.total ?? auditPage.data.length, hasMore: auditPage.hasMore ?? false });
    }
    if (url.pathname === "/api/app/activities") {
      if (options.failActivities) return json({ error: "test outage" }, 503);
      return json(url.searchParams.get("date") === "2026-10-22" ? [] : activeRecords);
    }
    if (url.pathname === "/api/app/activities/latest") return json(activeRecords.find((row) => url.searchParams.get("types")?.includes(row.type)) || null);
    if (url.pathname.startsWith("/api/app/activities/")) return json(activeRecords.find((row) => row.id === url.pathname.split("/").pop()));
    if (url.pathname === "/api/app/daily-stats") return json(daily.filter((row) => row.date >= url.searchParams.get("startDate")! && row.date <= url.searchParams.get("endDate")!));
    return json({ error: "Unexpected endpoint" }, 404);
  });
  return {
    requests,
    auditRequests,
    auditQueries,
    releaseAudit: () => releaseAudit(),
    releaseBabyProfile: () => releaseBabyProfile(),
  };
}

const provenanceAudit = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  action: "CREATE",
  resourceType: "ACTIVITY",
  success: true,
  inputMethod: "TEXT",
  resourceId: "milk",
  activityId: null,
  babyId: baby.id,
  userId: "account-synthetic-001",
  inputText: "审计记录中的原话：喝得很慢。",
  createdAt: "2026-10-23T08:31:00+08:00",
  beforeData: { snapshot: "not rendered" },
  afterData: { snapshot: "not rendered" },
  errorMessage: null,
  ...extra,
});

async function menu(page: Page, label: string) {
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-drawer").locator("taro-button-core").filter({ has: page.getByText(label, { exact: true }) }).click();
}
async function calendarView(page: Page, label: string) {
  if (await page.locator(".record-row, .bubu-chart-point").count()) await menu(page, "日历");
  await page.getByLabel("展开日期与日历视图", { exact: true }).click();
  await page.locator(".calendar-view-option").filter({ hasText: new RegExp(`^${label}`) }).click();
}

type TouchPoint = { x: number; y: number; id?: number };
async function touchSession(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}
async function sendTouch(session: CDPSession, type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", points: TouchPoint[]) {
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((point, index) => ({ x: point.x, y: point.y, id: point.id ?? index, radiusX: 2, radiusY: 2, force: 1 })),
  });
}
async function scrollBox(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Missing scroll viewport ${selector}`);
  return box;
}
async function swipe(page: Page, selector: string, dx: number, dy: number, steps = 6) {
  const box = await scrollBox(page, selector);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const session = await touchSession(page);
  try {
    await sendTouch(session, "touchStart", [start]);
    for (let step = 1; step <= steps; step++) {
      await page.waitForTimeout(16);
      await sendTouch(session, "touchMove", [{ x: start.x + dx * step / steps, y: start.y + dy * step / steps }]);
    }
    await page.waitForTimeout(16);
    await sendTouch(session, "touchEnd", []);
  } finally {
    await session.detach();
  }
  // Let any native scroll momentum settle before the test inspects/offsets it.
  await page.waitForTimeout(250);
}
async function pinch(page: Page, selector: string, fromGap: number, toGap: number, steps = 8) {
  const box = await scrollBox(page, selector);
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const points = (gap: number) => [
    { x: center.x, y: center.y - gap / 2, id: 0 },
    { x: center.x, y: center.y + gap / 2, id: 1 },
  ];
  const session = await touchSession(page);
  try {
    await sendTouch(session, "touchStart", points(fromGap));
    for (let step = 1; step <= steps; step++) {
      await page.waitForTimeout(16);
      await sendTouch(session, "touchMove", points(fromGap + (toGap - fromGap) * step / steps));
    }
    await page.waitForTimeout(16);
    await sendTouch(session, "touchEnd", []);
  } finally {
    await session.detach();
  }
}
async function setScrollTop(page: Page, selector: string, target: number | "top" | "bottom") {
  const apply = () => page.locator(selector).evaluate((element, value) => {
    const node = element as HTMLElement;
    if (value === "top") node.scrollTop = 0;
    else if (value === "bottom") node.scrollTop = node.scrollHeight;
    else node.scrollTop = value;
  }, target);
  const atTarget = () => page.locator(selector).evaluate((element, value) => {
    const node = element as HTMLElement;
    const max = Math.max(0, node.scrollHeight - node.clientHeight);
    const expected = value === "top" ? 0 : value === "bottom" ? max : Math.min(Math.max(0, value), max);
    return Math.abs(node.scrollTop - expected) <= 2;
  }, target);
  const waitForQuiet = () => page.locator(selector).evaluate(async (element) => {
    const node = element as HTMLElement;
    let previous = node.scrollTop;
    let quiet = 0;
    for (let index = 0; index < 24 && quiet < 3; index++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const next = node.scrollTop;
      quiet = Math.abs(next - previous) < 0.5 ? quiet + 1 : 0;
      previous = next;
    }
  });

  // Touch flings use native compositor momentum that may still move scrollTop
  // after a programmatic assignment. Settle, verify the real offset, and retry
  // instead of assuming the boundary was reached. Momentum can resume only after
  // the in-page evaluate returns, so re-check after an out-of-page pause too.
  for (let attempt = 0; attempt < 8; attempt++) {
    await apply();
    await page.waitForTimeout(250);
    await waitForQuiet();
    if (await atTarget()) {
      await page.waitForTimeout(200);
      if (await atTarget()) return;
    }
  }
  expect(await atTarget()).toBe(true);
}
async function readAxisGeometry(page: Page, scrollSelector: string, canvasSelector: string, midPageY: number) {
  return page.evaluate(({ midY, scrollSelector: scrollName, canvasSelector: canvasName }) => {
    const scroll = document.querySelector(scrollName) as HTMLElement;
    const canvas = document.querySelector(canvasName) as HTMLElement;
    const scrollRect = scroll.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const canvasTop = canvasRect.top - scrollRect.top + scroll.scrollTop;
    return {
      canvasHeight: canvasRect.height,
      scrollTop: scroll.scrollTop,
      scrollHeight: scroll.scrollHeight,
      maxScroll: Math.max(0, scroll.scrollHeight - scroll.clientHeight),
      viewportHeight: scroll.clientHeight,
      canvasTop,
      fraction: (scroll.scrollTop + (midY - scrollRect.top) - canvasTop) / canvasRect.height,
      visualScale: window.visualViewport?.scale ?? 1,
      viewportWidth: document.documentElement.clientWidth,
    };
  }, { midY: midPageY, scrollSelector, canvasSelector });
}
const readDayGeometry = (page: Page, midPageY: number) =>
  readAxisGeometry(page, ".bubu-day-scroll", ".bubu-day-canvas", midPageY);
const readWeekGeometry = (page: Page, midPageY: number) =>
  readAxisGeometry(page, ".bubu-week-scroll", ".bubu-week-canvas", midPageY);

test("existing account opens day, week, heatmap, trends and read-only details", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { requests } = await fixture(page, { authenticated: false });
  await page.goto("/");
  await page.locator('input[placeholder="请输入用户名或邮箱"]').fill("parent");
  await page.locator('input[placeholder="请输入密码"]').fill("test-password");
  await page.getByText("登录", { exact: true }).click();
  await expect(page.locator(".date-title")).toContainText("今日（周五）");
  await expect(page.locator(".date-title")).not.toContainText("⌄");
  await expect(page.locator(".stats-grid")).toContainText("120 ml");
  const cards = page.locator(".stat-card");
  const statColors = [
    "rgb(111, 86, 136)",
    "rgb(163, 79, 112)",
    "rgb(163, 79, 112)",
    "rgb(128, 86, 109)",
    "rgb(128, 107, 23)",
    "rgb(63, 107, 79)",
    "rgb(150, 107, 80)",
    "rgb(150, 107, 80)",
  ];
  for (const [index, color] of statColors.entries()) {
    await expect(cards.nth(index)).toHaveCSS("background-color", "rgb(255, 253, 249)");
    await expect(cards.nth(index).locator(".stat-label")).toHaveCSS("color", color);
  }
  await page.screenshot({ path: "test-results/diary-day.png", fullPage: true });
  await calendarView(page, "周历");
  await expect(page.locator(".bubu-week-card")).toBeVisible();
  await expect(page.locator(".date-title")).toContainText("本周（10/19–）");
  await expect(page.locator(".bubu-week-event-label").filter({ hasText: "120ml" })).toHaveCount(1);
  await expect(page.locator(".bubu-week-event-label").filter({ hasText: "08:30" })).toHaveCount(0);
  await page.locator(".bubu-week-event").filter({ hasText: /^7h$/ }).click();
  await expect(page.locator(".bubu-detail-type")).toContainText("睡眠");
  await page.getByText("关闭", { exact: true }).last().click();
  await page.locator(".bubu-week-event").filter({ hasText: "120ml" }).click();
  await expect(page.getByText("测试记录：喝得很慢", { exact: true }).last()).toBeVisible();
  await page.getByText("关闭", { exact: true }).last().click();
  await page.screenshot({ path: "test-results/diary-week.png", fullPage: true });
  await calendarView(page, "月历");
  await expect(page.locator(".bubu-heatmap-card")).toBeVisible();
  await expect(page.locator(".date-title")).toContainText("本月（10月）");
  await expect(page.getByText("近四周", { exact: true })).toHaveCount(0);
  await expect(page.locator(".bubu-heatmap-week")).toHaveCount(5);
  await expect(page.locator(".bubu-heatmap-cell")).toHaveCount(35);
  await expect(page.locator(".bubu-heatmap-padding")).toHaveCount(4);
  await expect(page.locator(".bubu-range-switch")).toHaveCount(0);
  await expect(page.locator(".bubu-legend-item")).toHaveCount(4);
  await expect(page.locator(".data-note")).toBeVisible();
  await page.screenshot({ path: "test-results/diary-month.png", fullPage: true });
  await page.getByText("查看当天 ›", { exact: true }).click();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  await expect(page.locator(".bubu-timeline-background", { hasText: "睡眠" })).toBeVisible();
  await page.getByText("‹ 返回月历", { exact: true }).click();
  await expect(page.locator(".date-title")).toContainText("本月（10月）");
  await menu(page, "趋势");
  await expect(page.locator(".data-note")).toBeVisible();
  await expect(page.locator(".bubu-chart-line").first()).toBeVisible();
  await expect(page.locator(".bubu-chart-point")).toHaveCount(28);
  await page.screenshot({ path: "test-results/diary-trends.png", fullPage: true });
  await page.getByText("14 天", { exact: true }).click();
  await expect(page.locator(".bubu-chart-point")).toHaveCount(56);
  await page.getByText("30 天", { exact: true }).click();
  await expect(page.locator(".bubu-chart-point")).toHaveCount(120);
  await menu(page, "历史记录");

  await expect(page.locator(".record-row")).toHaveCount(4);
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await expect(page.getByText("测试记录：喝得很慢", { exact: true }).last()).toBeVisible();
  await page.screenshot({ path: "test-results/diary-detail.png", fullPage: true });
  expect(requests.filter((request) => request.startsWith("POST /api/app"))).toEqual([]);
  expect(errors).toEqual([]);
});

test("detail more info stays collapsed until expansion and reads the scoped audit only then", async ({ page }) => {
  const { requests, auditRequests, auditQueries } = await fixture(page, {
    audit: { pages: [{ data: [provenanceAudit("audit-1")] }] },
  });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await expect(page.locator(".bubu-detail-sheet")).toBeVisible();
  const core = page.locator(".bubu-detail-fields");
  await expect(core).toContainText("测试记录：喝得很慢");
  await expect(core).not.toContainText("记录时间");
  await expect(core).not.toContainText("更新时间");
  await expect(page.getByText("更多信息", { exact: true })).toBeVisible();
  await expect(page.locator(".bubu-provenance-content")).toHaveCount(0);
  expect(auditRequests).toHaveLength(0);

  await page.getByLabel("展开更多信息", { exact: true }).click();
  const more = page.locator(".bubu-provenance-content");
  await expect(more).toContainText("记录账号");
  await expect(more).toContainText("account-synthetic-001");
  await expect(more).toContainText("文本录入");
  await expect(more).toContainText("10月23日 08:31");
  await expect(more).toContainText("审计记录中的原话：喝得很慢。");
  await expect.poll(() => auditRequests.length).toBe(1);
  expect(auditQueries[0]).toMatchObject({
    action: "CREATE", resourceType: "ACTIVITY", success: "true", limit: "200", offset: "0", babyId: baby.id,
  });
  expect(requests.filter((request) => request === "POST /api/app/audits")).toEqual([]);

  // Collapse/re-expand uses the in-memory result, then closing resets the section.
  await page.getByLabel("收起更多信息", { exact: true }).click();
  await expect(page.locator(".bubu-provenance-content")).toHaveCount(0);
  await page.getByLabel("展开更多信息", { exact: true }).click();
  await expect(page.locator(".bubu-provenance-content")).toContainText("account-synthetic-001");
  expect(auditRequests).toHaveLength(1);

  await page.getByText("关闭", { exact: true }).last().click();
  await expect(page.locator(".bubu-detail-sheet")).toHaveCount(0);
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await expect(page.locator(".bubu-provenance-content")).toHaveCount(0);
  expect(auditRequests).toHaveLength(1);
  await page.getByLabel("展开更多信息", { exact: true }).click();
  await expect(page.locator(".bubu-provenance-content")).toContainText("account-synthetic-001");
  await expect.poll(() => auditRequests.length).toBe(2);
});

test("missing original text says so instead of showing the activity note as a quote", async ({ page }) => {
  await fixture(page, { audit: { pages: [{ data: [provenanceAudit("audit-no-text", { inputText: null })] }] } });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  const original = page.locator(".bubu-provenance-row").filter({ hasText: "原话" });
  await expect(original).toContainText("未记录原话");
  await expect(original).not.toContainText("测试记录：喝得很慢");
  await expect(page.locator(".bubu-detail-fields")).toContainText("测试记录：喝得很慢");
});

test("closing during an in-flight audit discards the late response and reopens collapsed", async ({ page }) => {
  const late = provenanceAudit("audit-late", { userId: "late-account" });
  const fresh = provenanceAudit("audit-fresh", { userId: "fresh-account" });
  const control = await fixture(page, {
    audit: { gateFirst: true, pagesForCall: [{ data: [late] }, { data: [fresh] }] },
  });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  await expect.poll(() => control.auditRequests.length).toBe(1);
  await page.getByText("关闭", { exact: true }).last().click();
  await expect(page.locator(".bubu-detail-sheet")).toHaveCount(0);
  control.releaseAudit();

  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await expect(page.locator(".bubu-provenance-content")).toHaveCount(0);
  await page.getByLabel("展开更多信息", { exact: true }).click();
  await expect(page.locator(".bubu-provenance-content")).toContainText("fresh-account");
  await page.waitForTimeout(150);
  await expect(page.locator(".bubu-provenance-content")).not.toContainText("late-account");
  expect(control.auditRequests).toHaveLength(2);
});

test("an unavailable audit keeps the basic detail visible with stable copy and retry", async ({ page }) => {
  const control = await fixture(page, {
    audit: { failures: 1, pages: [{ data: [provenanceAudit("audit-retry", { userId: "retry-account" })] }] },
  });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await expect(page.locator(".bubu-detail-fields")).toContainText("120 ml");
  await page.getByLabel("展开更多信息", { exact: true }).click();
  const more = page.locator(".bubu-provenance-content");
  await expect(more).toContainText("暂无法读取");
  await expect(more).toContainText("来源信息暂时无法读取，请稍后重试。");
  await expect(more).not.toContainText("test audit outage");
  await expect(more).toContainText("重试");
  await expect(page.locator(".bubu-detail-fields")).toContainText("测试记录：喝得很慢");
  await page.getByText("重试", { exact: true }).click();
  await expect(more).toContainText("retry-account");
  await expect(more).toContainText("审计记录中的原话：喝得很慢。");
  expect(control.auditRequests).toHaveLength(2);
});

test("an absent source uses plain language instead of backend wording", async ({ page }) => {
  await fixture(page, { audit: { pages: [{ data: [] }] } });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  const more = page.locator(".bubu-provenance-content");
  await expect(more).toContainText("暂未找到这条记录的来源。");
  await expect(more).toContainText("未记录原话");
  await expect(more).not.toContainText("创建审计");
  await expect(more).not.toContainText("audit");
});

test("an incomplete scan uses plain language and permits a retry", async ({ page }) => {
  const control = await fixture(page, {
    audit: { pages: [{ data: [provenanceAudit("unrelated", { resourceId: "other-activity" })], hasMore: true }] },
  });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  const more = page.locator(".bubu-provenance-content");
  await expect(more).toContainText("来源信息暂未读全，请稍后重试。");
  await expect(more).not.toContainText("返回页没有进展");
  await expect(more).toContainText("重试");
  await expect.poll(() => control.auditRequests.length).toBe(1);
  await page.getByText("重试", { exact: true }).click();
  await expect.poll(() => control.auditRequests.length).toBe(2);
  await expect(more).toContainText("来源信息暂未读全，请稍后重试。");
});

test("closing stops a multi-page audit scan before requesting another page", async ({ page }) => {
  const scan = Array.from({ length: 200 }, (_, index) => provenanceAudit(`scan-${index}`, { resourceId: `other-${index}` }));
  const control = await fixture(page, {
    audit: { gateFirst: true, pages: [{ data: scan, hasMore: true }, { data: [provenanceAudit("never-requested")] }] },
  });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  await expect.poll(() => control.auditRequests.length).toBe(1);
  await page.getByText("关闭", { exact: true }).last().click();
  await expect(page.locator(".bubu-detail-sheet")).toHaveCount(0);
  control.releaseAudit();
  await page.waitForTimeout(250);
  expect(control.auditRequests).toHaveLength(1);
});

test("collapsing stops a multi-page audit scan before requesting another page", async ({ page }) => {
  const scan = Array.from({ length: 200 }, (_, index) => provenanceAudit(`scan-${index}`, { resourceId: `other-${index}` }));
  const control = await fixture(page, {
    audit: { gateFirst: true, pages: [{ data: scan, hasMore: true }, { data: [provenanceAudit("never-requested")] }] },
  });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  await expect.poll(() => control.auditRequests.length).toBe(1);
  await page.getByLabel("收起更多信息", { exact: true }).click();
  await expect(page.locator(".bubu-provenance-content")).toHaveCount(0);
  control.releaseAudit();
  await page.waitForTimeout(250);
  expect(control.auditRequests).toHaveLength(1);
});

test("a 401 from the optional audit clears the private view like other session expiry", async ({ page }) => {
  await fixture(page, { audit: { status: 401 } });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  await expect(page.locator('input[placeholder="请输入密码"]')).toBeVisible();
  await expect(page.locator(".bubu-detail-sheet")).toHaveCount(0);
  await expect(page.locator(".stats-grid")).toHaveCount(0);
  await expect(page.getByText("登录已过期，请重新登录", { exact: true })).toBeVisible();
});

test("an audit 401 arriving after the detail closed still clears the private view", async ({ page }) => {
  const control = await fixture(page, { audit: { gateFirst: true, statusForCall: [401] } });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  await expect.poll(() => control.auditRequests.length).toBe(1);
  await page.getByText("关闭", { exact: true }).last().click();
  await expect(page.locator(".bubu-detail-sheet")).toHaveCount(0);
  // The family calendar is still on screen while the gated response is pending.
  await expect(page.locator(".record-row")).toHaveCount(4);
  control.releaseAudit();
  await expect(page.locator('input[placeholder="请输入密码"]')).toBeVisible();
  await expect(page.getByText("登录已过期，请重新登录", { exact: true })).toBeVisible();
  await expect(page.locator(".record-row")).toHaveCount(0);
  await expect(page.locator(".bubu-detail-sheet")).toHaveCount(0);
  // The expired session stops the bounded scan; no further audit page is requested.
  await page.waitForTimeout(250);
  expect(control.auditRequests).toHaveLength(1);
});

test("an audit 401 arriving after collapsing more info still clears the private view", async ({ page }) => {
  const control = await fixture(page, { audit: { gateFirst: true, statusForCall: [401] } });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  await expect.poll(() => control.auditRequests.length).toBe(1);
  await page.getByLabel("收起更多信息", { exact: true }).click();
  await expect(page.locator(".bubu-provenance-content")).toHaveCount(0);
  await expect(page.locator(".bubu-detail-sheet")).toBeVisible();
  control.releaseAudit();
  await expect(page.locator('input[placeholder="请输入密码"]')).toBeVisible();
  await expect(page.getByText("登录已过期，请重新登录", { exact: true })).toBeVisible();
  await expect(page.locator(".record-row")).toHaveCount(0);
  await expect(page.locator(".bubu-detail-sheet")).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(control.auditRequests).toHaveLength(1);
});

test("a second completed sleep band keeps its interval and stays full width", async ({ page }) => {
  await fixture(page, { recordsOverride: gappedSleepRecords });
  await page.goto("/");
  const bands = page.locator(".bubu-timeline-background");
  await expect(bands).toHaveCount(2);
  await expect(bands.nth(0).locator(".bubu-event-gap")).toHaveCount(0);
  await expect(bands.nth(1).locator(".bubu-event-gap")).toHaveText("距上次 3小时30分钟");
  const widths = await bands.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).style.width));
  expect(widths).toEqual(["100%", "100%"]);
});

test("320px day backgrounds span the hour gutter while foreground records stay clickable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fixture(page, { recordsOverride: fullwidthDayRecords });
  await page.goto("/");
  await expect(page.locator(".bubu-latest-gap").filter({ hasText: "距上次睡眠" }).locator(".bubu-legend-dot"))
    .toHaveCSS("background-color", "rgb(111, 86, 136)");
  await expect(page.locator(".bubu-latest-gap").filter({ hasText: "距上次吃奶" }).locator(".bubu-legend-dot"))
    .toHaveCSS("background-color", "rgb(163, 79, 112)");
  const bands = page.locator(".bubu-timeline-background");
  await expect(bands).toHaveCount(2);
  await expect(bands.filter({ hasText: "睡眠" }).locator(".bubu-timeline-band"))
    .toHaveCSS("background-color", "rgb(240, 235, 246)");
  await expect(bands.filter({ hasText: "睡眠" }).locator(".bubu-event-label"))
    .toHaveCSS("color", "rgb(111, 86, 136)");
  await expect(bands.filter({ hasText: "户外" }).locator(".bubu-timeline-band"))
    .toHaveCSS("background-color", "rgb(234, 243, 232)");
  await expect(bands.filter({ hasText: "户外" }).locator(".bubu-event-label"))
    .toHaveCSS("color", "rgb(63, 107, 79)");
  expect(await bands.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).style.width)))
    .toEqual(["100%", "100%"]);
  const band = page.locator(".bubu-timeline-background").first();
  await band.scrollIntoViewIfNeeded();
  await expect(band).toBeVisible();
  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector(".bubu-day-canvas") as HTMLElement;
    const backgroundLayer = canvas.querySelector(".bubu-day-backgrounds") as HTMLElement;
    const background = backgroundLayer.querySelector(".bubu-timeline-background") as HTMLElement;
    const backgroundLabel = background.querySelector(".bubu-event-label") as HTMLElement;
    const gutterLabel = canvas.querySelector(".bubu-hour-label") as HTMLElement;
    const hourRow = canvas.querySelector(".bubu-hour-row") as HTMLElement;
    const recordLayer = canvas.querySelector(".bubu-day-events") as HTMLElement;
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    };
    return {
      background: rect(background),
      backgroundLabel: rect(backgroundLabel),
      canvas: rect(canvas),
      gutterLabel: rect(gutterLabel),
      recordLayer: rect(recordLayer),
      backgroundLayerZ: Number.parseInt(getComputedStyle(backgroundLayer).zIndex, 10),
      hourRowZ: Number.parseInt(getComputedStyle(hourRow).zIndex, 10),
      recordLayerZ: Number.parseInt(getComputedStyle(recordLayer).zIndex, 10),
    };
  });
  expect(geometry.background.left).toBeCloseTo(geometry.canvas.left, 1);
  expect(geometry.background.right).toBeCloseTo(geometry.canvas.right, 1);
  expect(geometry.gutterLabel.left).toBeGreaterThanOrEqual(geometry.background.left - 0.5);
  expect(geometry.gutterLabel.right).toBeLessThanOrEqual(geometry.background.right + 0.5);
  expect(geometry.backgroundLabel.left).toBeCloseTo(geometry.recordLayer.left, 1);
  expect(geometry.recordLayerZ).toBeGreaterThan(geometry.backgroundLayerZ);
  expect(geometry.hourRowZ).toBeGreaterThan(geometry.backgroundLayerZ);

  const pump = page.locator(".bubu-timeline-position").filter({ hasText: "吸奶 80ml" });
  await pump.scrollIntoViewIfNeeded();
  await pump.click();
  await expect(page.locator(".bubu-detail-type")).toContainText("吸奶");
  await page.getByText("关闭", { exact: true }).last().click();

  const milk = page.locator(".bubu-timeline-position").filter({ hasText: "瓶喂 120ml" });
  await milk.click();
  await expect(page.locator(".bubu-detail-type")).toContainText("瓶喂");
  await page.getByText("关闭", { exact: true }).last().click();

  await band.click({ position: { x: 8, y: 20 } });
  await expect(page.locator(".bubu-detail-type")).toContainText("睡眠");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("320px late foreground block keeps its readable height inside 24:00 and opens its original time", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fixture(page, { recordsOverride: lateForegroundRecords });
  await page.goto("/");
  const block = page.locator(".bubu-timeline-position").filter({ hasText: "90ml" });
  await block.scrollIntoViewIfNeeded();
  await expect(block).toBeVisible();
  const geometry = await block.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const canvas = (element.closest(".bubu-day-canvas") as HTMLElement).getBoundingClientRect();
    return { height: rect.height, bottom: rect.bottom - canvas.top, canvasHeight: canvas.height };
  });
  expect(geometry.height).toBeGreaterThanOrEqual(30);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.canvasHeight + 1);
  await block.click();
  await expect(page.locator(".bubu-detail-sheet")).toBeVisible();
  const start = page.locator(".bubu-detail-row").filter({ hasText: "开始时间" });
  await expect(start).toContainText("10月23日 23:59");
});

test("320px long provenance ids and text wrap inside the scroll sheet and the photo still previews", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const longAccount = `account-${"a".repeat(80)}`;
  const longText = `原话${"这是一段需要换行的原话。".repeat(24)}`;
  await fixture(page, {
    audit: { pages: [{ data: [provenanceAudit("audit-long", { resourceId: "diaper", userId: longAccount, inputText: longText })] }] },
  });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "大小便" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  const account = page.locator(".bubu-provenance-row").filter({ hasText: "记录账号" });
  const original = page.locator(".bubu-provenance-row").filter({ hasText: "原话" });
  await expect(account).toContainText(longAccount);
  await expect(original).toContainText(longText);
  const geometry = await page.locator(".bubu-detail-body").evaluate((element) => {
    const body = element as HTMLElement;
    return { clientWidth: body.clientWidth, scrollWidth: body.scrollWidth };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  const rows = await page.locator(".bubu-provenance-value").evaluateAll((elements) => elements.map((element) => {
    const value = element as HTMLElement;
    const style = getComputedStyle(value);
    return {
      scrollWidth: value.scrollWidth,
      clientWidth: value.clientWidth,
      height: value.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
    };
  }));
  expect(rows.length).toBeGreaterThanOrEqual(3);
  for (const row of rows) expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
  const longRows = rows.filter((row) => row.height > row.lineHeight * 1.5);
  expect(longRows.length).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  const photo = page.locator(".bubu-detail-photo");
  await photo.scrollIntoViewIfNeeded();
  await expect(photo).toBeVisible();
  await photo.click();
  await expect(page.locator(".preview-image")).toBeVisible();
  await page.locator(".preview-image").click();
  await expect(page.locator(".preview-image")).toHaveCount(0);
});

test("horizontal swipes use the standard left-next and right-previous direction in day and week", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  await expect(title).toContainText("今日（周五）");

  // Gestures only belong to the time-axis viewport.
  await swipe(page, ".calendar-navigation", -100, 0);
  await expect(title).toContainText("今日（周五）");

  await swipe(page, ".bubu-day-scroll", 100, 0);
  await expect(title).toContainText("昨日（周四）");
  await expect(page.locator(".stats-grid")).toBeVisible();
  await expect(page.locator(".bubu-day-scroll")).toBeVisible();

  await swipe(page, ".bubu-day-scroll", -100, 0);
  await expect(title).toContainText("今日（周五）");
  await expect(page.locator(".stats-grid")).toBeVisible();
  await expect(page.locator(".bubu-day-scroll")).toBeVisible();

  await swipe(page, ".bubu-day-scroll", -100, 0);
  await expect(page.locator(".bubu-gesture-feedback")).toContainText("已经是今天，无法查看未来");
  await expect(title).toContainText("今日（周五）");

  await calendarView(page, "周历");
  await expect(page.locator(".bubu-week-scroll")).toBeVisible();
  await expect(title).toContainText("本周（10/19–）");

  await swipe(page, ".bubu-week-scroll", 100, 0);
  await expect(title).toContainText("上周（10/12–10/18）");
  await expect(page.locator(".bubu-week-scroll")).toBeVisible();

  await swipe(page, ".bubu-week-scroll", -100, 0);
  await expect(title).toContainText("本周（10/19–）");
  await expect(page.locator(".bubu-week-scroll")).toBeVisible();

  await swipe(page, ".bubu-week-scroll", -100, 0);
  await expect(page.locator(".bubu-gesture-feedback")).toContainText("已经是本周，无法查看未来");
  await expect(title).toContainText("本周（10/19–）");
});

test("vertical boundary gestures stay ordinary scrolling without paging", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  await expect(title).toContainText("今日（周五）");

  await setScrollTop(page, ".bubu-day-scroll", "top");
  await swipe(page, ".bubu-day-scroll", 0, 120, 6);
  await expect(title).toContainText("今日（周五）");
  await expect(page.locator(".bubu-gesture-feedback")).toHaveCount(0);
  await expect(page.locator(".bubu-paper-fold-back, .bubu-paper-fold-shadow")).toHaveCount(0);

  await setScrollTop(page, ".bubu-day-scroll", "bottom");
  await swipe(page, ".bubu-day-scroll", 0, -120, 6);
  await expect(title).toContainText("今日（周五）");
  await expect(page.locator(".bubu-gesture-feedback")).toHaveCount(0);
  await expect(page.locator(".bubu-paper-fold-back, .bubu-paper-fold-shadow")).toHaveCount(0);

  // Starting at the top and dragging inward must remain ordinary scroll.
  await setScrollTop(page, ".bubu-day-scroll", "top");
  await swipe(page, ".bubu-day-scroll", 0, -120, 6);
  await expect(title).toContainText("今日（周五）");
  await expect.poll(() => page.locator(".bubu-day-scroll").evaluate((element) => (element as HTMLElement).scrollTop)).toBeGreaterThan(0);

  // A fling from the middle that merely reaches the top is not a page turn.
  await setScrollTop(page, ".bubu-day-scroll", 100);
  await swipe(page, ".bubu-day-scroll", 0, 180, 6);
  await expect(title).toContainText("今日（周五）");

  await calendarView(page, "周历");
  await expect(page.locator(".bubu-week-scroll")).toBeVisible();
  await expect(title).toContainText("本周（10/19–）");
  await setScrollTop(page, ".bubu-week-scroll", "top");
  await swipe(page, ".bubu-week-scroll", 0, 120, 6);
  await expect(title).toContainText("本周（10/19–）");
  await expect(page.locator(".bubu-gesture-feedback")).toHaveCount(0);
  await expect(page.locator(".bubu-paper-fold-back, .bubu-paper-fold-shadow")).toHaveCount(0);

  await setScrollTop(page, ".bubu-week-scroll", "bottom");
  await swipe(page, ".bubu-week-scroll", 0, -120, 6);
  await expect(title).toContainText("本周（10/19–）");
  await expect(page.locator(".bubu-gesture-feedback")).toHaveCount(0);
  await expect(page.locator(".bubu-paper-fold-back, .bubu-paper-fold-shadow")).toHaveCount(0);
});

test("two-finger vertical pinch zooms in and out on day and week without browser zoom", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  await expect(title).toContainText("今日（周五）");
  await setScrollTop(page, ".bubu-day-scroll", 500);

  const box = await scrollBox(page, ".bubu-day-scroll");
  const midY = box.y + box.height / 2;
  const before = await readDayGeometry(page, midY);
  await pinch(page, ".bubu-day-scroll", 60, 240, 8);
  await expect.poll(async () => (await readDayGeometry(page, midY)).canvasHeight).toBeGreaterThan(before.canvasHeight * 2.5);

  const expanded = await readDayGeometry(page, midY);
  expect(expanded.canvasHeight).toBeGreaterThan(before.canvasHeight * 2.5);
  expect(expanded.canvasHeight).toBeLessThanOrEqual(before.canvasHeight * 3.1);
  expect(expanded.visualScale).toBe(1);
  expect(expanded.viewportWidth).toBe(before.viewportWidth);
  expect(Math.abs(expanded.fraction - before.fraction)).toBeLessThanOrEqual(0.005);
  expect(expanded.scrollTop).not.toBe(before.scrollTop);
  expect(expanded.scrollTop).toBeGreaterThanOrEqual(0);
  expect(expanded.scrollTop).toBeLessThanOrEqual(expanded.maxScroll + 1);
  await expect(page.locator(".bubu-detail-sheet")).toHaveCount(0);
  await expect(title).toContainText("今日（周五）");

  // Pinching back in must shrink the shared canvas and keep the same anchor.
  await pinch(page, ".bubu-day-scroll", 240, 80, 8);
  await expect.poll(async () => (await readDayGeometry(page, midY)).canvasHeight).toBeLessThan(expanded.canvasHeight * 0.6);
  const shrunk = await readDayGeometry(page, midY);
  expect(shrunk.canvasHeight).toBeLessThan(expanded.canvasHeight * 0.6);
  expect(shrunk.canvasHeight).toBeGreaterThan(before.canvasHeight * 0.8);
  expect(shrunk.visualScale).toBe(1);
  expect(Math.abs(shrunk.fraction - expanded.fraction)).toBeLessThanOrEqual(0.005);
  expect(shrunk.scrollTop).toBeGreaterThanOrEqual(0);
  expect(shrunk.scrollTop).toBeLessThanOrEqual(shrunk.maxScroll + 1);

  // A fresh ordinary one-finger scroll and tap work after zooming back out.
  const scrollBefore = shrunk.scrollTop;
  await swipe(page, ".bubu-day-scroll", 0, -120, 6);
  await expect.poll(async () => (await readDayGeometry(page, midY)).scrollTop).toBeGreaterThan(scrollBefore + 5);
  const scrolled = await readDayGeometry(page, midY);
  expect(scrolled.canvasHeight).toBeCloseTo(shrunk.canvasHeight, 0);
  expect(scrolled.visualScale).toBe(1);
  await page.waitForTimeout(750);
  const bottle = page.locator(".bubu-timeline-event").filter({ hasText: "120ml" }).first();
  await bottle.scrollIntoViewIfNeeded();
  const bottleBox = await bottle.boundingBox();
  await page.touchscreen.tap(bottleBox!.x + bottleBox!.width / 2, bottleBox!.y + bottleBox!.height / 2);
  await expect(page.locator(".bubu-detail-sheet")).toBeVisible();
  await expect(page.locator(".bubu-detail-type")).toContainText("瓶喂");
  await page.getByText("关闭", { exact: true }).last().click();

  // The parent-owned scale is reused by the week view, including zoom-out geometry.
  await calendarView(page, "周历");
  await expect(page.locator(".bubu-week-canvas")).toBeVisible();
  await setScrollTop(page, ".bubu-week-scroll", 300);
  const weekBox = await scrollBox(page, ".bubu-week-scroll");
  const weekMidY = weekBox.y + weekBox.height / 2;
  const weekBefore = await readWeekGeometry(page, weekMidY);
  await pinch(page, ".bubu-week-scroll", 100, 220, 8);
  await expect.poll(async () => (await readWeekGeometry(page, weekMidY)).canvasHeight).toBeGreaterThan(weekBefore.canvasHeight * 1.8);
  const weekExpanded = await readWeekGeometry(page, weekMidY);
  expect(weekExpanded.visualScale).toBe(1);
  expect(weekExpanded.viewportWidth).toBe(before.viewportWidth);
  expect(Math.abs(weekExpanded.fraction - weekBefore.fraction)).toBeLessThanOrEqual(0.005);
  expect(weekExpanded.scrollTop).toBeGreaterThanOrEqual(0);
  expect(weekExpanded.scrollTop).toBeLessThanOrEqual(weekExpanded.maxScroll + 1);

  await pinch(page, ".bubu-week-scroll", 220, 100, 8);
  await expect.poll(async () => (await readWeekGeometry(page, weekMidY)).canvasHeight).toBeLessThan(weekExpanded.canvasHeight * 0.7);
  const weekShrunk = await readWeekGeometry(page, weekMidY);
  expect(weekShrunk.canvasHeight).toBeLessThan(weekExpanded.canvasHeight * 0.7);
  expect(weekShrunk.canvasHeight).toBeGreaterThan(weekBefore.canvasHeight * 0.8);
  expect(weekShrunk.visualScale).toBe(1);
  expect(Math.abs(weekShrunk.fraction - weekExpanded.fraction)).toBeLessThanOrEqual(0.005);
  expect(weekShrunk.scrollTop).toBeGreaterThanOrEqual(0);
  expect(weekShrunk.scrollTop).toBeLessThanOrEqual(weekShrunk.maxScroll + 1);

  const weekScrollBefore = weekShrunk.scrollTop;
  await swipe(page, ".bubu-week-scroll", 0, -100, 6);
  await expect.poll(async () => (await readWeekGeometry(page, weekMidY)).scrollTop).toBeGreaterThan(weekScrollBefore + 5);
  expect((await readWeekGeometry(page, weekMidY)).canvasHeight).toBeCloseTo(weekShrunk.canvasHeight, 0);
  await page.waitForTimeout(750);
  const weekBottle = page.locator(".bubu-week-event").filter({ hasText: "120ml" }).first();
  await weekBottle.scrollIntoViewIfNeeded();
  const weekBottleBox = await weekBottle.boundingBox();
  await page.touchscreen.tap(weekBottleBox!.x + weekBottleBox!.width / 2, weekBottleBox!.y + weekBottleBox!.height / 2);
  await expect(page.locator(".bubu-detail-sheet")).toBeVisible();
  await expect(page.locator(".bubu-detail-type")).toContainText("瓶喂");
  await page.getByText("关闭", { exact: true }).last().click();

  await calendarView(page, "日历");
  await expect(page.locator(".bubu-day-canvas")).toBeVisible();
  const dayAgain = await page.locator(".bubu-day-canvas").evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(dayAgain - shrunk.canvasHeight)).toBeLessThan(5);
});

test("320px week labels keep the measurement on one readable line", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fixture(page, {
    recordsOverride: [...records, activity("week-outdoor", "OUTDOOR", "2026-10-23T10:00:00+08:00", { endTime: "2026-10-23T11:00:00+08:00" })],
  });
  await page.goto("/");
  await calendarView(page, "周历");
  await expect(page.locator(".bubu-week-card")).toBeVisible();
  const weekSleep = page.locator(".bubu-week-event-bg").filter({ hasText: "7h" });
  const weekOutdoor = page.locator('.bubu-week-event-bg[aria-label^="户外晒太阳"]');
  await expect(weekSleep).toHaveCSS("background-color", "rgb(240, 235, 246)");
  await expect(weekSleep).toHaveCSS("border-left-color", "rgb(180, 160, 202)");
  await expect(weekSleep).toHaveCSS("color", "rgb(111, 86, 136)");
  await expect(weekOutdoor).toHaveCSS("background-color", "rgb(234, 243, 232)");
  await expect(weekOutdoor).toHaveCSS("border-left-color", "rgb(150, 181, 142)");
  await expect(weekOutdoor).toHaveCSS("color", "rgb(63, 107, 79)");

  const allTexts = (await page.locator(".bubu-week-event-label").allTextContents()).map((text) => text.trim());
  expect(allTexts).toContain("120ml");
  expect(allTexts).toContain("7h");
  expect(allTexts).toContain("10m");
  expect(allTexts.filter((text) => /^(瓶喂|睡眠|抬头|亲喂|换尿布)/.test(text))).toEqual([]);
  const foreground = await page.locator(".bubu-week-event:not(.bubu-week-event-bg) .bubu-week-event-label").evaluateAll((elements) => elements.map((element) => {
    const label = element as HTMLElement;
    const block = label.parentElement as HTMLElement;
    const style = getComputedStyle(label);
    return {
      text: (label.textContent || "").trim(),
      blockHeight: block.getBoundingClientRect().height,
      labelHeight: label.getBoundingClientRect().height,
      lineHeight: parseFloat(style.lineHeight),
      fits: label.scrollWidth <= label.clientWidth + 1,
    };
  }));
  for (const label of foreground) {
    expect(label.fits).toBe(true);
    expect(label.blockHeight).toBeGreaterThanOrEqual(14);
    expect(label.labelHeight).toBeLessThanOrEqual(Math.max(14, label.lineHeight * 1.4));
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.locator(".bubu-week-event").filter({ hasText: "120ml" })).toHaveAttribute("aria-label", /瓶喂 120ml/);
  await page.screenshot({ path: "test-results/diary-week-320.png", fullPage: true });

  const bottle = page.locator(".bubu-week-event").filter({ hasText: "120ml" }).first();
  await bottle.scrollIntoViewIfNeeded();
  const bottleBox = await bottle.boundingBox();
  await page.touchscreen.tap(bottleBox!.x + bottleBox!.width / 2, bottleBox!.y + bottleBox!.height / 2);
  await expect(page.locator(".bubu-detail-sheet")).toBeVisible();
  await expect(page.getByText("测试记录：喝得很慢", { exact: true }).last()).toBeVisible();
});

test("a 401 during a multi-page scan clears the private view and stops further pages", async ({ page }) => {
  const scan = Array.from({ length: 200 }, (_, index) => provenanceAudit(`scan-${index}`, { resourceId: `other-${index}` }));
  const control = await fixture(page, {
    audit: { pages: [{ data: scan, hasMore: true }], statusForCall: [undefined, 401] },
  });
  await page.goto("/");
  await menu(page, "历史记录");
  await page.locator(".record-row").filter({ hasText: "120" }).click();
  await page.getByLabel("展开更多信息", { exact: true }).click();
  await expect(page.locator('input[placeholder="请输入密码"]')).toBeVisible();
  await expect(page.locator(".bubu-detail-sheet")).toHaveCount(0);
  await expect.poll(() => control.auditRequests.length).toBe(2);
  await page.waitForTimeout(250);
  expect(control.auditRequests).toHaveLength(2);
});

test("320px dense week overlap keeps milk value and unit readable at default and zoomed-out scale", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fixture(page, { recordsOverride: denseWeekRecords });
  await page.goto("/");
  await calendarView(page, "周历");
  await expect(page.locator(".bubu-week-card")).toBeVisible();
  const friday = page.locator(".bubu-paper-current .bubu-week-column").nth(4);
  await expect(friday.locator(".bubu-week-event:not(.bubu-week-event-bg)")).toHaveCount(3);
  await expect(friday.locator(".bubu-week-event-bg")).toHaveCount(1);

  const readDense = () => friday.evaluate((column) => {
    const col = column as HTMLElement;
    const colRect = col.getBoundingClientRect();
    const blocks = Array.from(col.querySelectorAll<HTMLElement>(".bubu-week-event:not(.bubu-week-event-bg)"));
    return {
      columnLeft: colRect.left,
      columnRight: colRect.right,
      background: Array.from(col.querySelectorAll<HTMLElement>(".bubu-week-event-bg")).map((block) => {
        const rect = block.getBoundingClientRect();
        return { width: rect.width, columnWidth: colRect.width, aria: block.getAttribute("aria-label") || "" };
      }),
      blocks: blocks.map((block) => {
        const label = block.querySelector<HTMLElement>(".bubu-week-event-label")!;
        const value = label.querySelector<HTMLElement>(".bubu-week-event-value");
        const unit = label.querySelector<HTMLElement>(".bubu-week-event-unit");
        const valueStyle = value ? getComputedStyle(value) : null;
        const unitStyle = unit ? getComputedStyle(unit) : null;
        const blockRect = block.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        const style = getComputedStyle(label);
        return {
          aria: block.getAttribute("aria-label") || "",
          text: (label.textContent || "").trim(),
          value: (value?.textContent || "").trim(),
          unit: (unit?.textContent || "").trim(),
          blockLeft: blockRect.left,
          blockRight: blockRect.right,
          labelLeft: labelRect.left,
          labelRight: labelRect.right,
          blockHeight: blockRect.height,
          labelHeight: labelRect.height,
          fontSize: parseFloat(style.fontSize),
          lineHeight: parseFloat(style.lineHeight),
          labelFits: label.scrollWidth <= label.clientWidth + 1,
          valueFits: !value || value.scrollWidth <= value.clientWidth + 1,
          unitFits: !unit || unit.scrollWidth <= unit.clientWidth + 1,
          valueOverflow: valueStyle?.textOverflow ?? "",
          unitOverflow: unitStyle?.textOverflow ?? "",
        };
      }),
    };
  });

  function expectDenseReadable(geometry: Awaited<ReturnType<typeof readDense>>) {
    for (const block of geometry.blocks) {
      expect(block.blockLeft).toBeGreaterThanOrEqual(geometry.columnLeft - 0.5);
      expect(block.blockRight).toBeLessThanOrEqual(geometry.columnRight + 0.5);
      expect(block.labelLeft).toBeGreaterThanOrEqual(block.blockLeft - 0.5);
      expect(block.labelRight).toBeLessThanOrEqual(block.blockRight + 0.5);
      expect(block.fontSize).toBeGreaterThanOrEqual(8);
      expect(block.blockHeight).toBeGreaterThanOrEqual(block.labelHeight - 1);
    }
    for (const measurement of [
      { aria: "瓶喂 120ml", value: "120", unit: "ml" },
      { aria: "吸奶 80ml", value: "80", unit: "ml" },
    ]) {
      const block = geometry.blocks.find((item) => item.aria.includes(measurement.aria));
      expect(block).toBeTruthy();
      expect(block!.value).toBe(measurement.value);
      expect(block!.unit).toBe(measurement.unit);
      expect(block!.text).toBe(`${measurement.value}${measurement.unit}`);
      expect(block!.labelFits).toBe(true);
      expect(block!.valueFits).toBe(true);
      expect(block!.unitFits).toBe(true);
      expect(block!.valueOverflow).toBe("ellipsis");
      expect(block!.unitOverflow).toBe("ellipsis");
      expect(block!.labelHeight).toBeGreaterThan(block!.lineHeight * 1.5);
    }
  }

  const normal = await readDense();
  expectDenseReadable(normal);
  expect(normal.background).toHaveLength(1);
  expect(normal.background[0]!.width).toBeGreaterThanOrEqual(normal.background[0]!.columnWidth - 2);
  expect(normal.background[0]!.aria).toContain("睡眠");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  const weekBox = await scrollBox(page, ".bubu-week-scroll");
  const midY = weekBox.y + weekBox.height / 2;
  const weekBefore = await readWeekGeometry(page, midY);
  await pinch(page, ".bubu-week-scroll", 200, 100, 8);
  await expect.poll(async () => (await readWeekGeometry(page, midY)).canvasHeight).toBeLessThan(weekBefore.canvasHeight * 0.7);
  const zoomed = await readDense();
  expectDenseReadable(zoomed);
  expect(zoomed.background[0]!.width).toBeGreaterThanOrEqual(zoomed.background[0]!.columnWidth - 2);

  await page.waitForTimeout(750);
  const milk = friday.locator('.bubu-week-event[aria-label*="瓶喂 120ml"]');
  await milk.scrollIntoViewIfNeeded();
  const milkBox = await milk.boundingBox();
  await page.touchscreen.tap(milkBox!.x + milkBox!.width / 2, milkBox!.y + milkBox!.height / 2);
  await expect(page.locator(".bubu-detail-sheet")).toBeVisible();
  await expect(page.locator(".bubu-detail-type")).toContainText("瓶喂");
  await expect(page.locator(".bubu-detail-fields")).toContainText("120 ml");
});

test("320px extreme week density shows an ellipsis cue while keeping full quantity accessible", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fixture(page, { recordsOverride: overflowWeekRecords });
  await page.goto("/");
  await calendarView(page, "周历");
  const friday = page.locator(".bubu-paper-current .bubu-week-column").nth(4);
  await expect(friday.locator(".bubu-week-event:not(.bubu-week-event-bg)")).toHaveCount(4);
  const geometry = await friday.evaluate((column) => {
    const col = column as HTMLElement;
    const colRect = col.getBoundingClientRect();
    return {
      columnLeft: colRect.left,
      columnRight: colRect.right,
      blocks: Array.from(col.querySelectorAll<HTMLElement>(".bubu-week-event:not(.bubu-week-event-bg)")).map((block) => {
        const label = block.querySelector<HTMLElement>(".bubu-week-event-label")!;
        const value = label.querySelector<HTMLElement>(".bubu-week-event-value");
        const unit = label.querySelector<HTMLElement>(".bubu-week-event-unit");
        const blockRect = block.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        return {
          aria: block.getAttribute("aria-label") || "",
          text: (label.textContent || "").trim(),
          value: (value?.textContent || "").trim(),
          unit: (unit?.textContent || "").trim(),
          valueFits: !value || value.scrollWidth <= value.clientWidth + 1,
          unitFits: !unit || unit.scrollWidth <= unit.clientWidth + 1,
          valueOverflow: value ? getComputedStyle(value).textOverflow : "",
          unitOverflow: unit ? getComputedStyle(unit).textOverflow : "",
          blockLeft: blockRect.left,
          blockRight: blockRect.right,
          labelLeft: labelRect.left,
          labelRight: labelRect.right,
        };
      }),
    };
  });
  const measurements = geometry.blocks.filter((block) => block.value);
  expect(measurements.length).toBeGreaterThanOrEqual(3);
  for (const block of measurements) {
    expect(block.text).toBe(`${block.value}${block.unit}`);
    expect(block.aria).toContain(block.text);
    expect(block.valueOverflow).toBe("ellipsis");
    expect(block.unitOverflow).toBe("ellipsis");
    expect(block.labelLeft).toBeGreaterThanOrEqual(block.blockLeft - 0.5);
    expect(block.labelRight).toBeLessThanOrEqual(block.blockRight + 0.5);
    expect(block.blockLeft).toBeGreaterThanOrEqual(geometry.columnLeft - 0.5);
    expect(block.blockRight).toBeLessThanOrEqual(geometry.columnRight + 0.5);
  }
  expect(measurements.some((block) => !block.valueFits || !block.unitFits)).toBe(true);

  const milk = friday.locator('.bubu-week-event[aria-label*="瓶喂 120ml"]').first();
  await milk.scrollIntoViewIfNeeded();
  const milkBox = await milk.boundingBox();
  await page.touchscreen.tap(milkBox!.x + milkBox!.width / 2, milkBox!.y + milkBox!.height / 2);
  await expect(page.locator(".bubu-detail-sheet")).toBeVisible();
  await expect(page.locator(".bubu-detail-fields")).toContainText("120 ml");
});

test("relative titles and next-period limits refresh after Shanghai midnight without resetting the date", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  const title = page.locator(".date-title");
  const next = page.getByLabel("下一段日期", { exact: true });
  await expect(title).toContainText("今日（周五）");
  expect(await next.evaluate((element) => element.hasAttribute("disabled"))).toBe(true);

  await page.clock.setSystemTime(new Date("2026-10-23T23:59:58+08:00"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(title).toContainText("昨日（周五）", { timeout: 8_000 });
  expect(await next.evaluate((element) => element.hasAttribute("disabled"))).toBe(false);

  await next.click();
  await expect(title).toContainText("今日（周六）");
});

test("month view is a natural calendar month and steps without entering the future", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await calendarView(page, "月历");
  await expect(page.locator(".date-title")).toContainText("本月（10月）");
  await expect(page.locator(".bubu-heatmap-card .bubu-viz-footnote")).toContainText("满环仅作参考，实际数值仍完整显示");
  await expect(page.getByText("近四周", { exact: true })).toHaveCount(0);
  await expect(page.locator(".bubu-heatmap-week")).toHaveCount(5);
  await expect(page.locator(".bubu-heatmap-padding")).toHaveCount(4);
  const next = page.getByLabel("下一段日期", { exact: true });
  expect(await next.evaluate((element) => element.hasAttribute("disabled"))).toBe(true);
  await page.getByLabel("上一段日期", { exact: true }).click();
  await expect(page.locator(".date-title")).toContainText("上月（9月）");
  await expect(page.locator(".bubu-heatmap-week")).toHaveCount(5);
  expect(await next.evaluate((element) => element.hasAttribute("disabled"))).toBe(false);
  await next.click();
  await expect(page.locator(".date-title")).toContainText("本月（10月）");
  expect(await next.evaluate((element) => element.hasAttribute("disabled"))).toBe(true);
});

test("month care rings fit a 320px natural month and read all four metrics", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fixture(page, { recordsOverride: ringRecords });
  await page.goto("/");
  await calendarView(page, "月历");
  const card = page.locator(".bubu-heatmap-card");
  await expect(card).toBeVisible();
  await expect(page.locator(".bubu-heatmap-cell")).toHaveCount(35);
  await expect(page.locator(".bubu-heatmap-padding")).toHaveCount(4);
  expect(await page.locator(".bubu-heatmap-cell").first().evaluate((element) => element.getBoundingClientRect().height)).toBe(56);
  await expect(page.locator(".bubu-heatmap-cell .activity-rings")).toHaveCount(23);
  await expect(page.locator(".bubu-heatmap-cell .activity-rings__ring")).toHaveCount(92);
  const guide = card.locator(".bubu-heatmap-guide");
  await expect(guide).toContainText("由外到内：");
  const compactLegend = guide.locator(".bubu-legend-compact");
  await expect(compactLegend).toHaveCount(4);
  await expect(card.locator(".bubu-legend-expanded")).toHaveCount(0);
  const legendExpectations = [
    { label: "睡", meaning: "睡眠时长", color: "rgb(111, 86, 136)" },
    { label: "玩", meaning: "户外时长", color: "rgb(63, 107, 79)" },
    { label: "吃", meaning: "瓶喂奶量+亲喂估计/记录量", color: "rgb(163, 79, 112)" },
    { label: "便", meaning: "尿布数量", color: "rgb(128, 107, 23)" },
  ] as const;
  for (const [index, expected] of legendExpectations.entries()) {
    const compactItem = compactLegend.nth(index);
    const compactDot = compactItem.locator(".bubu-legend-dot");
    await expect(compactItem).toHaveText(expected.label);
    await expect(compactDot).toHaveCSS("border-top-color", expected.color);
    await expect(compactDot).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  const legendIcon = card.locator(".bubu-heatmap-legend-toggle .bubu-heatmap-legend-icon");
  const legendImage = legendIcon.locator("img");
  await expect(legendIcon).toBeVisible();
  await expect.poll(async () => legendImage.evaluate(
    (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
  )).toBe(true);
  const iconBox = await legendIcon.boundingBox();
  const imageBox = await legendImage.boundingBox();
  expect(iconBox).not.toBeNull();
  expect(imageBox).not.toBeNull();
  expect(imageBox!.x).toBeGreaterThanOrEqual(iconBox!.x - 1);
  expect(imageBox!.x + imageBox!.width).toBeLessThanOrEqual(iconBox!.x + iconBox!.width + 1);
  expect(imageBox!.y).toBeGreaterThanOrEqual(iconBox!.y - 1);
  expect(imageBox!.y + imageBox!.height).toBeLessThanOrEqual(iconBox!.y + iconBox!.height + 1);

  await card.getByLabel("展开四环图例", { exact: true }).click();
  const expandedLegend = card.locator(".bubu-legend-expanded");
  await expect(expandedLegend).toHaveCount(4);
  for (const [index, expected] of legendExpectations.entries()) {
    const expandedItem = expandedLegend.nth(index);
    const expandedDot = expandedItem.locator(".bubu-legend-dot");
    await expect(expandedItem).toContainText(expected.label);
    await expect(expandedItem).toContainText(expected.meaning);
    await expect(expandedDot).toHaveCSS("border-top-color", expected.color);
    await expect(expandedDot).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await card.getByLabel("收起四环图例", { exact: true }).click();
  await expect(expandedLegend).toHaveCount(0);

  const todayRings = page.locator(".bubu-heatmap-today .activity-rings");
  const ariaLabel = await todayRings.getAttribute("aria-label");
  expect(ariaLabel).toMatch(
    /^2026-10-23 睡（睡眠时长）.*玩（户外时长）.*吃（瓶喂奶量\+亲喂估计\/记录量）.*便（尿布数量）/,
  );
  expect(await todayRings.locator(".activity-rings__ring").evaluateAll(
    (nodes) => nodes.map((node) => node.clientWidth),
  )).toEqual([36, 28, 20, 12]);
  expect(await todayRings.locator(".activity-rings__track").evaluateAll(
    (nodes) => nodes.map((node) => getComputedStyle(node).borderTopColor),
  )).toEqual([
    "rgb(111, 86, 136)",
    "rgb(63, 107, 79)",
    "rgb(163, 79, 112)",
    "rgb(128, 107, 23)",
  ]);
  const ringSizes = await page.locator(".bubu-heatmap-cell .activity-rings").evaluateAll(
    (nodes) => nodes.map((node) => ({ width: node.clientWidth, height: node.clientHeight })),
  );
  expect(ringSizes).toHaveLength(23);
  for (const size of ringSizes) expect(size.width).toBe(size.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  await page.locator(".bubu-heatmap-today").click();
  const reading = page.locator(".bubu-heatmap-reading");
  await expect(reading).toContainText("瓶喂 420 ml");
  await expect(reading).toContainText("亲喂估算 100–200 ml");
  await expect(reading).toContainText("约 520–620 ml");
  await expect(reading).toContainText("7小时30分钟");
  await expect(reading).toContainText("3小时20分钟");
  await expect(reading).toContainText("4 次");
  await expect(reading).toContainText("年龄参考 800–1000 ml/日");
  await expect(reading).toContainText("家庭目标：1小时合格、2小时良好、3小时优秀");
  await expect(reading).toContainText("达到 180 分钟");

  const detailCards = reading.locator(".bubu-heatmap-metric");
  const detailExpectations = [
    { label: "睡", value: "7小时30分钟", color: "rgb(111, 86, 136)" },
    { label: "玩", value: "3小时20分钟", color: "rgb(63, 107, 79)" },
    { label: "吃", value: "约 520–620 ml", color: "rgb(163, 79, 112)" },
    { label: "便", value: "4 次", color: "rgb(128, 107, 23)" },
  ] as const;
  for (const [index, expected] of detailExpectations.entries()) {
    const detail = detailCards.nth(index);
    await expect(detail.locator(".bubu-heatmap-metric-label")).toHaveText(expected.label);
    await expect(detail.locator(".bubu-heatmap-value")).toContainText(expected.value);
    await expect(detail.locator(".bubu-heatmap-metric-label")).toHaveCSS("color", expected.color);
  }
});

test("a non-unauthorized baby profile failure keeps the month with reference unavailable", async ({ page }) => {
  await fixture(page, { babyProfileStatus: 503 });
  await page.goto("/");
  await calendarView(page, "月历");
  await expect(page.locator(".bubu-heatmap-card")).toBeVisible();
  await expect(page.locator(".bubu-heatmap-notice").first()).toContainText("宝宝资料读取失败，年龄参考不可用");
  await expect(page.locator(".bubu-heatmap-cell .activity-rings")).toHaveCount(23);
});

test("a baby profile 401 expires the private month view", async ({ page }) => {
  await fixture(page, { babyProfileStatus: 401 });
  await page.goto("/");
  await calendarView(page, "月历");
  await expect(page.getByText("登录已过期，请重新登录")).toBeVisible();
  await expect(page.locator('input[placeholder="请输入密码"]')).toBeVisible();
  await expect(page.locator(".bubu-heatmap-card")).toHaveCount(0);
});

test("a baby profile 401 arriving after switching month to day still expires login", async ({ page }) => {
  const control = await fixture(page, { babyProfileStatus: 401, babyProfileGateFirst: true });
  await page.goto("/");
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  await calendarView(page, "月历");
  await expect.poll(() => control.requests.filter((request) => request.includes("/api/app/baby-profile")).length).toBe(1);
  await calendarView(page, "日历");
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  control.releaseBabyProfile();
  await expect(page.getByText("登录已过期，请重新登录")).toBeVisible();
  await expect(page.locator('input[placeholder="请输入密码"]')).toBeVisible();
  await expect(page.locator(".bubu-day-card")).toHaveCount(0);
});

test("month view opens an unfiltered day and returns to its origin month", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await calendarView(page, "月历");
  await expect(page.locator(".date-title")).toContainText("本月（10月）");
  await page.getByText("查看当天 ›", { exact: true }).click();
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  await expect(page.locator(".bubu-timeline-background, .bubu-timeline-position, .bubu-timeline-instant")).toHaveCount(4);
  await page.getByText("‹ 返回月历", { exact: true }).click();
  await expect(page.locator(".date-title")).toContainText("本月（10月）");
});

test("failed reads show retry instead of zero-valued statistics", async ({ page }) => {
  await fixture(page, { failActivities: true });
  await page.goto("/");
  await expect(page.getByText("重试", { exact: true })).toBeVisible();
  await expect(page.locator(".stats-grid")).toHaveCount(0);
});

test("switching date removes previous records and logout clears the private view", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect(page.locator(".stats-grid")).toContainText("120 ml");
  await page.getByText("‹", { exact: true }).click();
  await expect(page.locator(".stats-grid")).toContainText("0 ml");
  await expect(page.locator(".stats-grid")).not.toContainText("120 ml");
  await menu(page, "退出登录");
  await expect(page.locator('input[placeholder="请输入密码"]')).toBeVisible();
  await expect(page.locator(".stats-grid")).toHaveCount(0);
});

test("menu settings persist baby names and return to the same calendar date", async ({ page }) => {
  await fixture(page);
  await page.goto("/");
  await expect(page.locator(".bubu-day-card")).toBeVisible();
  await page.getByLabel("上一段日期", { exact: true }).click();
  await expect(page.locator(".date-title")).toContainText("昨日（周四）");
  await menu(page, "设置");
  await page.locator('input[placeholder="怎么称呼宝宝"]').fill("小米");
  await page.locator('input[placeholder="宝宝的大名"]').fill("测试姓名");
  await page.getByText("保存", { exact: true }).click();
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.getByText("‹ 返回", { exact: true }).click();
  await expect(page.locator(".date-title")).toContainText("昨日（周四）");
  await page.getByLabel("打开菜单", { exact: true }).click();
  await expect(page.locator(".diary-baby-name")).toHaveText("小米");
  await page.screenshot({ path: "test-results/diary-menu.png", fullPage: true });
  await page.locator(".diary-menu-link").filter({ has: page.getByText("设置", { exact: true }) }).click();
  await expect(page.locator('input[placeholder="怎么称呼宝宝"]')).toHaveValue("小米");
  await expect(page.locator('input[placeholder="宝宝的大名"]')).toHaveValue("测试姓名");
  await page.screenshot({ path: "test-results/diary-settings.png", fullPage: true });
});

test("rejected name updates retain the draft and never report success", async ({ page }) => {
  await fixture(page, { failProfile: true });
  await page.goto("/");
  await menu(page, "设置");
  await page.locator('input[placeholder="怎么称呼宝宝"]').fill("重名宝宝");
  await page.getByText("保存", { exact: true }).click();
  await expect(page.getByText("已存在同名宝宝", { exact: true })).toBeVisible();
  await expect(page.getByText("已保存", { exact: true })).toHaveCount(0);
  await expect(page.locator('input[placeholder="怎么称呼宝宝"]')).toHaveValue("重名宝宝");
});

for (const width of [320, 360, 375]) {
  test(`date navigation and avatar fit a ${width}px phone with capsule space`, async ({ page }) => {
    await page.setViewportSize({ width, height: 568 });
    await fixture(page);
    await page.goto("/");
    await expect(page.locator(".stats-grid")).toContainText("120 ml");
    const avatar = await page.locator(".diary-avatar-button").boundingBox();
    const center = await page.locator(".diary-header-center").boundingBox();
    expect(avatar!.x + avatar!.width).toBeLessThanOrEqual(center!.x);
    expect(center!.x + center!.width).toBeLessThanOrEqual(width - 88);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await page.locator(".date-title").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByLabel("上一段日期", { exact: true }).click();
    await expect(page.locator(".date-title")).toContainText("昨日（周四）");
    await calendarView(page, "周历");
    await expect(page.locator(".bubu-week-card")).toBeVisible();
    await expect(page.locator(".date-title")).toContainText("本周（10/19–）");
    expect(await page.locator(".date-title").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.locator(".date-title").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
    await page.locator(".bubu-week-day").nth(3).click();
    await expect(page.locator(".bubu-day-card")).toBeVisible();
    await expect(page.locator(".date-title")).toContainText("昨日（周四）");
    await page.getByText("‹ 返回周历", { exact: true }).click();
    await expect(page.locator(".date-title")).toContainText("本周（10/19–）");
    await calendarView(page, "日历");
    await expect(page.locator(".date-title")).toContainText("昨日（周四）");
    await menu(page, "历史记录");
    await expect(page.locator(".date-title")).toContainText("昨日（周四）");
    await menu(page, "日历");
    await expect(page.locator(".date-title")).toContainText("昨日（周四）");
    await page.getByLabel("展开日期与日历视图", { exact: true }).click();
    await expect(page.locator(".calendar-view-popover")).toBeVisible();
    const popup = await page.locator(".calendar-view-popover").boundingBox();
    expect(popup!.x).toBeGreaterThanOrEqual(0);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(width);
    await page.getByText("回到今天", { exact: true }).click();
    await expect(page.locator(".date-title")).toContainText("今日（周五）");
    await expect(page.locator(".calendar-view-popover")).toHaveCount(0);
    await page.getByLabel("打开菜单", { exact: true }).click();
    await expect(page.locator(".diary-header-avatar img")).toHaveAttribute("src", /bubu-avatar-borderless/);
    await expect(page.locator(".diary-drawer")).toBeVisible();
    await expect(page.locator(".diary-drawer-brand")).toHaveText("卜卜日记——科学育娃");
    expect(await page.locator(".diary-drawer-brand").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(page.getByLabel("关闭菜单", { exact: true })).toBeVisible();
    await expect(page.getByText("一天的节奏", { exact: true })).toHaveCount(0);
    await page.getByLabel("关闭菜单", { exact: true }).click();
    await expect(page.locator(".diary-drawer")).toHaveCount(0);
  });
}

test.describe("calendar dates on a phone outside China", () => {
  test.use({ timezoneId: "Australia/Sydney" });
  test("thirty-day trends cross the device daylight-saving boundary", async ({ page }) => {
    await fixture(page);
    await page.goto("/");
    await expect(page.locator(".date-title")).toContainText("今日（周五）");
    await page.getByLabel("上一段日期", { exact: true }).click();
    await expect(page.locator(".date-title")).toContainText("昨日（周四）");
    await page.getByLabel("下一段日期", { exact: true }).click();
    await expect(page.locator(".date-title")).toContainText("今日（周五）");
    await menu(page, "趋势");
    await expect(page.locator(".bubu-chart-point")).toHaveCount(28);
    await page.getByText("30 天", { exact: true }).click();
    await expect(page.locator(".bubu-chart-point")).toHaveCount(120);
    await expect(page.locator(".date-title")).toContainText("9/24–10/23");
  });
});
