import "server-only";
import { unstable_cache } from "next/cache";
import { getPayload } from "payload";
import config from "@payload-config";
import type { ChatPageContent, FooterContent, HomepageContent, SiteDocument, SiteSettings, UiStrings } from "./types";
import {
  chatFallback,
  documentFallback,
  footerFallback,
  homepageFallback,
  settingsFallback,
  uiFallback,
} from "./fallback";
import {
  mapChatPage,
  mapDocument,
  mapFooter,
  mapHomepage,
  mapSettings,
  mapUiStrings,
  pick,
} from "./mappers";

async function client() {
  return getPayload({ config });
}

// One cached read of the single site-content global, shared by every slice. Returns null
// when Payload is empty (unseeded) or unreachable so each slice falls back to static
// content — the site never renders blank/500. Editing the global revalidates the tag.
const getCachedSiteContent = unstable_cache(
  async (): Promise<Record<string, unknown> | null> => {
    try {
      const payload = await client();
      const data = (await payload.findGlobal({ slug: "site-content" })) as Record<string, unknown>;
      const hero = data?.hero as Record<string, unknown> | undefined;
      return hero?.title ? data : null;
    } catch {
      return null;
    }
  },
  ["site-content"],
  { tags: ["payload:site-content"], revalidate: false },
);

const EMPTY = {} as Record<string, unknown>;

export async function getHomepage(): Promise<HomepageContent> {
  const mapped = mapHomepage((await getCachedSiteContent()) ?? EMPTY);
  return pick(mapped, Boolean(mapped.hero?.title), homepageFallback);
}

export async function getChatPage(): Promise<ChatPageContent> {
  const mapped = mapChatPage((await getCachedSiteContent()) ?? EMPTY);
  return pick(mapped, Boolean(mapped.heading), chatFallback);
}

export async function getUiStrings(): Promise<UiStrings> {
  const mapped = mapUiStrings((await getCachedSiteContent()) ?? EMPTY);
  return pick(mapped, Boolean(mapped.sendLabel), uiFallback);
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const mapped = mapSettings((await getCachedSiteContent()) ?? EMPTY);
  return pick(mapped, Boolean(mapped.shareTitle && mapped.brand?.logoPath), settingsFallback);
}

export async function getFooter(): Promise<FooterContent> {
  const mapped = mapFooter((await getCachedSiteContent()) ?? EMPTY);
  return pick(mapped, Boolean(mapped.copyright), footerFallback);
}

async function fetchDocument(slug: SiteDocument["slug"]): Promise<SiteDocument> {
  const payload = await client();
  const result = await payload.find({ collection: "site-documents", where: { slug: { equals: slug } }, limit: 1 });
  return mapDocument((result.docs[0] ?? {}) as Record<string, unknown>, slug);
}

export function getDocument(slug: SiteDocument["slug"]): Promise<SiteDocument> {
  return unstable_cache(
    () => safe(() => fetchDocument(slug), (d) => Boolean(d.title), documentFallback(slug)),
    ["site-document", slug],
    { tags: [`payload:doc:${slug}`], revalidate: false },
  )();
}

// Fall back to static content when a fetch returns empty/invalid (so the site never breaks).
async function safe<T>(fetcher: () => Promise<T>, isValid: (data: T) => boolean, fallback: T): Promise<T> {
  try {
    const data = await fetcher();
    return isValid(data) ? data : fallback;
  } catch {
    return fallback;
  }
}
