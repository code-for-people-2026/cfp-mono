import { expect, test } from "@playwright/test";
import { emptyRecordSummary, recordEventFixture } from "../fixtures/records";

test.skip(process.env.BUBU_AUTH_MODE === "legacy", "Requires the sidecar H5 build");
test("sidecar cards use server facts and expose unknown, ongoing and duplicate coverage", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-23T13:00:00+08:00") });
  const baby = { id: "synthetic-baby", name: "小满" };
  const summary = emptyRecordSummary();
  Object.assign(summary.metrics, { diaperCount: 2, peeCount: 2, poopCount: 1, totalMilkAmount: 0 });
  Object.assign(summary.byType.DIAPER!, { events: 2 });
  Object.assign(summary.byType.BOTTLE!, { events: 1, knownMilkAmounts: 1 });
  Object.assign(summary.byType.ROLL_OVER!, { events: 1, knownCount: 0 });
  Object.assign(summary.byType.SLEEP!, { events: 1, ongoingEvents: 1 });
  Object.assign(summary.byType.PUMP!, { events: 1, unknownMilkAmounts: 1 });
  Object.assign(summary.coverage, { recordedEvents: 6, incompleteEvents: 1, unknownFields: 1, ongoingEvents: 1, duplicateCandidates: 1, pendingCandidates: 1 });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/app/auth/context") return route.fulfill({ json: { authenticated: true, hasBaby: true, baby, babies: [baby], defaultBabyId: baby.id, identityId: "test", legacyLinked: true } });
    expect(url.searchParams.get("babyId")).toBe(baby.id);
    if (url.pathname === "/api/app/records/snapshot") return route.fulfill({ json: { activities: [], events: [], questions: [], summary } });
    if (url.pathname === "/api/app/records/pending") return route.fulfill({ json: [] });
    if (url.pathname === "/api/app/chat") return route.fulfill({ json: { babyId: url.searchParams.get("babyId"), conversationId: "synthetic-conversation", turns: [], pending: [], pendingCount: 0 } });
    if (url.pathname === "/api/app/records/sync") return route.fulfill({ json: [] });
    if (url.pathname === "/api/app/activities/latest") return route.fulfill({ json: null });
    if (url.pathname === "/api/app/activities") return route.fulfill({ json: [] });
    if (url.pathname === "/api/app/daily-stats") return route.fulfill({ json: [{ id: "day", babyId: baby.id, date: "2026-10-23", ...summary.metrics, coverage: summary.coverage, byType: summary.byType }] });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/");
  const card = (label: string) => page.locator(".stat-card").filter({ has: page.getByText(label, { exact: true }) });
  await expect(card("尿布")).toContainText("2 次");
  await expect(card("瓶")).toContainText("0 ml");
  await expect(card("翻")).toContainText("0 次");
  await expect(card("吸")).toContainText("待补全");
  await expect(card("睡")).toContainText("进行中");
  await expect(page.locator(".daily-summary .data-note")).toContainText("尿布 2 次");
  await expect(page.getByText(/疑似重复待核对，暂不重复计入/)).toBeVisible();
  await expect(page.getByText(/明确有尿 2 次/)).toBeVisible();
  await page.locator(".daily-summary").screenshot({ path: "test-results/records-sidecar-summary.png" });
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-drawer taro-button-core").filter({ has: page.getByText("趋势", { exact: true }) }).click();
  await expect(page.locator(".bubu-chart-point")).toHaveCount(2); // Known-zero bottle and actual diapers; unknown pump/sleep remain gaps.
  await expect(page.getByText("这段时间暂无可确定数值", { exact: true })).toBeVisible();
});

test("sidecar details show private attachments and source context while sync failures retain saved facts", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-23T13:00:00+08:00") });
  const baby = { id: "synthetic-baby", name: "小满" };
  const breastfeed = { id: "breastfeed-record", babyId: baby.id, type: "BREASTFEED", startTime: "2026-10-22T09:10:00+08:00" };
  const diaper = {
    id: "diaper-record", babyId: baby.id, type: "DIAPER", startTime: "2026-10-22T09:40:00+08:00",
    hasPoop: true, poopColor: "YELLOW" as const,
    poopPhotoUrl: `/api/app/media/activities/${encodeURIComponent("diaper-record")}?babyId=${encodeURIComponent(baby.id)}`,
  };
  const bottle = { id: "legacy-record", babyId: baby.id, type: "BOTTLE", startTime: "2026-10-22T10:00:00+08:00", endTime: "2026-10-22T10:15:00+08:00", milkAmount: 0, milkSource: "BREAST_MILK" };
  const activities = [breastfeed, diaper, bottle];
  const attachmentIds = [`att_${"a".repeat(64)}`, `att_${"b".repeat(64)}`];
  const breastfeedEvent = { ...recordEventFixture({ id: "breastfeed-event", legacyId: breastfeed.id, babyId: baby.id, states: { reportedIntake: "known" } }),
    facts: { ...breastfeed, reportedIntake: { value: 80, unit: "g", originalText: " 亲喂吃了 80 克 " } }, currentActivity: breastfeed };
  const diaperEvent = { ...recordEventFixture({ id: "diaper-event", legacyId: diaper.id, babyId: baby.id }), facts: diaper, currentActivity: diaper };
  const bottleEvent = { ...recordEventFixture({ id: "care-event", legacyId: bottle.id, babyId: baby.id, version: 3, complete: false, states: { burpSuccess: "pending" }, missing: ["burpSuccess"], attachmentIds }),
    facts: bottle, currentActivity: bottle, sources: [{ kind: "wechat", sentAt: "2026-10-22T10:20:00+08:00", accountId: "private-account", senderId: "private-sender", conversationId: "private-group" }] };
  const events = [breastfeedEvent, diaperEvent, bottleEvent];
  const summary = emptyRecordSummary();
  Object.assign(summary.metrics, { breastfeedCount: 1, diaperCount: 1, bottleCount: 1 });
  Object.assign(summary.byType.BREASTFEED!, { events: 1 }); Object.assign(summary.byType.DIAPER!, { events: 1 });
  Object.assign(summary.byType.BOTTLE!, { events: 1, knownMilkAmounts: 1 });
  Object.assign(summary.coverage, { recordedEvents: 3, incompleteEvents: 1, pendingFields: 1 });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jIYQAAAAASUVORK5CYII=", "base64");
  const requestedImages: string[] = [];
  let syncUnavailable = false;
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/app/auth/context") return route.fulfill({ json: { authenticated: true, hasBaby: true, baby, babies: [baby], defaultBabyId: baby.id, identityId: "test", legacyLinked: true } });
    expect(url.searchParams.get("babyId")).toBe(baby.id);
    if (url.pathname === "/api/app/records/snapshot") {
      if (url.searchParams.has("eventId")) {
        const eventId = url.searchParams.get("eventId");
        expect(url.searchParams.has("date")).toBe(false);
        const selectedActivity = activities.find(item => item.id === eventId);
        const selectedEvent = events.find(item => item.legacyId === eventId);
        expect(selectedActivity).toBeTruthy();
        expect(selectedEvent).toBeTruthy();
        return route.fulfill({ json: { activities: [selectedActivity], events: [selectedEvent], questions: [], summary } });
      }
      return route.fulfill({ json: { activities, events, questions: [], summary } });
    }
    if (url.pathname === "/api/app/activities/latest") return route.fulfill({ json: null });
    if (/^\/api\/app\/activities\/[^/]+$/.test(url.pathname)) {
      const selected = activities.find(item => item.id === decodeURIComponent(url.pathname.split("/").pop()!));
      return selected ? route.fulfill({ json: selected }) : route.fulfill({ status: 404, json: {} });
    }
    if (url.pathname === "/api/app/activities") return route.fulfill({ json: [] });
    if (url.pathname === "/api/app/records/pending") return route.fulfill({ json: [] });
    if (url.pathname === "/api/app/chat") return route.fulfill({ json: { babyId: url.searchParams.get("babyId"), conversationId: "synthetic-conversation", turns: [], pending: [], pendingCount: 0 } });
    if (url.pathname === "/api/app/records/sync") return syncUnavailable ? route.fulfill({ status: 503, json: { error: "temporarily unavailable" } }) : route.fulfill({ json: [{ id: "job", enabled: true, lastSuccessAt: "2026-10-23T12:00:00+08:00", processedThrough: "2026-10-23T11:50:00+08:00", pending: true, pendingMedia: 2, failure: { code: "PRIVATE_INTERNAL_ERROR", at: "2026-10-23T12:05:00+08:00", attempts: 1 } }] });
    if (url.pathname === "/api/app/media/activities/diaper-record") {
      requestedImages.push(url.pathname);
      return route.fulfill({ contentType: "image/png", body: png });
    }
    if (url.pathname.startsWith("/api/app/attachments/")) {
      expect(attachmentIds).toContain(url.pathname.split("/").pop());
      requestedImages.push(url.pathname);
      return route.fulfill({ contentType: "image/png", body: png });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto("/");
  await expect(page.locator(".sync-status")).toContainText("最近同步成功");
  await expect(page.locator(".sync-status")).toContainText("2 项媒体待补取");
  await expect(page.locator(".sync-status")).toContainText("当前显示已保存记录");
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-drawer taro-button-core").filter({ has: page.getByText("历史记录", { exact: true }) }).click();
  await expect(page.locator(".record-row")).toHaveCount(3);
  await page.locator(".record-row").filter({ hasText: "亲喂" }).click();
  let detail = page.locator(".bubu-detail-sheet");
  await expect(detail).toContainText("80 克（明确报告）");
  await expect(detail).toContainText("报告原话");
  await expect(detail).toContainText(" 亲喂吃了 80 克 ");
  await expect(detail).not.toContainText("80 ml");
  await detail.locator(".bubu-detail-close").click();
  await expect(detail).toHaveCount(0);
  await page.locator(".record-row").filter({ hasText: "大便" }).click();
  detail = page.locator(".bubu-detail-sheet");
  await expect(detail).toContainText("黄色");
  await expect(detail.locator(".bubu-detail-photo")).toHaveCount(1);
  await expect.poll(() => requestedImages).toEqual(["/api/app/media/activities/diaper-record"]);
  await expect(detail.locator(".bubu-detail-photo img")).toBeVisible();
  await detail.locator(".bubu-detail-close").click();
  await expect(detail).toHaveCount(0);
  await page.locator(".record-row").filter({ hasText: "瓶喂" }).click();
  await expect(detail).toContainText("第 3 版");
  await expect(detail).toContainText("微信群记录");
  await expect(detail).toContainText("拍嗝结果");
  await expect(detail).toContainText("0 ml");
  await expect(page.locator(".bubu-detail-photo")).toHaveCount(2);
  await expect.poll(() => requestedImages.length).toBe(3);
  await expect.poll(() => page.locator(".bubu-detail-photo img").evaluateAll(images => images.length === 2 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.locator("body")).not.toContainText("private-account");
  await expect(page.locator("body")).not.toContainText("PRIVATE_INTERNAL_ERROR");
  await detail.screenshot({ path: "test-results/records-sidecar-detail.png" });
  await page.locator(".bubu-detail-photo-section").scrollIntoViewIfNeeded();
  await page.locator(".bubu-detail-photo-section").screenshot({ path: "test-results/records-sidecar-attachments.png" });
  await page.locator(".bubu-detail-close").click();
  await expect(page.locator(".bubu-detail-sheet")).toHaveCount(0);
  syncUnavailable = true;
  await page.getByLabel("打开菜单", { exact: true }).click();
  await page.locator(".diary-drawer taro-button-core").filter({ has: page.getByText("刷新数据", { exact: true }) }).click();
  await expect(page.locator(".sync-status")).toContainText("同步状态暂时不可用");
  await expect(page.locator(".record-row")).toHaveCount(3);
});
