import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 320, height: 568 } });

// Synthetic settings only: this suite never connects to a family account or database.
const baby = { id: "care-test-baby", name: "小满", fullName: null, avatarUrl: null, isDefault: true };
const context = { authenticated: true, hasBaby: true, baby, babies: [baby], defaultBabyId: baby.id, currentBabyId: baby.id };

async function fixture(page: Page) {
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname !== "/api/app/auth/context") return route.fulfill({ status: 404, json: { error: "Unexpected endpoint" } });
    return route.fulfill({ status: 200, json: context });
  });
  return {
    requests,
    writes: () => requests.filter((request) => !request.startsWith("GET ")),
  };
}

async function labeledInput(page: Page, label: string) {
  const field = page.getByLabel(label, { exact: true });
  const nestedInput = field.locator("input");
  return (await nestedInput.count()) ? nestedInput.first() : field;
}

async function readTaroStorage(page: Page, key: string) {
  const raw = await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
  if (raw === null) return null;
  const wrapper = JSON.parse(raw) as { data: unknown };
  return typeof wrapper.data === "string" ? JSON.parse(wrapper.data) : wrapper.data;
}

async function openSettings(page: Page) {
  await page.goto("/#/pages/settings/index");
  await expect(page.getByText("宝宝资料", { exact: true })).toBeVisible();
  await expect(page.getByText("本机参考设置", { exact: true })).toBeVisible();
}

test("custom care reference ranges stay local and survive reopening", async ({ page }) => {
  const { writes } = await fixture(page);
  await openSettings(page);

  await page.getByLabel("亲喂自定义速度区间").click();
  await (await labeledInput(page, "亲喂速度下限")).fill("6");
  await (await labeledInput(page, "亲喂速度上限")).fill("9");
  await page.getByLabel("自定义奶量参考").click();
  await (await labeledInput(page, "每日奶量下限")).fill("650");
  await (await labeledInput(page, "每日奶量上限")).fill("850");
  await page.getByLabel("自定义睡眠参考").click();
  await (await labeledInput(page, "每日睡眠下限小时")).fill("12.5");
  await (await labeledInput(page, "每日睡眠上限小时")).fill("14");
  await page.getByText("保存参考设置", { exact: true }).click();
  await expect(page.getByText("本机参考设置已保存。", { exact: true })).toBeVisible();

  const origin = new URL(page.url()).origin;
  const storageKey = `bubu-care-preferences:${origin}:care-test-baby`;
  await expect.poll(() => readTaroStorage(page, storageKey)).toEqual({
    breastfeedRate: { mode: "custom", range: { min: 6, max: 9 }, source: "user-custom" },
    milkReference: { min: 650, max: 850 },
    sleepReference: { min: 750, max: 840 },
  });

  await page.reload();
  await expect(page.getByText("宝宝资料", { exact: true })).toBeVisible();
  await page.getByLabel("亲喂自定义速度区间").click();
  await expect(await labeledInput(page, "亲喂速度下限")).toHaveValue("6");
  await expect(await labeledInput(page, "亲喂速度上限")).toHaveValue("9");
  await expect(await labeledInput(page, "每日奶量下限")).toHaveValue("650");
  await expect(await labeledInput(page, "每日奶量上限")).toHaveValue("850");
  await expect(await labeledInput(page, "每日睡眠下限小时")).toHaveValue("12.5");
  await expect(await labeledInput(page, "每日睡眠上限小时")).toHaveValue("14");
  expect(writes()).toEqual([]);
});

test("invalid custom reference input is rejected and never stored", async ({ page }) => {
  const { writes } = await fixture(page);
  await openSettings(page);

  await page.getByLabel("亲喂自定义速度区间").click();
  await (await labeledInput(page, "亲喂速度下限")).fill("11");
  await (await labeledInput(page, "亲喂速度上限")).fill("5");
  await page.getByText("保存参考设置", { exact: true }).click();

  await expect(page.getByText("亲喂估算速度（ml/分钟）下限不能大于上限。", { exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const stored = await readTaroStorage(page, `bubu-care-preferences:${origin}:care-test-baby`);
  expect(stored).toBeNull();
  await expect(page.getByText("本机参考设置已保存。", { exact: true })).toHaveCount(0);
  expect(writes()).toEqual([]);
});

test("weighing calibration previews first and persists only the selected rate", async ({ page }) => {
  const { writes } = await fixture(page);
  await openSettings(page);
  await page.getByLabel("展开用称重结果校准速度").click();
  await expect(page.locator(".calibration-panel")).toBeVisible();
  const viewportOverflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewportOverflow.scrollWidth).toBeLessThanOrEqual(viewportOverflow.clientWidth);

  const beforeGrams = await labeledInput(page, "称重校准喂前体重克");
  const afterGrams = await labeledInput(page, "称重校准喂后体重克");
  const activeFeedMinutes = await labeledInput(page, "称重校准有效哺喂时长分钟");
  const preview = page.getByText("先预览结果", { exact: true });
  const apply = page.getByText("采用此速度", { exact: true });

  await beforeGrams.fill("0");
  await afterGrams.fill("5103");
  await activeFeedMinutes.fill("10");
  await page.getByText("先预览结果", { exact: true }).click();
  await expect(page.getByText("称重校准的开始前体重必须大于 0 克。", { exact: true })).toBeVisible();

  const makeValidPreview = async () => {
    await beforeGrams.fill("5000");
    await afterGrams.fill("5103");
    await activeFeedMinutes.fill("10");
    await preview.click();
    await expect(page.getByText("参考奶量：约 100 ml", { exact: true })).toBeVisible();
    await expect(page.getByText("估算速度：10 ml/分钟", { exact: true })).toBeVisible();
  };

  for (const [field, replacement] of [
    [beforeGrams, "5001"],
    [afterGrams, "5102"],
    [activeFeedMinutes, "11"],
  ] as const) {
    await makeValidPreview();
    await field.fill(replacement);
    await expect(page.locator(".calibration-preview")).toBeHidden();
    await expect(apply).toHaveAttribute("disabled", "");
    await apply.click();
    await expect(page.getByText("已按称重估计：10–10 ml/分钟", { exact: true })).toHaveCount(0);
    await expect.poll(() => readTaroStorage(page, `bubu-care-preferences:${new URL(page.url()).origin}:care-test-baby`)).toBeNull();
  }

  await makeValidPreview();
  await expect(page.getByText("参考奶量：约 100 ml", { exact: true })).toBeVisible();
  await expect(page.getByText("估算速度：10 ml/分钟", { exact: true })).toBeVisible();

  await apply.click();
  await expect(beforeGrams).toHaveValue("");
  await expect(afterGrams).toHaveValue("");
  await expect(activeFeedMinutes).toHaveValue("");
  await expect(page.getByText("已按称重估计：10–10 ml/分钟", { exact: true })).toBeVisible();

  await page.getByText("保存参考设置", { exact: true }).click();
  await expect(page.getByText("本机参考设置已保存。", { exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  await expect.poll(() => readTaroStorage(page, `bubu-care-preferences:${origin}:care-test-baby`)).toEqual({
    breastfeedRate: { mode: "calibrated", range: { min: 10, max: 10 }, source: "user-calibrated" },
    milkReference: null,
    sleepReference: null,
  });
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), `bubu-care-preferences:${origin}:care-test-baby`);
  expect(raw).not.toContain("beforeGrams");
  expect(raw).not.toContain("afterGrams");
  expect(raw).not.toContain("activeFeedMinutes");
  expect(writes()).toEqual([]);
});
