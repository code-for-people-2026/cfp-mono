import "server-only";
import { unstable_cache } from "next/cache";
import { getPayload } from "payload";
import config from "@payload-config";
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
import {
  chatFallback,
  documentFallback,
  footerFallback,
  homepageFallback,
  settingsFallback,
  uiFallback,
} from "./fallback";

type Raw = Record<string, unknown>;

async function client() {
  return getPayload({ config });
}

function paragraphs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String((item as Raw)?.text ?? "")).filter(Boolean)
    : [];
}

function points(value: unknown): string[] | undefined {
  const list = paragraphs(value);
  return list.length ? list : undefined;
}

function sections(value: unknown): DocSection[] {
  return Array.isArray(value)
    ? value.map((item) => {
        const s = item as Raw;
        return {
          label: (s.label as string) || undefined,
          heading: String(s.heading ?? ""),
          paragraphs: paragraphs(s.paragraphs),
          points: points(s.points),
        };
      })
    : [];
}

function cards(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => ({ title: String((item as Raw).title ?? ""), body: String((item as Raw).body ?? "") }))
    : [];
}

function block(value: unknown, key: string) {
  const g = (value ?? {}) as Raw;
  return { heading: String(g.heading ?? ""), intro: String(g.intro ?? ""), items: cards(g[key]) };
}

async function fetchHomepage(): Promise<HomepageContent> {
  const payload = await client();
  const data = (await payload.findGlobal({ slug: "homepage" })) as Raw;
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
          tags: (Array.isArray(s.tags) ? s.tags : []).map((t) => String((t as Raw).tag ?? "")),
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

async function fetchDocument(slug: SiteDocument["slug"]): Promise<SiteDocument> {
  const payload = await client();
  const result = await payload.find({ collection: "site-documents", where: { slug: { equals: slug } }, limit: 1 });
  const doc = (result.docs[0] ?? {}) as Raw;
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

async function fetchGlobal<T>(slug: string): Promise<T> {
  const payload = await client();
  return (await payload.findGlobal({ slug })) as unknown as T;
}

// Until prod is seeded, a global/doc may be empty — fall back to static content so the
// site never renders blank/500. Publishing (revalidateTag) flips the cache to real data.
export const getHomepage = unstable_cache(
  async () => {
    const data = await fetchHomepage();
    return data.hero?.title ? data : homepageFallback;
  },
  ["homepage"],
  { tags: ["payload:homepage"], revalidate: false },
);

export const getChatPage = unstable_cache(
  async () => {
    const data = await fetchGlobal<ChatPageContent>("chat-page");
    return data?.heading ? data : chatFallback;
  },
  ["chat-page"],
  { tags: ["payload:chat-page"], revalidate: false },
);

export const getUiStrings = unstable_cache(
  async () => {
    const data = await fetchGlobal<UiStrings>("ui-strings");
    return data?.sendLabel ? data : uiFallback;
  },
  ["ui-strings"],
  { tags: ["payload:ui-strings"], revalidate: false },
);

export const getSiteSettings = unstable_cache(
  async () => {
    const data = await fetchGlobal<SiteSettings>("site-settings");
    return data?.shareTitle && data?.brand?.logoPath ? data : settingsFallback;
  },
  ["site-settings"],
  { tags: ["payload:site-settings"], revalidate: false },
);

export const getFooter = unstable_cache(
  async () => {
    const data = await fetchGlobal<FooterContent>("footer");
    return data?.copyright ? data : footerFallback;
  },
  ["footer"],
  { tags: ["payload:footer"], revalidate: false },
);

export function getDocument(slug: SiteDocument["slug"]): Promise<SiteDocument> {
  return unstable_cache(
    async () => {
      const data = await fetchDocument(slug);
      return data.title ? data : documentFallback(slug);
    },
    ["site-document", slug],
    { tags: [`payload:doc:${slug}`], revalidate: false },
  )();
}
