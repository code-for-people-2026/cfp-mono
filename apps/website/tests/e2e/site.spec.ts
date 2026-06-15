import { expect, test } from "@playwright/test";

test("homepage presents the public-facing idea and paths to continue", async ({
  page,
}) => {
  await page.goto("/");

  const shareDescription =
    "码成工是一个想在 AI 时代为“工友”敲键盘的组织构想：从真实生活出发，把软件能力和数据红利更多还给生产它、使用它的人。";
  const shareTitle = "码成工｜为“工友”敲键盘";

  await expect(page).toHaveTitle(shareTitle);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    shareDescription,
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    shareTitle,
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    "content",
    shareDescription,
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary");
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
    "content",
    shareTitle,
  );
  await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute(
    "content",
    shareDescription,
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /\/icon/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    /\/apple-icon/,
  );

  await expect(
    page.getByRole("heading", { name: "你好，我们是码成工" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Public AI Lab");
  await expect(page.locator("body")).not.toContainText("公共智能实验室");
  await expect(page.getByText("一个为“工友”敲键盘的组织", { exact: true })).toBeVisible();
  await expect(page.getByText("数据平权 · AI 下乡")).toBeVisible();
  await expect(page.getByText("软件也是一种服务，为何不还给人民")).toBeVisible();
  await expect(page.getByTestId("hero-manifesto-slogan")).toContainText(
    "软件也是一种服务，为何不还给人民",
  );
  await expect(page.getByTestId("hero-slogan-highlight-service")).toHaveText("服务");
  await expect(page.getByTestId("hero-slogan-highlight-for")).toHaveText("为");
  await expect(page.getByTestId("hero-slogan-highlight-people")).toHaveText("人民");
  await expect(page.getByText("这个首页先回答三件事")).toHaveCount(0);
  await expect(page.getByText("为什么说软件不该继续变成新的租金")).toHaveCount(0);
  await expect(page.getByText("从一个问题开始了解我们")).toHaveCount(1);
  await expect(
    page.locator('section[aria-label="了解项目入口"]').getByText("从一个问题开始了解我们"),
  ).toBeVisible();
  await expect(
    page.getByText("想了解码成工，可以先从一个朴素的问题开始"),
  ).toHaveCount(0);
  await expect(page.getByText("可以先问一个问题")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "想了解的问题" })).toBeVisible();
  await expect(page.getByPlaceholder(/码成工是什么/)).toBeVisible();
  await expect(page.getByPlaceholder(/为什么说软件也是一种服务/)).toBeVisible();
  await expect(page.getByPlaceholder(/工友价代表什么/)).toBeVisible();
  await expect(page.getByRole("button", { name: "开始了解" })).toBeVisible();
  await expect(page.getByText("知识库即将接入")).toBeVisible();
  await expect(page.getByText("上线后会基于公开文本回答；当前仍是预览入口")).toBeVisible();
  await expect(page.getByRole("button", { name: "你们是谁" })).toBeVisible();
  await expect(page.getByRole("button", { name: "为什么还给人民" })).toBeVisible();
  await expect(page.getByRole("button", { name: "协议怎么约束" })).toBeVisible();
  await expect(page.getByRole("button", { name: "7×7 怎么回事" })).toBeVisible();
  await expect(page.getByRole("button", { name: "我有具体麻烦" })).toHaveCount(0);
  await expect(page.getByText("今天有什么具体麻烦，想让软件帮帮忙？")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "服务谁" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "为什么现在做" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "怎么避免变成平台" })).toHaveCount(0);
  const viewportWidth = page.viewportSize()?.width ?? 0;
  if (viewportWidth >= 768) {
    await expect(
      page.getByRole("main").getByRole("link", { name: "方向地图", exact: true }),
    ).toHaveAttribute("href", "/map");
  }
  await expect(page.getByRole("link", { name: "7×7", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "读数据平权宣言", exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我们是谁，服务谁" })).toBeVisible();
  await expect(
    page.getByText("码成工还在早期。我们先把为什么做、服务谁、如何自我约束讲清楚"),
  ).toBeVisible();
  await expect(page.getByText("首页先把基本身份讲清楚")).toHaveCount(0);
  await expect(page.getByText("码成工，一个为“工友”敲键盘的组织")).toBeVisible();
  await expect(page.getByText("工友不是一个行业")).toBeVisible();
  await expect(page.getByText("项目还在筹备中：宣言、协议和方向地图已经公开")).toBeVisible();
  await expect(page.getByText("对话入口之后接入知识库问答")).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "规则背后，是红利怎么分" })).toBeVisible();
  await expect(
    page.getByText("路线、订单、评价和流水从普通人的实践中产生"),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "这不是个人小事" })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "我们说的工友，不是一个行业" })).toBeVisible();
  await expect(page.getByText("我们不按行业贴标签，而按人在生产关系里的位置看处境")).toBeVisible();
  await expect(page.getByText("补贴怎么变、这一趟值不值、一天跑下来到底净赚多少")).toBeVisible();
  await expect(page.getByText("工时有没有算对、扣款合不合理、请假和离职材料怎么写")).toBeVisible();
  await expect(page.getByText("账本理不清、平台活动看不懂、想宣传却不知道怎么说")).toBeVisible();
  await expect(page.getByText("信息太乱、材料太多、看病育儿照护都在挤时间")).toBeVisible();
  await expect(page.getByText("家庭再生产", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "我们怎么判断方向" })).toBeVisible();
  await expect(page.getByText("7×7 是地图，不是承诺")).toBeVisible();
  await expect(page.getByText("7×7 是一张方向地图")).toBeVisible();
  await expect(page.getByText("先理解问题，再判断什么值得做")).toBeVisible();
  await expect(page.getByText("真正的需求入口以后会在矩阵页展开")).toHaveCount(0);
  await expect(page.getByText("提需求会放到 7×7 矩阵里继续展开")).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "为什么现在可以重新想这件事" })).toHaveCount(0);
  await expect(page.getByText("软件生产力变了")).toBeVisible();
  await expect(page.getByText("平台优势从哪来")).toBeVisible();
  await expect(page.getByText("路线、订单、评价、点击、流水，从普通人的生活和实践中产生")).toBeVisible();
  await expect(page.getByText("红利归数据生产者")).toBeVisible();
  await expect(page.getByText("平台把占有的数据变成抽成、排序、派单和规则")).toBeVisible();

  await expect(page.getByRole("heading", { name: "我们如何约束自己" })).toBeVisible();
  await expect(page.getByText("工友价不是补贴，是协议")).toBeVisible();
  await expect(page.getByText("不上市、不并购、不套现")).toBeVisible();
  await expect(page.getByText("承认还在路上")).toBeVisible();

  await expect(page.getByRole("heading", { name: "继续阅读" })).toBeVisible();
  await expect(page.getByText("看 7×7 方向地图")).toBeVisible();
  await expect(page.getByText("看牛马互助协议")).toBeVisible();
  await expect(page.getByText("一起做或提出批评")).toBeVisible();

  await expect(page.getByRole("main").getByRole("heading", { name: "关注后续" })).toHaveCount(0);
  await expect(page.getByAltText("码成工 logo")).toHaveAttribute(
    "src",
    /code-for-people-logo\.png/,
  );
  await expect(page.locator("main").getByAltText("抖音二维码")).toHaveCount(0);
  await expect(page.locator("main").getByAltText("快手二维码")).toHaveCount(0);
  await expect(page.locator("main").locator('[aria-label="B站二维码待补充"]')).toHaveCount(0);
  await expect(page.locator('img[src*="bilibili"]')).toHaveCount(0);
  await expect(page.getByText("微信群")).toHaveCount(0);
  await expect(page.locator('img[src*="wechat"]')).toHaveCount(0);

  await expect(page.getByRole("link", { name: "读数据平权宣言", exact: true })).toHaveAttribute(
    "href",
    "/manifesto",
  );
  await expect(page.getByRole("link", { name: "看 7×7 方向地图" })).toHaveAttribute("href", "/map");
  await expect(page.getByRole("link", { name: "看牛马互助协议" })).toHaveAttribute("href", "/license");

  const footer = page.getByRole("contentinfo");
  await expect(footer).toBeVisible();
  await expect(footer.getByText("为“工友”敲键盘", { exact: true })).toBeVisible();
  await expect(footer).toHaveAttribute("id", "follow");
  await expect(footer.getByRole("link", { name: "首页", exact: true })).toHaveAttribute("href", "/");
  await expect(footer.getByRole("link", { name: "宣言", exact: true })).toHaveAttribute(
    "href",
    "/manifesto",
  );
  await expect(footer.getByRole("link", { name: "方向地图", exact: true })).toHaveAttribute(
    "href",
    "/map",
  );
  await expect(footer.getByRole("link", { name: "协议", exact: true })).toHaveAttribute(
    "href",
    "/license",
  );
  await expect(footer.getByRole("link", { name: "关注后续", exact: true })).toHaveCount(0);
  await expect(footer.getByText("长期账号更新公开进展")).toHaveCount(0);
  await expect(footer.getByText("临时群二维码不放在官网")).toHaveCount(0);
  await expect(footer.getByRole("heading", { name: "公开渠道" })).toBeVisible();
  await expect(footer.getByText("抖音", { exact: true })).toBeVisible();
  await expect(footer.getByText("快手", { exact: true })).toBeVisible();
  await expect(footer.getByText("B站", { exact: true })).toBeVisible();
  await expect(footer.getByTestId("footer-social-icon-抖音")).toBeVisible();
  await expect(footer.getByTestId("footer-social-icon-快手")).toBeVisible();
  await expect(footer.getByTestId("footer-social-icon-B站")).toBeVisible();
  await expect(footer.getByTestId("footer-social-popover-抖音")).toBeHidden();
  await footer.getByTestId("footer-social-trigger-抖音").scrollIntoViewIfNeeded();
  await footer.getByTestId("footer-social-trigger-抖音").click();
  await expect(footer.getByTestId("footer-social-popover-抖音")).toBeVisible();
  await expect(footer.getByAltText("抖音二维码")).toHaveAttribute("src", /douyin-qr\.jpg/);
  await footer.getByTestId("footer-social-trigger-快手").scrollIntoViewIfNeeded();
  await footer.getByTestId("footer-social-trigger-快手").click();
  await expect(footer.getByTestId("footer-social-popover-快手")).toBeVisible();
  await expect(footer.getByAltText("快手二维码")).toHaveAttribute("src", /kuaishou-qr\.jpg/);
  await footer.getByTestId("footer-social-trigger-B站").scrollIntoViewIfNeeded();
  await footer.getByTestId("footer-social-trigger-B站").click();
  await expect(footer.getByTestId("footer-social-popover-B站")).toBeVisible();
  await expect(footer.locator('[aria-label="B站二维码待补充"]')).toBeVisible();
  await expect(footer.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute(
    "href",
    "https://github.com/code-for-people-2026",
  );
  await expect(footer.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(footer.getByRole("link", { name: "GitHub", exact: true })).toHaveAttribute(
    "rel",
    /noreferrer/,
  );
  await expect(footer.getByText("备案信息待补充")).toBeVisible();
  await expect(footer.getByText("© 2026 码成工")).toBeVisible();
  await expect(footer.locator('a[href*="beian"]')).toHaveCount(0);
});

test("homepage follows the visitor system color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const lightTheme = await page.evaluate(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    text: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(),
  }));

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const darkTheme = await page.evaluate(() => ({
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    background: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    text: getComputedStyle(document.documentElement).getPropertyValue("--ink").trim(),
  }));

  expect(lightTheme.colorScheme).toContain("light");
  expect(darkTheme.colorScheme).toContain("dark");
  expect(lightTheme.background).not.toBe(darkTheme.background);
  expect(lightTheme.text).not.toBe(darkTheme.text);
});

test("brand mark and social QR codes stay compact", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const metrics = await page.evaluate(() => {
    const headerLogo = document.querySelector('img[alt="码成工 logo"]');
    if (!headerLogo) {
      throw new Error("Missing header logo");
    }

    const logoRect = headerLogo.getBoundingClientRect();
    const logoStyles = getComputedStyle(headerLogo);
    const qrRects = ["抖音二维码", "快手二维码"].map((alt) => {
      const image = document.querySelector(`img[alt="${alt}"]`);
      if (!image) {
        throw new Error(`Missing ${alt}`);
      }
      const rect = image.getBoundingClientRect();
      return {
        alt,
        height: Math.round(rect.height),
        width: Math.round(rect.width),
      };
    });
    const bilibiliPlaceholder = document.querySelector('[aria-label="B站二维码待补充"]');
    if (!bilibiliPlaceholder) {
      throw new Error("Missing B站 placeholder");
    }
    const bilibiliRect = bilibiliPlaceholder.getBoundingClientRect();

    return {
      logo: {
        borderRadius: Number.parseFloat(logoStyles.borderTopLeftRadius),
        height: Math.round(logoRect.height),
        width: Math.round(logoRect.width),
      },
      bilibiliPlaceholder: {
        height: Math.round(bilibiliRect.height),
        width: Math.round(bilibiliRect.width),
      },
      qrRects,
    };
  });

  expect(Math.abs(metrics.logo.width - metrics.logo.height)).toBeLessThanOrEqual(1);
  expect(metrics.logo.width).toBeLessThanOrEqual(44);
  expect(metrics.logo.borderRadius).toBeLessThan(metrics.logo.width / 4);

  for (const qr of metrics.qrRects) {
    expect(qr.width).toBeLessThanOrEqual(112);
    expect(Math.abs(qr.width - qr.height)).toBeLessThanOrEqual(1);
  }
  expect(metrics.bilibiliPlaceholder.width).toBeLessThanOrEqual(112);
  expect(Math.abs(metrics.bilibiliPlaceholder.width - metrics.bilibiliPlaceholder.height)).toBeLessThanOrEqual(
    1,
  );
});

test("life scene tags align at the bottom of cards in each row", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.goto("/");

  const bottomGaps = await page.evaluate(() => {
    const titles = ["跑单", "做工", "看店", "照顾家里"];
    return titles.map((title) => {
      const heading = Array.from(document.querySelectorAll("h3")).find(
        (element) => element.textContent?.trim() === title,
      );
      if (!heading) {
        throw new Error(`Missing life scene card: ${title}`);
      }

      const card = heading.closest("section");
      if (!card) {
        throw new Error(`Missing card container: ${title}`);
      }

      const tag = Array.from(card.querySelectorAll("span")).find((element) =>
        ["收入判断", "劳动议价", "经营判断", "家庭再生产"].includes(
          element.textContent?.trim() ?? "",
        ),
      );
      const tagRow = tag?.parentElement;
      if (!tagRow) {
        throw new Error(`Missing tag row: ${title}`);
      }

      const cardRect = card.getBoundingClientRect();
      const tagRect = tagRow.getBoundingClientRect();
      return Math.round(cardRect.bottom - tagRect.bottom);
    });
  });

  const [firstCardGap, secondCardGap, thirdCardGap, fourthCardGap] = bottomGaps;
  expect(Math.abs(firstCardGap - secondCardGap)).toBeLessThanOrEqual(2);
  expect(Math.abs(thirdCardGap - fourthCardGap)).toBeLessThanOrEqual(2);
});

test("narrow content cards do not keep desktop-height empty space", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1000 });
  await page.goto("/");

  const cardHeights = await page.evaluate(() => {
    const findCardByHeading = (title: string) => {
      const heading = Array.from(document.querySelectorAll("h3")).find(
        (element) => element.textContent?.trim() === title,
      );
      const card = heading?.closest("section");
      if (!card) {
        throw new Error(`Missing card: ${title}`);
      }
      return Math.round(card.getBoundingClientRect().height);
    };

    return {
      lifeScene: findCardByHeading("跑单"),
      whyNow: findCardByHeading("软件生产力变了"),
    };
  });

  expect(cardHeights.lifeScene).toBeLessThan(270);
  expect(cardHeights.whyNow).toBeLessThan(270);
});

test("deep read pages render expanded public documents from ideal", async ({ page }) => {
  await page.goto("/manifesto");
  await expect(page.getByRole("heading", { name: "数据平权宣言" })).toBeVisible();
  await expect(page.getByText("宣言全文")).toBeVisible();
  const manifestoFullText = page.locator("#full-text");
  await expect(page.getByRole("heading", { name: "v0.4 · 端午摆摊公开版" })).toBeVisible();
  await expect(
    manifestoFullText.getByText("一个幽灵，数据平权的幽灵，正在互联网上游荡。"),
  ).toBeVisible();
  await expect(
    manifestoFullText.getByRole("heading", { name: "至今一切互联网的历史，是一部收租的历史。" }),
  ).toBeVisible();
  await expect(
    manifestoFullText.getByText("平台坐在生产者与消费者中间，活成了数字封建领主。"),
  ).toBeVisible();
  await expect(
    manifestoFullText.getByText("过剩的时代，胜负看红利让给谁。"),
  ).toBeVisible();
  await expect(
    manifestoFullText.getByText("数据平权的全部主张，可以概括为一句话：红利归于人民。"),
  ).toBeVisible();
  await expect(
    manifestoFullText.getByText("过剩的生产力红利，应当归于人民。"),
  ).toBeVisible();
  await expect(manifestoFullText.getByText("全世界工友，联合起来！")).toBeVisible();
  await expect(page.getByText("SOURCE")).toHaveCount(0);
  await expect(page.getByText("ideal/第一个产品/宣言-数据平权.md")).toHaveCount(0);

  await page.goto("/license");
  await expect(page.getByRole("heading", { name: "牛马互助协议" })).toBeVisible();
  await expect(page.getByText("协议全文")).toBeVisible();
  await expect(page.getByText("Cattle License v0.1 草案")).toBeVisible();
  const licenseFullText = page.locator("#full-text");
  await expect(licenseFullText.getByText("优惠像源代码一样传染。")).toBeVisible();
  await expect(licenseFullText.getByText("优惠沿协议链传播，不设上限。")).toBeVisible();
  await expect(licenseFullText.getByText("工友享受 1/3 价")).toBeVisible();
  await expect(licenseFullText.getByText("没有 exit")).toBeVisible();
  await expect(licenseFullText.getByText("社员积分")).toBeVisible();
  await expect(
    licenseFullText.getByText("“数据 / 软件属于用户”在可见的将来是一个靠公开自缚兜底的承诺"),
  ).toBeVisible();
  await expect(page.getByText("SOURCE")).toHaveCount(0);
  await expect(page.getByText("ideal/第一个产品/牛马互助协议.md")).toHaveCount(0);

  await page.goto("/map");
  await expect(page.getByRole("heading", { name: "7×7 方向地图" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "把“剥夺”作为产品起点。" })).toBeVisible();
  await expect(page.getByText("一产、二产、服务业新蓝领")).toBeVisible();
  await expect(page.getByText("劳动议价、时间主权、健康医疗")).toBeVisible();
});

test("dialogue route stays reachable from the homepage question entry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "想了解的问题" }).fill("想了解方向地图");
  await page.getByRole("button", { name: "开始了解" }).click();

  await expect(page).toHaveURL(/\/dialogue\?question=/);
  await expect(page.getByRole("heading", { name: "对话入口正在接入" })).toBeVisible();
  await expect(page.getByText("之后会接入基于项目知识库的问答")).toBeVisible();
  await expect(page.getByText("回答会以已经公开的文本为依据")).toBeVisible();
});

test("payload baseline routes are reachable", async ({ page, request }) => {
  const formLinksResponse = await request.get("/api/form-links?limit=1");
  expect(formLinksResponse.status()).toBeLessThan(500);

  const adminResponse = await page.goto("/admin");
  expect(adminResponse?.status()).toBeLessThan(500);
  await expect(page.locator("body")).not.toContainText("Application error");
});
