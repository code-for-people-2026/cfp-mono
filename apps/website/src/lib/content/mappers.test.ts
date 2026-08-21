import { describe, expect, it } from "vitest";
import { neighborsProduct } from "@/content/neighbors";
import {
  cards,
  mapChatPage,
  mapDocument,
  mapFooter,
  mapFeaturedProduct,
  mapHomepage,
  mapSettings,
  mapUiStrings,
  pick,
  points,
  sections,
  strList,
  resolveFeaturedProduct,
} from "./mappers";

describe("featured product content contract", () => {
  it("maps the complete CMS-shaped singleton record", () => {
    const mapped = mapFeaturedProduct(neighborsProduct);

    expect(mapped.name).toBe("近邻互助组");
    expect(mapped.prototype.steps).toHaveLength(4);
    expect(mapped.prototype.steps[2].responsibility).toBe("ai");
    expect(mapped.relatedReading.map((item) => item.href)).toEqual([
      "/manifesto",
      "/wam",
      "/license",
    ]);
  });

  it("falls back as one record when CMS content is incomplete", () => {
    const incomplete = { ...neighborsProduct, boundaries: { heading: "", summary: "", points: [] } };

    expect(resolveFeaturedProduct(incomplete, neighborsProduct)).toBe(neighborsProduct);
  });

  it("keeps canonical identity and CTA routes stable across CMS edits", () => {
    const edited = structuredClone(neighborsProduct);
    edited.name = "漂移名称";
    edited.organizationRole = "漂移母品牌";
    edited.brandRelationship = "漂移产品关系";
    edited.canonicalUrl = "https://example.com/wrong";
    edited.discoveryQuestion.value = "漂移问题";
    edited.stage.label = "已经上线";
    edited.primaryAction.href = "https://example.com/customer";
    edited.secondaryAction.href = "/wrong";
    edited.implementationAction.href = "https://example.com/implementation";
    edited.relatedReading[0].href = "/wrong-reading";
    edited.sceneExplorations[0].href = "https://example.com/scene";
    edited.motivation.summary = "一段经过 CMS 更新、但仍满足完整契约的说明。";

    const resolved = resolveFeaturedProduct(edited, neighborsProduct);

    expect(resolved.motivation.summary).toContain("CMS 更新");
    expect(resolved.name).toBe(neighborsProduct.name);
    expect(resolved.organizationRole).toBe(neighborsProduct.organizationRole);
    expect(resolved.brandRelationship).toBe(neighborsProduct.brandRelationship);
    expect(resolved.discoveryQuestion).toBe(neighborsProduct.discoveryQuestion);
    expect(resolved.stage).toBe(neighborsProduct.stage);
    expect(resolved.canonicalUrl).toBe(neighborsProduct.canonicalUrl);
    expect(resolved.primaryAction.href).toBe(neighborsProduct.primaryAction.href);
    expect(resolved.secondaryAction.href).toBe(neighborsProduct.secondaryAction.href);
    expect(resolved.implementationAction.href).toBe(neighborsProduct.implementationAction.href);
    expect(resolved.relatedReading.map((item) => item.href)).toEqual(
      neighborsProduct.relatedReading.map((item) => item.href),
    );
    expect(resolved.sceneExplorations.map((item) => item.href)).toEqual(
      neighborsProduct.sceneExplorations.map((item) => item.href),
    );
  });

  it("matches reordered CMS links by canonical href and keeps their public identity", () => {
    const edited = structuredClone(neighborsProduct);
    edited.primaryAction.label = "漂移的客户入口";
    edited.primaryAction.description = "CMS 更新的客户入口说明。";
    edited.relatedReading = edited.relatedReading
      .map((item) => ({ ...item, description: `CMS 更新：${item.href}` }))
      .reverse();
    edited.sceneExplorations = edited.sceneExplorations
      .map((item) => ({ ...item, description: `CMS 更新：${item.href}` }))
      .reverse();

    const resolved = resolveFeaturedProduct(edited, neighborsProduct);

    expect(resolved.primaryAction).toEqual({
      ...neighborsProduct.primaryAction,
      description: "CMS 更新的客户入口说明。",
    });
    expect(resolved.relatedReading).toEqual(
      neighborsProduct.relatedReading.map((item) => ({
        ...item,
        description: `CMS 更新：${item.href}`,
      })),
    );
    expect(resolved.sceneExplorations).toEqual(
      neighborsProduct.sceneExplorations.map((item) => ({
        ...item,
        description: `CMS 更新：${item.href}`,
      })),
    );
  });

  it("uses each fallback link when its canonical URL is tampered with or missing", () => {
    const edited = structuredClone(neighborsProduct);
    edited.primaryAction.href = "https://example.com/customer";
    edited.primaryAction.description = "不应采用的篡改入口说明。";
    edited.secondaryAction.href = "";
    edited.secondaryAction.description = "不应采用的缺失入口说明。";
    edited.implementationAction.label = "漂移的实施入口";
    edited.implementationAction.description = "CMS 更新的实施入口说明。";
    edited.relatedReading[0].description = "CMS 更新的宣言说明。";
    edited.relatedReading[1].href = "/wrong-reading";
    edited.relatedReading[1].description = "不应采用的篡改阅读说明。";
    edited.sceneExplorations[0].description = "CMS 更新的街坊味说明。";
    edited.sceneExplorations = [edited.sceneExplorations[0]];

    const resolved = resolveFeaturedProduct(edited, neighborsProduct);

    expect(resolved.primaryAction).toEqual(neighborsProduct.primaryAction);
    expect(resolved.secondaryAction).toEqual(neighborsProduct.secondaryAction);
    expect(resolved.implementationAction).toEqual({
      ...neighborsProduct.implementationAction,
      description: "CMS 更新的实施入口说明。",
    });
    expect(resolved.relatedReading).toEqual([
      { ...neighborsProduct.relatedReading[0], description: "CMS 更新的宣言说明。" },
      neighborsProduct.relatedReading[1],
      neighborsProduct.relatedReading[2],
    ]);
    expect(resolved.sceneExplorations).toEqual([
      { ...neighborsProduct.sceneExplorations[0], description: "CMS 更新的街坊味说明。" },
      neighborsProduct.sceneExplorations[1],
    ]);
  });
});

describe("strList", () => {
  it("reads a plain string[] (the json shape)", () => {
    expect(strList(["a", "b"])).toEqual(["a", "b"]);
  });

  it("tolerates legacy [{text}] shapes from hand-edited json", () => {
    expect(strList([{ text: "a" }, { text: "b" }])).toEqual(["a", "b"]);
  });

  it("tolerates legacy [{tag}] shapes (life-scenes tags)", () => {
    expect(strList([{ tag: "x" }])).toEqual(["x"]);
  });

  it("drops empty / non-array input", () => {
    expect(strList(undefined)).toEqual([]);
    expect(strList(null)).toEqual([]);
    expect(strList(["a", "", "b"])).toEqual(["a", "b"]);
  });
});

describe("points", () => {
  it("returns undefined when empty (so the field is omitted downstream)", () => {
    expect(points([])).toBeUndefined();
    expect(points(undefined)).toBeUndefined();
  });
  it("returns the list when non-empty", () => {
    expect(points(["a"])).toEqual(["a"]);
  });
});

describe("sections", () => {
  it("maps json sections, unwrapping paragraphs/points and making label optional", () => {
    const out = sections([
      { heading: "h", paragraphs: ["p1", "p2"], points: ["q1"] },
      { label: "2.", heading: "h2", paragraphs: ["p"] },
    ]);
    expect(out).toEqual([
      { label: undefined, heading: "h", paragraphs: ["p1", "p2"], points: ["q1"] },
      { label: "2.", heading: "h2", paragraphs: ["p"], points: undefined },
    ]);
  });
});

describe("cards", () => {
  it("maps {title, body} objects defensively", () => {
    expect(cards([{ title: "t", body: "b" }])).toEqual([{ title: "t", body: "b" }]);
    expect(cards(undefined)).toEqual([]);
  });
});

describe("mapHomepage", () => {
  const data = {
    hero: { title: "你好" },
    dialogueEntry: { prompt: "p" },
    dialogueSuggestions: [{ label: "l", value: "v" }],
    heroFlow: [{ title: "t", body: "b" }],
    identity: { heading: "h", intro: "i", cards: [{ title: "c", body: "d" }] },
    whyNow: { heading: "h", intro: "i", points: [{ title: "t", body: "b" }] },
    lifeScenes: { heading: "h", intro: "i", scenes: [{ title: "s", body: "b", tags: ["x", "y"] }] },
    direction: { heading: "h", intro: "i", points: [] },
    selfRestraint: { heading: "h", intro: "i", points: [] },
    continueReads: {
      heading: "h",
      intro: "i",
      items: [
        { label: "a", description: "d", target: "manifesto" },
        { label: "b", description: "d", target: "bogus" },
        { label: "c", description: "d", target: "map" },
      ],
    },
  };

  it("maps groups, card lists, and renames scenes→items with tags", () => {
    const out = mapHomepage(data);
    expect(out.hero.title).toBe("你好");
    expect(out.identity.items).toEqual([{ title: "c", body: "d" }]);
    expect(out.lifeScenes.items[0].tags).toEqual(["x", "y"]);
  });

  it("coerces unknown continueReads target to manifesto", () => {
    const out = mapHomepage(data);
    expect(out.continueReads.items.map((i) => i.target)).toEqual(["manifesto", "manifesto", "map"]);
  });
});

describe("mapChatPage", () => {
  it("renames chatHeading/chatIntro → heading/intro", () => {
    expect(mapChatPage({ chatHeading: "H", chatIntro: "I" })).toEqual({ heading: "H", intro: "I" });
  });
});

describe("mapUiStrings", () => {
  it("maps all micro-copy fields", () => {
    const out = mapUiStrings({ sendLabel: "发送", backToHome: "回首页" });
    expect(out.sendLabel).toBe("发送");
    expect(out.backToHome).toBe("回首页");
    expect(out.chatDisclaimer).toBe("");
  });
});

describe("mapSettings", () => {
  it("maps brand group and headerNav list", () => {
    const out = mapSettings({
      shareTitle: "T",
      shareDescription: "D",
      directionMapUrl: "/wam",
      githubUrl: "gh",
      brand: { wordmark: "码成仝", tagline: "副", logoPath: "/l.png", logoAlt: "alt" },
      headerNav: [{ label: "n", href: "/h" }],
    });
    expect(out.brand.wordmark).toBe("码成仝");
    expect(out.headerNav).toEqual([{ label: "n", href: "/h" }]);
  });
});

describe("mapFooter", () => {
  it("coerces unknown channel iconKey to douyin and drops empty beian", () => {
    const out = mapFooter({
      description: "d",
      linksHeading: "lh",
      footerLinks: [{ label: "l", href: "/" }],
      channelsHeading: "ch",
      channels: [
        { label: "抖音", iconKey: "douyin", status: "s", description: "dd" },
        { label: "x", iconKey: "weird", status: "s", description: "dd", qrPath: "/q.png" },
      ],
      githubLabel: "GitHub",
      beian: "",
      copyright: "© 2026",
    });
    expect(out.channels.map((c) => c.iconKey)).toEqual(["douyin", "douyin"]);
    expect(out.channels[1].qrPath).toBe("/q.png");
    expect(out.beian).toBeUndefined();
    expect(out.copyright).toBe("© 2026");
  });
});

describe("mapDocument", () => {
  it("maps guide/sections/fullSections from json shapes", () => {
    const out = mapDocument(
      {
        eyebrow: "eb",
        title: "t",
        summary: "s",
        guide: ["g1"],
        sections: [{ heading: "h", paragraphs: ["p"] }],
        fullSections: [{ heading: "fh", paragraphs: ["fp"], points: ["q"] }],
        fullTitle: "ft",
        closing: "c",
      },
      "manifesto",
    );
    expect(out.slug).toBe("manifesto");
    expect(out.guide).toEqual(["g1"]);
    expect(out.sections[0].paragraphs).toEqual(["p"]);
    expect(out.fullSections?.[0].points).toEqual(["q"]);
  });

  it("omits fullSections when empty", () => {
    const out = mapDocument({ title: "t", sections: [] }, "license");
    expect(out.fullSections).toBeUndefined();
  });
});

describe("pick", () => {
  it("returns mapped when ok, else fallback", () => {
    expect(pick("a", true, "b")).toBe("a");
    expect(pick("a", false, "b")).toBe("b");
  });
});
