import { describe, expect, it } from "vitest";
import {
  CONTENT_CACHE_VERSION,
  SITE_CONTENT_CACHE_KEY,
  siteDocumentCacheKey,
} from "./cache-keys";

describe("content cache keys", () => {
  it("versions the global and document caches for the brand data migration", () => {
    expect(SITE_CONTENT_CACHE_KEY).toEqual(["site-content", CONTENT_CACHE_VERSION]);
    expect(siteDocumentCacheKey("manifesto")).toEqual([
      "site-document",
      CONTENT_CACHE_VERSION,
      "manifesto",
    ]);
  });
});
