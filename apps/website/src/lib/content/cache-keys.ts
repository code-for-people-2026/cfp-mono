// Bump this whenever a data-only migration changes persisted site copy without invoking
// Payload hooks. The version keeps a new deployment from reusing permanent Data Cache
// entries created before the migration runs.
export const CONTENT_CACHE_VERSION = "brand-2026-07-21";

export const SITE_CONTENT_CACHE_KEY = ["site-content", CONTENT_CACHE_VERSION];

export function siteDocumentCacheKey(slug: string): string[] {
  return ["site-document", CONTENT_CACHE_VERSION, slug];
}
