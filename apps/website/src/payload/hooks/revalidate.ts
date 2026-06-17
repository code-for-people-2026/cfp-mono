import { revalidateTag } from "next/cache";
import type { CollectionAfterChangeHook, GlobalAfterChangeHook } from "payload";

// Only published changes should bust the Next.js cache — draft edits stay invisible to
// the live site until an editor hits Publish (the "release"). Gating on _status means a
// batch of draft edits is applied in one shot when the document/global is published.
function isPublished(doc: unknown): boolean {
  return Boolean(doc) && (doc as { _status?: string })._status === "published";
}

// revalidateTag throws when called outside a request/render scope (e.g. during onInit
// seeding). Swallow that — the seed reads fresh anyway, and real publishes happen in the
// admin request scope where this works.
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
    if (isPublished(doc)) safeRevalidate(tag);
    return doc;
  };

// site-documents: revalidate the per-slug tag on publish.
export const revalidateDocument: CollectionAfterChangeHook = ({ doc }) => {
  if (isPublished(doc)) {
    const slug = (doc as { slug?: string }).slug;
    if (slug) safeRevalidate(`payload:doc:${slug}`);
  }
  return doc;
};
