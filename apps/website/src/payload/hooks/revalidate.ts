import { revalidateTag } from "next/cache";
import type { CollectionAfterChangeHook, GlobalAfterChangeHook } from "payload";

// Only published changes should bust the Next.js cache — draft edits stay invisible to
// the live site until an editor hits Publish (the "release"). Gating on _status means a
// batch of draft edits is applied in one shot when the document/global is published.
function isPublished(doc: unknown): boolean {
  return Boolean(doc) && (doc as { _status?: string })._status === "published";
}

export const revalidateGlobal =
  (tag: string): GlobalAfterChangeHook =>
  ({ doc }) => {
    if (isPublished(doc)) revalidateTag(tag, "max");
    return doc;
  };

// site-documents: revalidate the per-slug tag on publish.
export const revalidateDocument: CollectionAfterChangeHook = ({ doc }) => {
  if (isPublished(doc)) {
    const slug = (doc as { slug?: string }).slug;
    if (slug) revalidateTag(`payload:doc:${slug}`, "max");
  }
  return doc;
};
