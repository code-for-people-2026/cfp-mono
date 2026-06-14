import { expect, test } from "@playwright/test";

test("homepage and demo API are reachable", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "码成工" })).toBeVisible();

  const response = await request.get("/api/miniapp/demo");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    message: "码成工 API 已连接"
  });
});

