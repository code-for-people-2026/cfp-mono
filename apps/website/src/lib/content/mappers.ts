// Pure mapping helpers that turn the raw `site-content` global / `site-documents` rows
// (json-shaped) into the typed contracts in types.ts. Kept separate from index.ts so they
// can be unit-tested without Next's cache / server-only runtime.
import type {
  ChatPageContent,
  ContinueRead,
  DocSection,
  FooterContent,
  HomepageContent,
  NeighborsPageContent,
  SiteDocument,
  SiteSettings,
  UiStrings,
} from "./types";

type Raw = Record<string, unknown>;

function raw(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function mapNeighborsSection(value: unknown) {
  const section = raw(value);
  return {
    heading: String(section.heading ?? ""),
    intro: String(section.intro ?? ""),
    items: cards(section.items),
  };
}

function mapRelatedReading(value: unknown): ContinueRead[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const link = raw(item);
    const target = String(link.target ?? "manifesto");
    return {
      label: String(link.label ?? ""),
      description: String(link.description ?? ""),
      target: (target === "map" || target === "license" ? target : "manifesto") as ContinueRead["target"],
    };
  });
}

export function mapNeighborsPage(value: unknown): NeighborsPageContent {
  const page = raw(value);
  const hero = raw(page.hero);
  const cta = raw(page.cta);
  const responsibility = raw(page.responsibility);
  const responsibilityExample = raw(responsibility.example);
  const prototype = raw(page.prototype);
  const relatedReading = raw(page.relatedReading);

  return {
    hero: {
      stageLabel: String(hero.stageLabel ?? ""),
      eyebrow: String(hero.eyebrow ?? ""),
      tagline: String(hero.tagline ?? ""),
      summary: String(hero.summary ?? ""),
      distinction: String(hero.distinction ?? ""),
      affiliation: String(hero.affiliation ?? ""),
    },
    cta: {
      label: String(cta.label ?? ""),
      description: String(cta.description ?? ""),
    },
    howItWorks: mapNeighborsSection(page.howItWorks),
    evidence: mapNeighborsSection(page.evidence),
    responsibility: {
      ...mapNeighborsSection(responsibility),
      example: {
        heading: String(responsibilityExample.heading ?? ""),
        request: String(responsibilityExample.request ?? ""),
        items: cards(responsibilityExample.items),
      },
    },
    prototype: {
      eyebrow: String(prototype.eyebrow ?? ""),
      heading: String(prototype.heading ?? ""),
      intro: String(prototype.intro ?? ""),
      notice: String(prototype.notice ?? ""),
    },
    relatedReading: {
      heading: String(relatedReading.heading ?? ""),
      intro: String(relatedReading.intro ?? ""),
      items: mapRelatedReading(relatedReading.items),
    },
  };
}

function completeNeighborsSection(
  mapped: NeighborsPageContent["howItWorks"],
  fallback: NeighborsPageContent["howItWorks"],
) {
  return Boolean(
    mapped.heading &&
      mapped.intro &&
      mapped.items.length === fallback.items.length &&
      mapped.items.every((item) => item.title && item.body),
  );
}

// Visitor copy is accepted only as one complete page. A half-edited CMS group falls back
// to the approved static record, so a publish can never leave a public section blank.
export function resolveNeighborsPage(
  value: unknown,
  fallback: NeighborsPageContent,
): NeighborsPageContent {
  const mapped = mapNeighborsPage(value);
  const sections = [
    [mapped.howItWorks, fallback.howItWorks],
    [mapped.evidence, fallback.evidence],
    [mapped.responsibility, fallback.responsibility],
  ] as const;
  const complete = Boolean(
    mapped.hero.stageLabel &&
      mapped.hero.eyebrow &&
      mapped.hero.tagline &&
      mapped.hero.summary &&
      mapped.hero.distinction &&
      mapped.hero.affiliation &&
      mapped.cta.label &&
      mapped.cta.description &&
      sections.every(([section, fallbackSection]) =>
        completeNeighborsSection(section, fallbackSection),
      ) &&
      mapped.responsibility.example.heading &&
      mapped.responsibility.example.request &&
      mapped.responsibility.example.items.length ===
        fallback.responsibility.example.items.length &&
      mapped.responsibility.example.items.every((item) => item.title && item.body) &&
      mapped.prototype.eyebrow &&
      mapped.prototype.heading &&
      mapped.prototype.intro &&
      mapped.prototype.notice &&
      mapped.relatedReading.heading &&
      mapped.relatedReading.intro &&
      mapped.relatedReading.items.length === fallback.relatedReading.items.length &&
      mapped.relatedReading.items.every((item) => item.label && item.description),
  );

  if (!complete) return fallback;

  return {
    ...mapped,
    relatedReading: {
      ...mapped.relatedReading,
      items: fallback.relatedReading.items.map((fallbackItem) => {
        const match = mapped.relatedReading.items.find(
          (item) => item.target === fallbackItem.target,
        );
        return match ? { ...match, target: fallbackItem.target } : fallbackItem;
      }),
    },
  };
}

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
