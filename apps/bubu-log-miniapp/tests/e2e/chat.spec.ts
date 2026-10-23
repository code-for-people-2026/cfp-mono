import { expect, test, type Page } from "@playwright/test";
import { emptyRecordSummary } from "../fixtures/records";
test.skip(process.env.BUBU_AUTH_MODE === "legacy", "Chat requires sidecar mode");
const baby = { id: "chat-baby", name: "小满" };
async function fixture(page: Page, loseResponse = false) {
  const turns: Array<Record<string, unknown>> = [];
  const submissions: Array<Record<string, unknown>> = [];
  let revoked = false;
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (url.pathname === "/api/app/auth/context") return json({ authenticated: true, identityId: "chat-parent", legacyLinked: false, hasBaby: !revoked, baby: revoked ? null : baby, babies: revoked ? [] : [baby] });
    if (revoked) return json({ error: "照护权限已撤销", code: "BABY_FORBIDDEN" }, 403);
    if (url.pathname === "/api/app/chat/request") return json({ turn: turns.find(turn => turn.requestId === url.searchParams.get("requestId")) ?? null });
    if (url.pathname === "/api/app/chat" && request.method() === "POST") {
      const input = request.postDataJSON() as Record<string, unknown>; submissions.push(input);
      const turn = { id: `turn-${submissions.length}`, requestId: input.requestId, babyId: baby.id, conversationId: "conversation", createdAt: "2026-10-23T08:00:00Z", updatedAt: "2026-10-23T08:00:00Z", status: "completed", input, assistantText: "已有内容保存好了，奶量不清楚会保留未知。", receipts: [{ status: "needs_information" }], pending: [], refreshRequired: true };
      turns.push(turn);
      if (loseResponse) { loseResponse = false; return route.abort("failed"); }
      return json({ turn });
    }
    if (url.pathname === "/api/app/chat") return json({ babyId: baby.id, conversationId: "conversation", turns, pending: [], pendingCount: 0 });
    if (url.pathname === "/api/app/records/pending" || url.pathname === "/api/app/records/sync" || url.pathname === "/api/app/activities") return json([]);
    if (url.pathname === "/api/app/records/snapshot") return json({ activities: [], events: [], questions: [], summary: emptyRecordSummary() });
    if (url.pathname === "/api/app/activities/latest") return json(null);
    return json({ error: "Unexpected path" }, 404);
  });
  return { submissions, revoke: () => { revoked = true; } };
}
const input = (page: Page) => page.locator(".bubu-chat-text textarea");
async function open(page: Page) { await page.locator(".bubu-chat-launcher").click(); await expect(page.locator(".bubu-chat-sheet")).toBeVisible(); }
test("a collapsed and restarted conversation restores its unsent draft", async ({ page }) => {
  await fixture(page); await page.goto("/"); await open(page);
  await input(page).fill("刚才喝了奶，奶量不知道");
  await page.getByLabel("收起对话").click(); await expect(page.locator(".bubu-chat-sheet")).toHaveCount(0);
  await open(page); await expect(input(page)).toHaveValue("刚才喝了奶，奶量不知道");
  await page.reload(); await open(page); await expect(input(page)).toHaveValue("刚才喝了奶，奶量不知道");
  await page.screenshot({ path: "test-results/chat-draft-restored.png", fullPage: true });
});
test("lost POST response recovers the server result using the original request", async ({ page }) => {
  const setup = await fixture(page, true); await page.goto("/"); await open(page);
  await input(page).fill("刚才喝了奶，奶量不知道"); await page.getByLabel("发送消息").click();
  await expect(page.locator(".bubu-chat-recovery")).toBeVisible();
  await page.getByText("确认 / 继续", { exact: true }).click();
  await expect(page.locator(".bubu-chat-receipt")).toContainText("已有内容已保存");
  await expect(input(page)).toHaveValue(""); expect(setup.submissions).toHaveLength(1);
});
test("revoking baby access removes both visible and stored private drafts", async ({ page }) => {
  const setup = await fixture(page); await page.goto("/"); await open(page); await input(page).fill("只属于这个宝宝的草稿");
  await page.getByLabel("收起对话").click(); setup.revoke();
  await page.locator(".bubu-chat-launcher").click();
  await expect(page.getByText("开始记录宝宝的日常", { exact: true })).toBeVisible();
  await expect(page.locator(".bubu-chat-sheet")).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("只属于这个宝宝的草稿");
});
