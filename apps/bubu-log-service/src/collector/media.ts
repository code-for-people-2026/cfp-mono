import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { inspectAttachment, MAX_ATTACHMENT_BYTES, type AttachmentMime } from "../records/attachments";
import type { SourceMessage } from "./types";

export const exactMediaConfigSchema = z.object({
  roots: z.array(z.string().min(1)).min(1).max(20),
  // Operators map a stable source message and media index to an exact, verified
  // decoded file. No path is ever accepted from message content or model output.
  mappings: z.array(z.object({ sourceId: z.string(), index: z.number().int().min(0).max(9), path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(100_000).default([]),
  // These directories contain only files named <XML md5>.jpg/.jpeg/.png/.webp.
  // We neither walk monthly folders nor choose a first image candidate.
  md5Directories: z.array(z.string().min(1)).max(20).default([]),
}).strict();
export type ExactMediaConfig = z.input<typeof exactMediaConfigSchema>;
export type MediaResult = { available: true; bytes: Buffer; mime: AttachmentMime } | { available: false; reason: string };
export interface MediaResolver { resolve(message: SourceMessage, index: number): Promise<MediaResult> }
const digest = (algorithm: string, bytes: Buffer) => createHash(algorithm).update(bytes).digest("hex");
const within = (root: string, file: string) => file.startsWith(root + path.sep);

export class ExactLocalMediaResolver implements MediaResolver {
  readonly config: z.output<typeof exactMediaConfigSchema>;
  constructor(config: ExactMediaConfig) { this.config = exactMediaConfigSchema.parse(config); }
  private async read(file: string, roots: string[]): Promise<Buffer> {
    // Reject symlinks in every component, including the final file. The file
    // handle is checked after opening to bound reads and reject directories.
    const absolute = path.resolve(file), canonical = await realpath(absolute);
    const rootIndex = this.config.roots.findIndex(root => within(path.resolve(root), absolute));
    const expected = rootIndex < 0 ? absolute : path.join(roots[rootIndex]!, path.relative(path.resolve(this.config.roots[rootIndex]!), absolute));
    if (expected !== canonical || !roots.some(root => within(root, canonical))) throw new Error("MEDIA_PATH_NOT_ALLOWED");
    const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 1 || info.size > MAX_ATTACHMENT_BYTES) throw new Error("MEDIA_SIZE_INVALID");
      const bytes = await handle.readFile();
      if (bytes.length !== info.size) throw new Error("MEDIA_CHANGED");
      return bytes;
    } finally { await handle.close(); }
  }
  async resolve(message: SourceMessage, index: number): Promise<MediaResult> {
    const media = message.media[index];
    if (!media || media.kind !== "image") return { available: false, reason: "MEDIA_TYPE_NOT_SUPPORTED" };
    try {
      const roots = await Promise.all(this.config.roots.map(root => realpath(path.resolve(root))));
      const mappings = this.config.mappings.filter(mapping => mapping.sourceId === message.sourceId && mapping.index === index);
      if (mappings.length > 1) return { available: false, reason: "MEDIA_MAPPING_AMBIGUOUS" };
      let bytes: Buffer;
      if (mappings[0]) {
        bytes = await this.read(mappings[0].path, roots);
        if (digest("sha256", bytes) !== mappings[0].sha256) return { available: false, reason: "MEDIA_MAPPING_HASH_MISMATCH" };
      } else {
        const md5 = /^md5:([a-f0-9]{32})$/.exec(media.fingerprint || "")?.[1];
        if (!md5) return { available: false, reason: "MEDIA_EXACT_MAPPING_REQUIRED" };
        const candidates: Buffer[] = [];
        for (const directory of this.config.md5Directories) for (const extension of ["jpg", "jpeg", "png", "webp"]) {
          try {
            const candidate = await this.read(path.join(directory, `${md5}.${extension}`), roots);
            if (digest("md5", candidate) !== md5) return { available: false, reason: "MEDIA_XML_HASH_MISMATCH" };
            candidates.push(candidate);
          } catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
          }
        }
        if (candidates.length !== 1) return { available: false, reason: candidates.length ? "MEDIA_MAPPING_AMBIGUOUS" : "MEDIA_EXACT_FILE_MISSING" };
        bytes = candidates[0]!;
      }
      const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png" : bytes[0] === 255 && bytes[1] === 216 ? "image/jpeg" : "image/webp";
      return { available: true, bytes, mime: await inspectAttachment(bytes, mime) };
    } catch (error) {
      const reason = error instanceof Error && /^MEDIA_[A-Z_]+$/.test(error.message) ? error.message : "MEDIA_LOCAL_FILE_UNAVAILABLE";
      return { available: false, reason };
    }
  }
}
