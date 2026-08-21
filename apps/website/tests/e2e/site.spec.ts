import { expect, test } from "@playwright/test";

test("homepage presents the public-facing idea and paths to continue", async ({
  page,
}) => {
  await page.goto("/");

  const shareDescription =
    "码成仝是一个想在 AI 时代为“工友”敲键盘的组织构想：从真实生活出发，把软件能力和数据红利更多还给生产它、使用它的人。";
  const shareTitle = "码成仝｜为“工友”敲键盘";

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
    page.getByRole("heading", { name: "你好，我们是码成仝" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Public AI Lab");
  await expect(page.locator("body")).not.toContainText("公共智能实验室");
  await expect(page.getByText("一个为“工友”敲键盘的组织", { exact: true })).toBeVisible();
  await expect(page.getByText("数据平权 · AI 下乡")).toBeVisible();
  await expect(page.getByText("软件也是一种服务，为何不还给人民")).toBeVisible();
  await expect(page.getByTestId("hero-manifesto-slogan")).toContainText(
    "软件也是一种服务，为何不还给人民",
  );
  await expect(page.getByText("这个首页先回答三件事")).toHaveCount(0);
  await expect(page.getByText("为什么说软件不该继续变成新的租金")).toHaveCount(0);
  await expect(page.getByText("从一个问题开始了解我们")).toHaveCount(1);
  await expect(
    page.locator('section[aria-label="了解项目入口"]').getByText("从一个问题开始了解我们"),
  ).toBeVisible();
  await expect(
    page.getByText("想了解码成仝，可以先从一个朴素的问题开始"),
  ).toHaveCount(0);
  await expect(page.getByText("可以先问一个问题")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "想了解的问题" })).toBeVisible();
  await expect(page.getByPlaceholder(/码成仝是什么/)).toBeVisible();
  await expect(page.getByPlaceholder(/为什么说软件也是一种服务/)).toBeVisible();
  await expect(page.getByPlaceholder(/工友价代表什么/)).toBeVisible();
  await expect(page.getByRole("button", { name: "开始了解" })).toBeVisible();
  await expect(page.getByText("回答基于已经公开的文本")).toBeVisible();
  await expect(page.getByText("知识库即将接入")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "近邻互助组是什么？", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "为什么还给人民" })).toBeVisible();
  await expect(page.getByRole("button", { name: "牛马互助协议怎么约束" })).toBeVisible();
  await expect(page.getByRole("button", { name: "牛马能力剥夺矩阵怎么回事" })).toBeVisible();
  await expect(page.getByRole("button", { name: "我有具体麻烦" })).toHaveCount(0);
  await expect(page.getByText("今天有什么具体麻烦，想让软件帮帮忙？")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "服务谁" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "为什么现在做" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "怎么避免变成平台" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "7×7", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "读数据平权宣言", exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "我们是谁，服务谁" })).toBeVisible();
  await expect(
    page.getByText("码成仝还在早期。我们先把为什么做、服务谁、如何自我约束讲清楚"),
  ).toBeVisible();
  await expect(page.getByText("首页先把基本身份讲清楚")).toHaveCount(0);
  await expect(page.getByText("码成仝，一个为“工友”敲键盘的组织")).toBeVisible();
  await expect(page.getByText("工友不是一个行业")).toBeVisible();
  await expect(
    page.getByText("项目还在筹备中：数据平权宣言、牛马互助协议和牛马能力剥夺矩阵已经公开"),
  ).toBeVisible();
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
  await expect(page.getByText("牛马能力剥夺矩阵是检查表，不是承诺")).toBeVisible();
  await expect(page.getByText("牛马能力剥夺矩阵按 7 类处境")).toBeVisible();
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
  await expect(page.getByText("看牛马能力剥夺矩阵")).toBeVisible();
  await expect(page.getByText("看牛马互助协议")).toBeVisible();
  await expect(page.getByText("一起做或提出批评")).toHaveCount(0);

  await expect(page.getByRole("main").getByRole("heading", { name: "关注后续" })).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByRole("link", { name: "码成仝首页" }).locator("img"),
  ).toHaveAttribute(
    "src",
    /code-for-people-logo\.png/,
  );
  await expect(page.locator("main").getByAltText("抖音二维码")).toHaveCount(0);
  await expect(page.locator("main").getByAltText("快手二维码")).toHaveCount(0);
  await expect(page.locator("main").locator('[aria-label="B站二维码待补充"]')).toHaveCount(0);
  await expect(page.locator("main").locator('img[src*="bilibili"]')).toHaveCount(0);
  await expect(page.getByText("微信群")).toHaveCount(0);
  await expect(page.locator('img[src*="wechat"]')).toHaveCount(0);

  await expect(page.getByRole("link", { name: "读数据平权宣言", exact: true })).toHaveAttribute(
    "href",
    "/manifesto",
  );
  await expect(page.getByRole("link", { name: "看牛马能力剥夺矩阵" })).toHaveAttribute(
    "href",
    "/wam",
  );
  await expect(page.getByRole("link", { name: "看牛马互助协议" })).toHaveAttribute("href", "/license");

  const footer = page.getByRole("contentinfo");
  await expect(footer).toBeVisible();
  await expect(footer.getByText("为“工友”敲键盘", { exact: true })).toBeVisible();
  await expect(footer).toHaveAttribute("id", "follow");
  const canonicalFooterLinks = footer.getByRole("navigation", { name: "页脚导航" }).getByRole("link");
  await expect(canonicalFooterLinks).toHaveText(["近邻互助组", "为什么做", "如何选题", "如何约束"]);
  await expect(canonicalFooterLinks.nth(0)).toHaveAttribute(
    "href",
    "/neighbors",
  );
  await expect(canonicalFooterLinks.nth(1)).toHaveAttribute("href", "/manifesto");
  await expect(canonicalFooterLinks.nth(2)).toHaveAttribute("href", "/wam");
  await expect(canonicalFooterLinks.nth(3)).toHaveAttribute("href", "/license");
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
  await footer.getByTestId("footer-social-trigger-抖音").hover();
  await expect(footer.getByTestId("footer-social-popover-抖音")).toBeVisible();
  await expect(footer.getByAltText("抖音二维码")).toHaveAttribute("src", /douyin-qr\.jpg/);
  await footer.getByTestId("footer-social-trigger-快手").hover();
  await expect(footer.getByTestId("footer-social-popover-快手")).toBeVisible();
  await expect(footer.getByAltText("快手二维码")).toHaveAttribute("src", /kuaishou-qr\.jpg/);
  await footer.getByTestId("footer-social-trigger-B站").hover();
  await expect(footer.getByTestId("footer-social-popover-B站")).toBeVisible();
  await expect(footer.getByAltText("B站二维码")).toHaveAttribute("src", /bilibili-qr/);
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
  const filing = footer.getByRole("link", { name: "粤ICP备2026098322号-1", exact: true });
  await expect(filing).toHaveAttribute("href", "https://beian.miit.gov.cn/");
  await expect(filing).toHaveAttribute("target", "_blank");
  await expect(filing).toHaveAttribute("rel", /noreferrer/);
  await expect(footer.getByText("© 2026 码成仝")).toBeVisible();
});

test("homepage keeps the approved light public theme across system preferences", async ({ page }) => {
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
  expect(darkTheme.colorScheme).toContain("light");
  expect(lightTheme.background).toBe(darkTheme.background);
  expect(lightTheme.text).toBe(darkTheme.text);
});

test("brand mark and social QR codes stay compact", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const metrics = await page.evaluate(() => {
    const headerLogo = document.querySelector('header[data-density] a[aria-label="码成仝首页"] img');
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
    const bilibiliPlaceholder = document.querySelector('img[alt="B站二维码"]');
    if (!bilibiliPlaceholder) {
      throw new Error("Missing B站 QR");
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
  expect(metrics.logo.borderRadius).toBeLessThanOrEqual(metrics.logo.width / 4);

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

  // /wam 现在是互动版牛马能力剥夺矩阵（WAM），不再是纯文本文档页。
  await page.goto("/wam");
  await expect(page.getByRole("heading", { name: "牛马能力剥夺矩阵" })).toBeVisible();
  await expect(page.getByText("7 类工友 × 7 样能力")).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) <= 980) {
    const mobileBrowser = page.getByRole("region", { name: "移动矩阵浏览" });
    await expect(mobileBrowser.getByRole("button", { name: "完整矩阵" })).toBeVisible();
    await expect(mobileBrowser.getByRole("link", { name: /A1 一产 × 劳动议价/ })).toBeVisible();
  } else {
    // 桌面矩阵保留左上角的「矩阵说明」入口与完整表头行列。
    await expect(page.getByRole("main").getByRole("link", { name: "矩阵说明" })).toBeVisible();
    await expect(page.getByRole("link", { name: /A1/ })).toBeVisible();
  }
});

test("featured homepage question submits immediately and enters the conversation", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "近邻互助组是什么？", exact: true }).click();

  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByText("近邻互助组是什么？", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "体验近邻互助组（原型）", exact: true }),
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "重新开始", exact: true }).click();

  await expect(page.getByRole("heading", { name: "从一个问题开始了解码成仝" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "近邻互助组是什么？", exact: true }),
  ).toBeVisible();
});

test("neighbors answer renders canonical structured actions without model links", async ({
  page,
}) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ answer: "这是一段不包含任何链接的纯文本回答。" }),
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "近邻互助组是什么？", exact: true }).click();

  await expect(
    page.getByText(/近邻互助组是码成仝当前唯一的旗舰产品/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "体验近邻互助组（原型）", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://ideal.codeforpeople.cn/neighbors/prototype-customer/",
  );
  await expect(
    page.getByRole("link", { name: "查看正式介绍", exact: true }),
  ).toHaveAttribute("href", "/neighbors");
  await expect(
    page.getByText("交互原型 · 不接真实业务数据 · 不代表服务已经上线", { exact: true }),
  ).toBeVisible();
});

test("public documents expose reading navigation and one product context bridge", async ({ page }) => {
  const documents = [
    {
      path: "/manifesto",
      intent: "为什么做",
      firstSummary: "平台曾经创造连接，也把连接变成租金。",
      firstFullSection: "v0.4 · 端午摆摊公开版",
    },
    {
      path: "/license",
      intent: "如何约束",
      firstSummary: "为什么叫协议。",
      firstFullSection: "仿 GPL 的传染性互助协议。",
    },
  ] as const;

  for (const document of documents) {
    await page.goto(document.path);

    const main = page.getByRole("main");
    if ((page.viewportSize()?.width ?? 0) < 1280) {
      await main.locator("details > summary").click();
    }
    const readingNavigation = main.getByRole("navigation", { name: "文档目录" });

    await expect(main.getByText(document.intent, { exact: true })).toBeVisible();
    await expect(readingNavigation.getByRole("link", { name: "导读", exact: true })).toHaveAttribute(
      "href",
      "#reading-guide",
    );
    await expect(
      readingNavigation.getByRole("link", { name: document.firstSummary, exact: true }),
    ).toHaveAttribute("href", "#summary-1");
    await expect(
      readingNavigation.getByRole("link", { name: document.firstFullSection, exact: true }),
    ).toHaveAttribute("href", "#full-1");
    await expect(readingNavigation.getByRole("link", { name: "阅读全文", exact: true })).toHaveAttribute(
      "href",
      "#full-text",
    );
    await expect(main.getByRole("link", { name: "了解近邻互助组", exact: true })).toHaveAttribute(
      "href",
      "/neighbors",
    );
  }
});

test("the read-full anchor focuses its offset target and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const nativeScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
      (window as typeof window & { documentScrollBehavior?: ScrollBehavior }).documentScrollBehavior =
        typeof options === "object" ? options.behavior : undefined;
      nativeScrollIntoView.call(this, options);
    };
  });

  await page.goto("/manifesto");
  await page.getByRole("main").getByRole("link", { name: "阅读全文", exact: true }).first().click();

  const fullText = page.locator("#full-text");
  await expect(page).toHaveURL(/#full-text$/);
  await expect(fullText).toBeFocused();
  expect(await fullText.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBeGreaterThanOrEqual(
    80,
  );
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { documentScrollBehavior?: ScrollBehavior })
          .documentScrollBehavior,
    ),
  ).toBe("auto");
});

test("long-form text follows the public reading measure and rhythm", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/manifesto");

  const metrics = await page.evaluate(() => {
    const firstSection = document.querySelector<HTMLElement>("#full-1");
    const secondSection = document.querySelector<HTMLElement>("#full-2");
    const paragraphs = firstSection?.querySelectorAll<HTMLElement>(":scope > div > p");
    const firstParagraph = paragraphs?.item(0);
    const secondParagraph = paragraphs?.item(1);

    if (!firstSection || !secondSection || !firstParagraph || !secondParagraph) {
      throw new Error("Missing full-text reading structure");
    }

    const paragraphStyle = getComputedStyle(firstParagraph);
    return {
      measure: firstSection.getBoundingClientRect().width,
      fontSize: Number.parseFloat(paragraphStyle.fontSize),
      lineHeight: Number.parseFloat(paragraphStyle.lineHeight),
      paragraphGap: secondParagraph.getBoundingClientRect().top - firstParagraph.getBoundingClientRect().bottom,
      sectionGap: secondSection.getBoundingClientRect().top - firstSection.getBoundingClientRect().bottom,
    };
  });

  expect(metrics.measure).toBeLessThanOrEqual(720);
  expect(metrics.fontSize).toBe(16);
  expect(metrics.lineHeight).toBe(28);
  expect(metrics.paragraphGap).toBe(24);
  expect(metrics.sectionGap).toBeGreaterThanOrEqual(64);
});

test("document bodies fit 320px and 390px without clipping or horizontal overflow", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });

    for (const path of ["/manifesto", "/license"]) {
      await page.goto(path);

      const metrics = await page.getByRole("main").evaluate((main) => ({
        clientWidth: main.clientWidth,
        scrollWidth: main.scrollWidth,
        clippedText: Array.from(main.querySelectorAll("h1, h2, h3, p, li")).filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
        }).length,
        tocSummaryHeight: main.querySelector("details > summary")?.getBoundingClientRect().height,
      }));

      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
      expect(metrics.clippedText).toBe(0);
      expect(metrics.tocSummaryHeight).toBeGreaterThanOrEqual(44);
    }
  }
});

test("chat route opens from the homepage question entry and carries it over", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "想了解的问题" }).fill("想了解方向地图");
  await page.getByRole("button", { name: "开始了解" }).click();

  // Lands on the chat (the client strips the ?question= param after auto-sending).
  await expect(page).toHaveURL(/\/chat/);
  // The typed question is carried over and shown as the first user message.
  await expect(page.getByText("想了解方向地图")).toBeVisible();
  // The chat composer is available to keep asking, and the old placeholder is gone.
  await expect(page.getByRole("textbox", { name: "想了解的问题" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "对话入口正在接入" })).toHaveCount(0);
});

test("public shells keep canonical navigation order and route current state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const routes = [
    { path: "/", density: "full", current: undefined },
    { path: "/manifesto", density: "full", current: "为什么做" },
    { path: "/license", density: "full", current: "如何约束" },
    { path: "/chat", density: "compact", current: undefined },
    { path: "/neighbors", density: "compact", current: "近邻互助组" },
    { path: "/wam", density: "compact", current: "如何选题" },
    { path: "/wam/guide", density: "compact", current: "如何选题" },
    { path: "/wam/cell/A1", density: "compact", current: "如何选题" },
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    const header = page.locator(`header[data-density="${route.density}"]`);
    const navigation = header.getByRole("navigation", { name: "主导航" });
    const links = navigation.getByRole("link");

    await expect(header).toBeVisible();
    await expect(links).toHaveText(["近邻互助组", "为什么做", "如何选题", "如何约束"]);
    await expect(links.nth(0)).toHaveAttribute(
      "href",
      "/neighbors",
    );
    if (route.current) {
      await expect(navigation.getByRole("link", { name: route.current })).toHaveAttribute(
        "aria-current",
        "page",
      );
    } else {
      await expect(navigation.locator('[aria-current="page"]')).toHaveCount(0);
    }
  }
});

test("public shell hierarchy and full footer use the canonical navigation contract", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.locator('header[data-density="full"] [data-site-hierarchy-separator]')).toHaveCount(
    0,
  );

  const footerNavigation = page.getByRole("contentinfo").getByRole("navigation", {
    name: "页脚导航",
  });
  const footerLinks = footerNavigation.getByRole("link");
  await expect(footerLinks).toHaveText(["近邻互助组", "为什么做", "如何选题", "如何约束"]);
  for (const [index, href] of [
    "/neighbors",
    "/manifesto",
    "/wam",
    "/license",
  ].entries()) {
    await expect(footerLinks.nth(index)).toHaveAttribute("href", href);
  }

  await page.goto("/manifesto");
  await expect(page.locator('header[data-density="full"] [data-site-hierarchy-separator]')).toHaveCount(
    1,
  );
});

test("compact mobile menus expose one return path with 44px interaction targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });

  for (const route of [
    { path: "/chat", returnLabel: "返回问答首页" },
    { path: "/neighbors", returnLabel: "返回官网首页" },
    { path: "/wam/guide", returnLabel: "返回矩阵" },
    { path: "/wam/cell/A1", returnLabel: "返回矩阵" },
  ]) {
    await page.goto(route.path);
    const header = page.locator('header[data-density="compact"]');
    await header.locator("button[aria-controls]").click();

    const actions = header.getByRole("group", { name: "移动上下文操作" });
    const returnLinks = actions.getByRole("link", { name: route.returnLabel });
    await expect(returnLinks).toHaveCount(1);

    const targets = header.locator('nav[aria-label="移动主导航"] a, [aria-label="移动上下文操作"] a');
    const sizes = await targets.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test("mobile footer interaction targets remain at least 44px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });

  for (const path of ["/", "/manifesto", "/chat", "/neighbors", "/wam"]) {
    await page.goto(path);
    const sizes = await page.getByRole("contentinfo").locator("a, button").evaluateAll((elements) =>
      elements
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({ width: rect.width, height: rect.height })),
    );

    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size.width, `${path} footer target width`).toBeGreaterThanOrEqual(44);
      expect(size.height, `${path} footer target height`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("mobile navigation restores focus and full pages fit their footers at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/manifesto");

  const header = page.locator('header[data-density="full"]');
  await expect(header.getByText("数据平权宣言", { exact: true })).toBeVisible();
  const menuButton = header.locator("button[aria-controls]");
  await menuButton.click();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  const mobileNavigation = header.getByRole("navigation", { name: "移动主导航" });
  await expect(mobileNavigation.getByRole("link")).toHaveText([
    "近邻互助组",
    "为什么做当前",
    "如何选题",
    "如何约束",
  ]);

  await page.keyboard.press("Escape");
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  await expect(menuButton).toBeFocused();

  for (const path of ["/", "/chat", "/neighbors", "/manifesto", "/license"]) {
    await page.goto(path);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      footerRight: document.querySelector("footer")?.getBoundingClientRect().right,
    }));
    expect(dimensions.scrollWidth, `${path} page width`).toBeLessThanOrEqual(
      dimensions.clientWidth,
    );
    expect(dimensions.footerRight, `${path} footer edge`).toBeLessThanOrEqual(
      dimensions.clientWidth,
    );
  }
});

test("payload baseline routes are reachable", async ({ page, request }) => {
  const formLinksResponse = await request.get("/api/form-links?limit=1");
  expect(formLinksResponse.status()).toBeLessThan(500);

  const adminResponse = await page.goto("/admin");
  expect(adminResponse?.status()).toBeLessThan(500);
  await expect(page.locator("body")).not.toContainText("Application error");
});

test("full and compact shells render their matching header and footer", async ({ page }) => {
  for (const path of ["/", "/manifesto", "/license"]) {
    await page.goto(path);
    await expect(page.locator('header[data-density="full"]')).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toHaveAttribute("id", "follow");
  }

  for (const path of ["/chat", "/neighbors", "/wam"]) {
    await page.goto(path);
    await expect(page.locator('header[data-density="compact"]')).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.getByRole("contentinfo")).not.toHaveAttribute("id", "follow");
  }
});

test("neighbors is the formal single-product record with truthful canonical actions", async ({ page }) => {
  const response = await page.goto("/neighbors");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "近邻互助组", exact: true })).toBeVisible();
  await expect(
    page.getByRole("contentinfo").getByRole("link", { name: "近邻互助组", exact: true }),
  ).toHaveAttribute("href", "/neighbors");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://www.codeforpeople.cn/neighbors",
  );

  const hero = page.locator('[data-neighbors-section="affiliation"]');
  await expect(hero).toContainText("码成仝是组织与母品牌");
  await expect(hero).toContainText("码成仝当前唯一的旗舰产品");
  await expect(hero).toContainText("交互原型");
  await expect(hero).toContainText("不接真实业务数据");
  await expect(hero).toContainText("不代表服务已经上线");

  const heroActions = page.locator('[data-neighbors-actions="hero"]');
  await expect(heroActions.getByRole("link", { name: /体验近邻互助组/ })).toHaveAttribute(
    "href",
    "https://ideal.codeforpeople.cn/neighbors/prototype-customer/",
  );
  await expect(heroActions.getByRole("link", { name: /查看实施对照/ })).toHaveAttribute(
    "href",
    "https://ideal.codeforpeople.cn/neighbors/prototype-implementation/",
  );

  const header = page.getByRole("banner");
  const headerPrototypeAction = header.getByRole("link", { name: "体验原型" });
  if (!(await headerPrototypeAction.isVisible())) {
    await header.locator("button[aria-controls]").click();
  }
  await expect(headerPrototypeAction).toHaveAttribute(
    "href",
    "https://ideal.codeforpeople.cn/neighbors/prototype-customer/",
  );

  const order = await page.locator("[data-neighbors-section]").evaluateAll((sections) =>
    sections.map((section) => section.getAttribute("data-neighbors-section")),
  );
  expect(order).toEqual(["affiliation", "what", "why", "prototype", "boundary", "next"]);

  await expect(page.getByRole("heading", { name: "延伸阅读" })).toBeVisible();
  for (const path of ["/manifesto", "/wam", "/license"]) {
    await expect(page.locator(`a[href="${path}"]`).last()).toBeVisible();
  }
  await expect(page.getByText("场景探索，不是新产品", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /街坊味/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /楼道收一收/ })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("立即预约");
  await expect(page.locator("main")).not.toContainText("完成付款");
});

test("neighbors remains usable at 320px, 390px, and desktop widths", async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/neighbors");

    const metrics = await page.getByRole("main").evaluate((main) => ({
      clientWidth: main.clientWidth,
      scrollWidth: main.scrollWidth,
      clippedText: Array.from(main.querySelectorAll("h1, h2, h3, p, li")).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5;
      }).length,
      actionHeights: Array.from(main.querySelectorAll<HTMLElement>("[data-neighbors-actions] a")).map(
        (element) => element.getBoundingClientRect().height,
      ),
    }));

    expect(metrics.scrollWidth, `${width}px page width`).toBeLessThanOrEqual(metrics.clientWidth);
    expect(metrics.clippedText, `${width}px clipped text`).toBe(0);
    expect(metrics.actionHeights.length).toBeGreaterThan(0);
    for (const height of metrics.actionHeights) {
      expect(height, `${width}px CTA height`).toBeGreaterThanOrEqual(44);
    }
  }
});
