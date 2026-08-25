import { describe, expect, it } from "vitest";
import { neighborsPage } from "@/content/neighbors";
import {
  cards,
  mapChatPage,
  mapDocument,
  mapFooter,
  mapHomepage,
  mapNeighborsPage,
  mapSettings,
  mapUiStrings,
  pick,
  points,
  sections,
  strList,
  resolveNeighborsPage,
} from "./mappers";

describe("neighbors page content contract", () => {
  it("maps the complete structured Payload group", () => {
    const mapped = mapNeighborsPage(neighborsPage);

    expect(mapped.hero.tagline).toBe("想找靠谱的服务，先问问真正用过的人。");
    expect(mapped.howItWorks.items).toHaveLength(3);
    expect(mapped.responsibility.items).toHaveLength(3);
    expect(mapped.responsibility.example.items.map((item) => item.title)).toEqual([
      "用户分享",
      "服务者确认",
      "AI 整理",
    ]);
    expect(mapped.relatedReading.items.map((item) => item.target)).toEqual([
      "manifesto",
      "map",
      "license",
    ]);
  });

  it("falls back as one page when any CMS section is incomplete", () => {
    const incomplete = structuredClone(neighborsPage);
    incomplete.evidence.items = [];

    expect(resolveNeighborsPage(incomplete, neighborsPage)).toBe(neighborsPage);
  });

  it("accepts complete sentence-level CMS edits", () => {
    const edited = structuredClone(neighborsPage);
    edited.hero.tagline = "CMS 更新的主标语。";
    edited.howItWorks.items[0].body = "CMS 更新的第一步。";
    edited.responsibility.example.items[0].body = "CMS 更新的来源示例。";
    edited.prototype.notice = "CMS 更新的原型边界。";

    const resolved = resolveNeighborsPage(edited, neighborsPage);

    expect(resolved.hero.tagline).toBe("CMS 更新的主标语。");
    expect(resolved.howItWorks.items[0].body).toBe("CMS 更新的第一步。");
    expect(resolved.responsibility.example.items[0].body).toBe(
      "CMS 更新的来源示例。",
    );
    expect(resolved.prototype.notice).toBe("CMS 更新的原型边界。");
  });

  it("keeps related-reading destinations stable while accepting reordered copy", () => {
    const edited = structuredClone(neighborsPage);
    edited.relatedReading.items = edited.relatedReading.items
      .map((item) => ({ ...item, label: `CMS：${item.target}` }))
      .reverse();

    const resolved = resolveNeighborsPage(edited, neighborsPage);

    expect(resolved.relatedReading.items.map((item) => item.target)).toEqual([
      "manifesto",
      "map",
      "license",
    ]);
    expect(resolved.relatedReading.items.map((item) => item.label)).toEqual([
      "CMS：manifesto",
      "CMS：map",
      "CMS：license",
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
