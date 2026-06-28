// Pure mapping helpers that turn the raw `site-content` global / `site-documents` rows
// (json-shaped) into the typed contracts in types.ts. Kept separate from index.ts so they
// can be unit-tested without Next's cache / server-only runtime.
import type {
  ChatPageContent,
  ContinueRead,
  DocSection,
  FooterContent,
  HomepageContent,
  SiteDocument,
  SiteSettings,
  UiStrings,
} from "./types";

type Raw = Record<string, unknown>;

// Tolerant string-list reader: accepts `string[]` (the json shape) as well as legacy
// `[{ text }]` / `[{ tag }]` (defensive against hand-edited JSON in the admin).
export function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const obj = item as Raw;
      return String(obj?.text ?? obj?.tag ?? "");
    })
    .filter(Boolean);
}

export function points(value: unknown): string[] | undefined {
  const list = strList(value);
  return list.length ? list : undefined;
}

export function sections(value: unknown): DocSection[] {
  return Array.isArray(value)
    ? value.map((item) => {
        const s = item as Raw;
        return {
          label: (s.label as string) || undefined,
          heading: String(s.heading ?? ""),
          paragraphs: strList(s.paragraphs),
          points: points(s.points),
        };
      })
    : [];
}

export function cards(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => ({ title: String((item as Raw).title ?? ""), body: String((item as Raw).body ?? "") }))
    : [];
}

export function block(value: unknown, key: string) {
  const g = (value ?? {}) as Raw;
  return { heading: String(g.heading ?? ""), intro: String(g.intro ?? ""), items: cards(g[key]) };
}

export function mapHomepage(data: Raw): HomepageContent {
  const lifeScenesGroup = (data.lifeScenes ?? {}) as Raw;
  const continueGroup = (data.continueReads ?? {}) as Raw;

  const continueItems: ContinueRead[] = (Array.isArray(continueGroup.items) ? continueGroup.items : []).map(
    (item) => {
      const it = item as Raw;
      const target = String(it.target ?? "manifesto");
      return {
        label: String(it.label ?? ""),
        description: String(it.description ?? ""),
        target: (target === "map" || target === "license" ? target : "manifesto") as ContinueRead["target"],
      };
    },
  );

  return {
    hero: (data.hero ?? {}) as HomepageContent["hero"],
    dialogueEntry: (data.dialogueEntry ?? {}) as HomepageContent["dialogueEntry"],
    dialogueSuggestions: (Array.isArray(data.dialogueSuggestions) ? data.dialogueSuggestions : []).map(
      (item) => ({ label: String((item as Raw).label ?? ""), value: String((item as Raw).value ?? "") }),
    ),
    heroFlow: cards(data.heroFlow),
    identity: block(data.identity, "cards"),
    whyNow: block(data.whyNow, "points"),
    lifeScenes: {
      heading: String(lifeScenesGroup.heading ?? ""),
      intro: String(lifeScenesGroup.intro ?? ""),
      items: (Array.isArray(lifeScenesGroup.scenes) ? lifeScenesGroup.scenes : []).map((item) => {
        const s = item as Raw;
        return {
          title: String(s.title ?? ""),
          body: String(s.body ?? ""),
          tags: strList(s.tags),
        };
      }),
    },
    direction: block(data.direction, "points"),
    selfRestraint: block(data.selfRestraint, "points"),
    continueReads: {
      heading: String(continueGroup.heading ?? ""),
      intro: String(continueGroup.intro ?? ""),
      items: continueItems,
    },
  };
}

export function mapChatPage(data: Raw): ChatPageContent {
  return { heading: String(data.chatHeading ?? ""), intro: String(data.chatIntro ?? "") };
}

export function mapUiStrings(data: Raw): UiStrings {
  return {
    backToHome: String(data.backToHome ?? ""),
    sendLabel: String(data.sendLabel ?? ""),
    chatRestart: String(data.chatRestart ?? ""),
    chatLoading: String(data.chatLoading ?? ""),
    chatDisclaimer: String(data.chatDisclaimer ?? ""),
    chatAssistantName: String(data.chatAssistantName ?? ""),
    chatUserName: String(data.chatUserName ?? ""),
    chatPlaceholder: String(data.chatPlaceholder ?? ""),
    chatResetConfirm: String(data.chatResetConfirm ?? ""),
  };
}

export function mapSettings(data: Raw): SiteSettings {
  return {
    shareTitle: String(data.shareTitle ?? ""),
    shareDescription: String(data.shareDescription ?? ""),
    directionMapUrl: String(data.directionMapUrl ?? ""),
    githubUrl: String(data.githubUrl ?? ""),
    brand: (data.brand ?? {}) as SiteSettings["brand"],
    headerNav: (Array.isArray(data.headerNav) ? data.headerNav : []).map((item) => {
      const n = item as Raw;
      return { label: String(n.label ?? ""), href: String(n.href ?? "") };
    }),
  };
}

export function mapFooter(data: Raw): FooterContent {
  return {
    description: String(data.description ?? ""),
    linksHeading: String(data.linksHeading ?? ""),
    footerLinks: (Array.isArray(data.footerLinks) ? data.footerLinks : []).map((item) => {
      const l = item as Raw;
      return { label: String(l.label ?? ""), href: String(l.href ?? "") };
    }),
    channelsHeading: String(data.channelsHeading ?? ""),
    channels: (Array.isArray(data.channels) ? data.channels : []).map((item) => {
      const c = item as Raw;
      const iconKey = String(c.iconKey ?? "douyin");
      return {
        label: String(c.label ?? ""),
        iconKey: (iconKey === "kuaishou" || iconKey === "bilibili" ? iconKey : "douyin") as FooterContent["channels"][number]["iconKey"],
        status: String(c.status ?? ""),
        description: String(c.description ?? ""),
        qrPath: (c.qrPath as string) || undefined,
        qrAlt: (c.qrAlt as string) || undefined,
      };
    }),
    githubLabel: String(data.githubLabel ?? ""),
    beian: (data.beian as string) || undefined,
    copyright: String(data.copyright ?? ""),
  };
}

export function mapDocument(doc: Raw, slug: SiteDocument["slug"]): SiteDocument {
  const full = sections(doc.fullSections);
  return {
    slug,
    eyebrow: String(doc.eyebrow ?? ""),
    title: String(doc.title ?? ""),
    summary: String(doc.summary ?? ""),
    meta: (doc.meta as string) || undefined,
    source: (doc.source as string) || undefined,
    guide: points(doc.guide),
    sections: sections(doc.sections),
    closing: (doc.closing as string) || undefined,
    fullTitle: (doc.fullTitle as string) || undefined,
    fullSections: full.length ? full : undefined,
  };
}

export function pick<T>(mapped: T, ok: boolean, fallback: T): T {
  return ok ? mapped : fallback;
}
