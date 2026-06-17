import "server-only";
import { cacheLife, cacheTag } from "next/cache";
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

export async function getHomepage(): Promise<HomepageContent> {
  "use cache";
  cacheTag("payload:homepage");
  cacheLife("max");

  const payload = await client();
  const data = (await payload.findGlobal({ slug: "homepage" })) as Raw;
  const settings = await getSiteSettings();

  const lifeScenesGroup = (data.lifeScenes ?? {}) as Raw;
  const continueGroup = (data.continueReads ?? {}) as Raw;
  const continueItems: ContinueRead[] = (Array.isArray(continueGroup.items) ? continueGroup.items : []).map(
    (item) => {
      const it = item as Raw;
      const target = String(it.target ?? "manifesto");
      const href =
        target === "map" ? settings.directionMapUrl : target === "license" ? "/license" : "/manifesto";
      return {
        label: String(it.label ?? ""),
        description: String(it.description ?? ""),
        href,
        external: href.startsWith("http"),
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

export async function getChatPage(): Promise<ChatPageContent> {
  "use cache";
  cacheTag("payload:chat-page");
  cacheLife("max");
  const payload = await client();
  const data = (await payload.findGlobal({ slug: "chat-page" })) as Raw;
  return { heading: String(data.heading ?? ""), intro: String(data.intro ?? "") };
}

export async function getUiStrings(): Promise<UiStrings> {
  "use cache";
  cacheTag("payload:ui-strings");
  cacheLife("max");
  const payload = await client();
  return (await payload.findGlobal({ slug: "ui-strings" })) as unknown as UiStrings;
}

export async function getSiteSettings(): Promise<SiteSettings> {
  "use cache";
  cacheTag("payload:site-settings");
  cacheLife("max");
  const payload = await client();
  return (await payload.findGlobal({ slug: "site-settings" })) as unknown as SiteSettings;
}

export async function getFooter(): Promise<FooterContent> {
  "use cache";
  cacheTag("payload:footer");
  cacheLife("max");
  const payload = await client();
  return (await payload.findGlobal({ slug: "footer" })) as unknown as FooterContent;
}

export async function getDocument(slug: SiteDocument["slug"]): Promise<SiteDocument> {
  "use cache";
  cacheTag(`payload:doc:${slug}`);
  cacheLife("max");
  const payload = await client();
  const result = await payload.find({ collection: "site-documents", where: { slug: { equals: slug } }, limit: 1 });
  const doc = (result.docs[0] ?? {}) as Raw;
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
    fullSections: sections(doc.fullSections).length ? sections(doc.fullSections) : undefined,
  };
}
