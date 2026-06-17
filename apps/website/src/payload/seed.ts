import type { Payload } from "payload";
import {
  brandAssets,
  continueReads,
  directionApproach,
  directionMapHref,
  dialogueEntry,
  dialogueSuggestions,
  hero,
  heroFlow,
  identityCards,
  identityIntro,
  license,
  lifeScenes,
  lifeScenesIntro,
  manifesto,
  map,
  selfRestraints,
  siteMetadata,
  socialChannels,
  whyNowPoints,
  type DocumentContent,
} from "@/content/site";

const text = (items: string[] = []) => items.map((value) => ({ text: value }));
const card = (item: { title: string; body: string }) => ({ title: item.title, body: item.body });

const sections = (list: DocumentContent["sections"] = []) =>
  list.map((s) => ({
    label: s.label,
    heading: s.heading,
    paragraphs: text(s.paragraphs),
    points: text(s.points ?? []),
  }));

function documentData(doc: DocumentContent, slug: string) {
  return {
    slug,
    eyebrow: doc.eyebrow,
    title: doc.title,
    summary: doc.summary,
    meta: doc.meta,
    source: doc.source,
    guide: text(doc.guide ?? []),
    sections: sections(doc.sections),
    closing: doc.closing,
    fullTitle: doc.fullTitle,
    fullSections: sections(doc.fullSections ?? []),
    _status: "published" as const,
  };
}

const iconKeyByLabel: Record<string, "douyin" | "kuaishou" | "bilibili"> = {
  抖音: "douyin",
  快手: "kuaishou",
  B站: "bilibili",
};

// Seed all site copy into Payload from the current static content, published.
// Guarded by PAYLOAD_SEED so it only runs when explicitly requested.
export async function seedSiteContent(payload: Payload) {
  await payload.updateGlobal({
    slug: "homepage",
    data: {
      hero,
      dialogueEntry,
      dialogueSuggestions: dialogueSuggestions.map((s) => ({ label: s.label, value: s.value })),
      heroFlow: heroFlow.map(card),
      identity: { heading: identityIntro.title, intro: identityIntro.body, cards: identityCards.map(card) },
      whyNow: {
        heading: "规则背后，是红利怎么分",
        intro:
          "路线、订单、评价和流水从普通人的实践中产生，却常常变成平台的规则优势。软件越有能力，越要追问这些红利该回到谁那里。",
        points: whyNowPoints.map(card),
      },
      lifeScenes: {
        heading: lifeScenesIntro.title,
        intro: lifeScenesIntro.body,
        scenes: lifeScenes.map((s) => ({ title: s.title, body: s.body, tags: s.tags.map((tag) => ({ tag })) })),
      },
      direction: {
        heading: "我们怎么判断方向",
        intro:
          "牛马能力剥夺矩阵按 7 类处境 × 7 种能力展开：横轴看人的处境，纵轴看能力缺口。它提醒我们先理解问题，再判断什么值得做。",
        points: directionApproach.map(card),
      },
      selfRestraint: {
        heading: "我们如何约束自己",
        intro: "软件要服务普通人，组织也要先约束自己。让利、资金、分配和修正过程，都应该公开留痕。",
        points: selfRestraints.map(card),
      },
      continueReads: {
        heading: "继续阅读",
        intro:
          "想更深入了解，可以顺着这三份已经公开的文本读下去：数据平权宣言讲为什么，牛马能力剥夺矩阵讲做什么，牛马互助协议讲怎么约束自己。",
        items: continueReads.map((item) => ({
          label: item.label,
          description: item.description,
          target: item.href === "/manifesto" ? "manifesto" : item.href === "/license" ? "license" : "map",
        })),
      },
      _status: "published",
    },
  });

  await payload.updateGlobal({
    slug: "chat-page",
    data: {
      heading: "从一个问题开始了解码成工",
      intro: "这里基于已经公开的文本回答。可以直接提问，也可以先从下面几个问题开始。",
      _status: "published",
    },
  });

  await payload.updateGlobal({
    slug: "ui-strings",
    data: {
      backToHome: "回到首页",
      sendLabel: dialogueEntry.submitLabel,
      chatRestart: "重新开始",
      chatLoading: "正在组织回答…",
      chatDisclaimer: "内容由 AI 基于公开文本生成，请仔细甄别。",
      chatAssistantName: "码成工助手",
      chatUserName: "你",
      chatPlaceholder: dialogueEntry.placeholder,
      chatResetConfirm: "清空这次对话？内容只保存在本机浏览器。",
      _status: "published",
    },
  });

  await payload.updateGlobal({
    slug: "site-settings",
    data: {
      shareTitle: siteMetadata.title,
      shareDescription: siteMetadata.description,
      directionMapUrl: directionMapHref,
      githubUrl: "https://github.com/code-for-people-2026",
      brand: {
        wordmark: "码成工",
        tagline: "为“工友”敲键盘",
        logoPath: brandAssets.logoSrc,
        logoAlt: "码成工 logo",
      },
      headerNav: [
        { label: "数据平权宣言", href: "/manifesto" },
        { label: "牛马能力剥夺矩阵", href: directionMapHref },
        { label: "牛马互助协议", href: "/license" },
      ],
      _status: "published",
    },
  });

  await payload.updateGlobal({
    slug: "footer",
    data: {
      description:
        "软件也是一种服务。我们把理念、协议和方向公开出来，继续学习如何把技术能力还给真实生活。",
      linksHeading: "网站链接",
      footerLinks: [
        { label: "首页", href: "/" },
        { label: "数据平权宣言", href: "/manifesto" },
        { label: "牛马能力剥夺矩阵", href: directionMapHref },
        { label: "牛马互助协议", href: "/license" },
      ],
      channelsHeading: "公开渠道",
      channels: socialChannels.map((c) => ({
        label: c.label,
        iconKey: iconKeyByLabel[c.label] ?? "douyin",
        status: c.status,
        description: c.description,
        qrPath: c.qrSrc ?? undefined,
        qrAlt: c.qrSrc ? `${c.label}二维码` : undefined,
      })),
      githubLabel: "GitHub",
      complianceHeading: "合规信息",
      beian: "备案信息待补充",
      copyright: "© 2026 码成工",
      _status: "published",
    },
  });

  for (const [doc, slug] of [
    [manifesto, "manifesto"],
    [license, "license"],
    [map, "map"],
  ] as const) {
    const existing = await payload.find({
      collection: "site-documents",
      where: { slug: { equals: slug } },
      limit: 1,
    });
    const data = documentData(doc, slug);
    if (existing.docs[0]) {
      await payload.update({ collection: "site-documents", id: existing.docs[0].id, data });
    } else {
      await payload.create({ collection: "site-documents", data });
    }
  }

  payload.logger.info("Seeded site content into Payload.");
}
