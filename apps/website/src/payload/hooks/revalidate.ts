import { revalidateTag } from "next/cache";
import type { CollectionAfterChangeHook, GlobalAfterChangeHook } from "payload";

// Drafts are off on every content global/collection, so there is no `_status`/publish
// gate: every save IS a publish and must bust the Next.js cache immediately. (Earlier the
// hook gated on `_status === "published"`; with `versions:false` that field is gone, so the
// gate would never fire and the site would serve stale `unstable_cache` data forever.)

// revalidateTag throws when called outside a request/render scope (e.g. during onInit
// seeding). Swallow that — the seed reads fresh anyway, and real edits happen in the admin
// request scope where this works.
function safeRevalidate(tag: string) {
  try {
    revalidateTag(tag, "max");
  } catch {
    // not in a revalidation-capable context (seeding / startup)
  }
}

export const revalidateGlobal =
  (tag: string): GlobalAfterChangeHook =>
  ({ doc }) => {
    safeRevalidate(tag);
    return doc;
  };

// site-documents: revalidate the per-slug tag on save.
export const revalidateDocument: CollectionAfterChangeHook = ({ doc }) => {
  const slug = (doc as { slug?: string }).slug;
  if (slug) safeRevalidate(`payload:doc:${slug}`);
  return doc;
};
