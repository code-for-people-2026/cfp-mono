import "server-only";
import { unstable_cache } from "next/cache";
import { getPayload } from "payload";
import config from "@payload-config";
import { SITE_CONTENT_CACHE_KEY, siteDocumentCacheKey } from "./cache-keys";
import type { ChatPageContent, FooterContent, HomepageContent, NeighborsPageContent, SiteDocument, SiteSettings, UiStrings } from "./types";
import {
  chatFallback,
  documentFallback,
  footerFallback,
  homepageFallback,
  neighborsPageFallback,
  settingsFallback,
  uiFallback,
} from "./fallback";
import {
  mapChatPage,
  mapDocument,
  mapFooter,
  mapHomepage,
  resolveNeighborsPage,
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
  SITE_CONTENT_CACHE_KEY,
  { tags: ["payload:site-content"], revalidate: false },
);

const EMPTY = {} as Record<string, unknown>;
const UNPUBLISHED_NEIGHBORS_QUESTION = "近邻互助组是什么？";

export async function getHomepage(): Promise<HomepageContent> {
  const mapped = mapHomepage((await getCachedSiteContent()) ?? EMPTY);
  const homepage = pick(mapped, Boolean(mapped.hero?.title), homepageFallback);

  // TODO(neighbors): Remove this release gate when the separately reviewed
  // /neighbors page and its public discovery entry are ready to ship together.
  return {
    ...homepage,
    dialogueSuggestions: homepage.dialogueSuggestions.filter(
      ({ label, value }) =>
        label !== UNPUBLISHED_NEIGHBORS_QUESTION && value !== UNPUBLISHED_NEIGHBORS_QUESTION,
    ),
  };
}

export async function getChatPage(): Promise<ChatPageContent> {
  const mapped = mapChatPage((await getCachedSiteContent()) ?? EMPTY);
  return pick(mapped, Boolean(mapped.heading), chatFallback);
}

export async function getNeighborsPage(): Promise<NeighborsPageContent> {
  const data = (await getCachedSiteContent()) ?? EMPTY;
  return resolveNeighborsPage(data.neighborsPage, neighborsPageFallback);
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
    siteDocumentCacheKey(slug),
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
