import { expect, test, type Page } from "@playwright/test";

async function openMatrix(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/wam/matrix", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ submissions: {}, meta: { approvedCount: 0 } }),
    });
  });
  await page.goto("/wam");
}

test("desktop keeps the native high-density matrix and written legend", async ({ page }) => {
  await openMatrix(page, 1280);

  await expect(page.getByRole("heading", { name: "牛马能力剥夺矩阵" })).toBeVisible();
  await expect(page.getByText("7×7 核心矩阵 + H 未细分补充列", { exact: true })).toBeVisible();

  const table = page.getByRole("table", { name: "牛马能力剥夺矩阵完整表格" });
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(7);
  await expect(table.locator("thead th")).toHaveCount(9);
  await expect(table.getByRole("link", { name: "A1 一产 × 劳动议价" })).toBeVisible();
  await expect(page.getByText("红底 = 红海", { exact: true })).toBeVisible();
  await expect(page.getByText("蓝底 = 蓝海", { exact: true })).toBeVisible();
  await expect(page.getByText("黑底 = 黑化", { exact: true })).toBeVisible();
  await expect(page.getByText("金底 = 站到人民这边", { exact: true })).toBeVisible();
  await expect(page.locator(".matrix-qrbox-link")).toHaveAttribute("target", "_blank");
  await expect(
    page.getByText(/提交内容和可选联系方式在审核前仅供码成仝审核人员查看/),
  ).toBeVisible();
});

test("mobile defaults to a written axis list and keeps the same cell paths", async ({ page }) => {
  await openMatrix(page, 390);

  const browser = page.getByRole("region", { name: "移动矩阵浏览" });
  await expect(browser).toBeVisible();
  await expect(browser.getByRole("button", { name: "列表浏览" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("table", { name: "牛马能力剥夺矩阵完整表格" })).toBeHidden();

  const peopleList = browser.getByRole("list", { name: "一产的能力格子" });
  await expect(peopleList.getByRole("listitem")).toHaveCount(7);
  const mobileA1 = peopleList.getByRole("link", { name: /A1 一产 × 劳动议价/ });
  await expect(mobileA1).toHaveAttribute("href", "/wam/cell/A1");

  await browser.getByRole("button", { name: "按能力" }).click();
  await browser.getByRole("combobox", { name: "选择能力" }).selectOption("time-sovereignty");
  const abilityList = browser.getByRole("list", { name: "时间主权的人群格子" });
  await expect(abilityList.getByRole("listitem")).toHaveCount(8);
  await expect(abilityList.getByRole("link", { name: /B2 二产 × 时间主权/ })).toHaveAttribute(
    "href",
    "/wam/cell/B2",
  );

  await browser.getByRole("button", { name: "完整矩阵" }).click();
  const table = page.getByRole("table", { name: "牛马能力剥夺矩阵完整表格" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("link", { name: "A1 一产 × 劳动议价" })).toHaveAttribute(
    "href",
    "/wam/cell/A1",
  );

  const scrollMetrics = await page.locator(".matrix-scroll").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth);
});

test("cell pages show position, explicit neighbors, and restore matrix browse state", async ({ page }) => {
  await openMatrix(page, 390);

  const browser = page.getByRole("region", { name: "移动矩阵浏览" });
  await browser.getByRole("combobox", { name: "选择人群" }).selectOption("secondary-sector");
  await browser.getByRole("link", { name: /B1 二产 × 劳动议价/ }).click();

  await expect(page).toHaveURL(/\/wam\/cell\/B1$/);
  await expect(page.getByText("矩阵 / 二产 × 劳动议价", { exact: true })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "返回矩阵" })).toHaveAttribute(
    "href",
    "/wam?view=list&axis=people&item=secondary-sector",
  );
  await expect(page.getByRole("link", { name: "上一人群：一产" })).toHaveAttribute(
    "href",
    "/wam/cell/A1",
  );
  await expect(page.locator(".cell-detail-slide.active .detail-submit-link")).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(page.locator(".cell-detail-slide.active .detail-submit-note")).toContainText(
    "审核通过后内容与可选署名会显示在这个格子中",
  );
  await page.getByRole("link", { name: "下一能力：时间主权" }).click();
  await expect(page).toHaveURL(/\/wam\/cell\/B2$/);
  await expect(page.getByText("矩阵 / 二产 × 时间主权", { exact: true })).toBeVisible();

  await main.getByRole("link", { name: "返回矩阵" }).click();
  await expect(page).toHaveURL(/\/wam\?view=list&axis=people&item=secondary-sector$/);
  await expect(browser.getByRole("combobox", { name: "选择人群" })).toHaveValue(
    "secondary-sector",
  );
});

test("matrix routes do not cause page-level horizontal overflow", async ({ page }) => {
  for (const width of [1440, 1280, 390, 320]) {
    await openMatrix(page, width);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `${width}px page width`).toBeLessThanOrEqual(
      dimensions.clientWidth,
    );
  }

  await page.goto("/wam/guide");
  const guideReturn = page.getByRole("main").getByRole("link", { name: "返回矩阵" });
  await expect(guideReturn).toBeVisible();
  await expect(guideReturn).toContainText("返回矩阵");
  await page.goto("/wam/cell/A1");
  await expect(page.getByRole("main").getByRole("link", { name: "返回矩阵" })).toBeVisible();
});
