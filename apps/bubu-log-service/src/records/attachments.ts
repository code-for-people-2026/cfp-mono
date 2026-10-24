import { mediaKey, encryptMedia, decryptMedia, encryptedMediaOverhead } from "../privacy/media-encryption";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink, readdir, lstat, rm } from "node:fs/promises";
import path from "node:path";
import type { PayloadRequest } from "payload";
import sharp from "sharp";
import { AppError } from "../contracts";
import { IdentityService, type ActorScope, type Principal } from "../identity";
import { hash, RecordsRepository } from "./persistence";
import { sourceSchema } from "./schemas";
import type { SourceRef } from "./types";
import type { ImageReviewProof, ImageReviewService } from "../images/review";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
export type AttachmentMime = "image/jpeg" | "image/png" | "image/webp";
export interface Attachment {
  id: string; babyId: string; mime: AttachmentMime; byteLength: number; sha256: string;
  createdAt: string; source?: SourceRef;
  uploadedBy: Pick<ActorScope["actor"], "kind" | "id" | "onBehalfOf">;
  url: string;
}
export interface LegacyMediaReference { kind: "activity" | "baby-avatar" | "profile-avatar" | "legacy-source"; documentId: string }
interface StoredAttachment extends Omit<Attachment, "url"> {
  requestFingerprint: string; actor: ActorScope["actor"];
  legacyReference?: LegacyMediaReference;
  review?: ImageReviewProof;
}
interface AttachmentOptions { imageReview?: ImageReviewService; directory: string; maxBytes?: number; encryptionKey?: string; beforeLegacyAccess?: (babyId: string) => Promise<void> }
const fail = (status: number, code: string, message: string): never => { throw new AppError(status, code, message); };
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const formatError = () => fail(415, "ATTACHMENT_INVALID_IMAGE", "照片内容与支持的图片格式不符。");
/** Validate the complete container and decodability before normalization. */
export async function inspectAttachment(bytes: Uint8Array, declaredMime: string): Promise<AttachmentMime> {
  try {
    const original = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning", animated: false });
    const metadata = await image.metadata();
    const mime: AttachmentMime | undefined = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : undefined;
    if (!mime || declaredMime.split(";")[0]?.trim().toLowerCase() !== mime || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS || (metadata.pages ?? 1) > 1) return formatError();
    // Decoders can tolerate missing container terminators even with failOn=warning.
    if (mime === "image/png") {
      let offset = 8, ended = false;
      while (offset + 12 <= original.length) {
        const length = original.readUInt32BE(offset);
        if (length > original.length - offset - 12) return formatError();
        const type = original.toString("ascii", offset + 4, offset + 8);
        offset += length + 12;
        if (type === "IEND") { ended = length === 0 && offset === original.length; break; }
      }
      if (!ended) return formatError();
    } else if (mime === "image/jpeg" && (original.at(-2) !== 0xff || original.at(-1) !== 0xd9)) return formatError();
    else if (mime === "image/webp" && original.readUInt32LE(4) + 8 !== original.length) return formatError();
    // metadata alone accepts some truncated files; require the pixel decoding pipeline to complete too.
    await image.resize(1, 1, { fit: "inside" }).png().toBuffer();
    return mime;
  } catch { return formatError(); }
}

/** Re-encode decoded pixels, apply orientation, and strip EXIF/XMP/IPTC and embedded profiles. */
export async function sanitizeAttachment(bytes: Uint8Array, declaredMime: string): Promise<{ bytes: Buffer; mime: AttachmentMime }> {
  const mime = await inspectAttachment(bytes, declaredMime);
  let image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning" }).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true });
  image = mime === "image/jpeg" ? image.jpeg({ quality: 90 }) : mime === "image/webp" ? image.webp({ quality: 90 }) : image.png({ compressionLevel: 9 });
  return { bytes: await image.toBuffer(), mime };
}

export class AttachmentService {
  private readonly repository: RecordsRepository;
  private readonly objectDirectory: string;
  readonly maxBytes: number;
  private readonly encryptionKey: Buffer;
  constructor(readonly identity: IdentityService, private readonly options: AttachmentOptions) {
    this.repository = new RecordsRepository(identity.store.payload);
    this.objectDirectory = path.join(path.resolve(options.directory), "private-attachments");
    this.encryptionKey = mediaKey(options.directory, options.encryptionKey);
    this.maxBytes = options.maxBytes ?? MAX_ATTACHMENT_BYTES;
    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > MAX_ATTACHMENT_BYTES) throw new Error("Attachment size limit must be within 1–10485760 bytes");
  }
  private view(value: StoredAttachment): Attachment {
    return { id: value.id, babyId: value.babyId, mime: value.mime, byteLength: value.byteLength, sha256: value.sha256,
      createdAt: value.createdAt, uploadedBy: value.uploadedBy, ...(value.source ? { source: value.source } : {}),
      url: `/api/app/attachments/${encodeURIComponent(value.id)}?babyId=${encodeURIComponent(value.babyId)}` };
  }
  private objectPath(value: Pick<StoredAttachment, "babyId" | "sha256">) {
    if (!/^[a-f0-9]{64}$/.test(value.sha256)) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用。");
    return path.join(this.objectDirectory, hash(value.babyId), value.sha256);
  }
  private async readObject(value: Pick<StoredAttachment, "babyId" | "sha256" | "byteLength">): Promise<Buffer> {
    let file;
    try {
      file = await open(this.objectPath(value), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== value.byteLength + encryptedMediaOverhead || stat.size > this.maxBytes + encryptedMediaOverhead) throw new Error("Invalid private object");
      const bytes = decryptMedia(await file.readFile(), this.encryptionKey, `${hash(value.babyId)}:${value.sha256}`);
      if (checksum(bytes) !== value.sha256) throw new Error("Private object checksum mismatch");
      return bytes;
    } catch { return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。"); }
    finally { await file?.close(); }
  }
  private async writeObject(value: StoredAttachment, bytes: Uint8Array) {
    const target = this.objectPath(value), directory = path.dirname(target);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // A crash may leave an unreferenced object/temp file, never metadata that points at a partially written object.
    const temporary = path.join(directory, `.upload-${randomUUID()}`);
    let file;
    try {
      file = await open(temporary, "wx", 0o600);
      await file.writeFile(encryptMedia(bytes, this.encryptionKey, `${hash(value.babyId)}:${value.sha256}`)); await file.sync(); await file.close(); file = undefined;
      await rename(temporary, target);
      for (const durableDirectory of [directory, this.objectDirectory, path.dirname(this.objectDirectory)]) {
        const parent = await open(durableDirectory, constants.O_RDONLY);
        try { await parent.sync(); } finally { await parent.close(); }
      }
    } finally { await file?.close(); await unlink(temporary).catch(() => undefined); }
  }
  /** Internal lifecycle operation, run only while the identity serialization queue is held. */
  async purgeFamilyObjects(babyId: string) {
    await rm(path.join(this.objectDirectory, hash(babyId)), { recursive: true, force: true });
  }
  async purgeOrphanObjects(req: PayloadRequest, olderThan = Number.POSITIVE_INFINITY) {
    const rows = await this.identity.store.payload.find({ collection: "care-attachments", pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
    const referenced = new Set(rows.docs.map(row => this.objectPath(row.value as StoredAttachment)));
    let directories: string[];
    try { directories = await readdir(this.objectDirectory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const directory of directories) {
      if (!/^[a-f0-9]{64}$/.test(directory)) throw new Error("Unexpected private media directory");
      const folder = path.join(this.objectDirectory, directory);
      if (!(await lstat(folder)).isDirectory()) throw new Error("Invalid private media directory");
      for (const name of await readdir(folder)) {
        if (!/^(?:[a-f0-9]{64}|\.upload-[a-f0-9-]{36})$/.test(name)) throw new Error("Unexpected private media object");
        const file = path.join(folder, name), stat = await lstat(file);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Invalid private media object");
        if (!referenced.has(file) && stat.mtimeMs < olderThan) await unlink(file);
      }
    }
  }
  /** Offline upgrade only. Hold the runtime lock; callers must take an encrypted backup first. */
  async migrateObjects(apply = false) {
    const result = await this.identity.exclusive(() => this.identity.store.transaction(async req => {
      const rows = await this.identity.store.payload.find({ collection: "care-attachments", pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
      let plaintext = 0, encrypted = 0;
      for (const row of rows.docs) {
        const value = row.value as StoredAttachment;
        const file = await open(this.objectPath(value), constants.O_RDONLY | constants.O_NOFOLLOW);
        let original: Buffer;
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES + encryptedMediaOverhead) throw new Error("Invalid media object");
          original = await file.readFile();
        } finally { await file.close(); }
        try {
          const decoded = decryptMedia(original, this.encryptionKey, `${hash(value.babyId)}:${value.sha256}`);
          if (checksum(decoded) !== value.sha256) throw new Error("Media digest mismatch");
          encrypted++; continue;
        } catch {
          // No arbitrary plaintext fallback in serving: an offline upgrade verifies the original digest.
          if (original.length !== value.byteLength || checksum(original) !== value.sha256) throw new Error("Media object could not be verified; migration stopped");
        }
        plaintext++;
        if (!apply) continue;
        const normalized = await sanitizeAttachment(original, value.mime);
        const updated = { ...value, byteLength: normalized.bytes.length, sha256: checksum(normalized.bytes), mime: normalized.mime };
        await this.writeObject(updated, normalized.bytes);
        await this.repository.put("care-attachments", value.babyId, value.id, updated, req);
      }
      return { plaintext, encrypted, applied: apply };
    }));
    // The index must commit before deleting the old plaintext path. On interruption,
    // rerunning the offline command also finds/removes unreferenced leftovers.
    if (apply) await this.identity.exclusive(() => this.identity.store.transaction(req => this.purgeOrphanObjects(req)));
    return result;
  }
  /** Offline, verified legacy migration only; no HTTP/MCP endpoint exposes this capability. */
  async importLegacy(babyId: string, reference: LegacyMediaReference, bytes: Uint8Array, declaredMime: string): Promise<Attachment> {
    if (!babyId || babyId.length > 200 || !["activity", "baby-avatar", "profile-avatar", "legacy-source"].includes(reference.kind) || !reference.documentId || reference.documentId.length > 200) throw new Error("Invalid legacy media scope");
    if (!bytes.byteLength || bytes.byteLength > this.maxBytes) throw new Error("Invalid legacy media size");
    const originalSha = checksum(bytes), normalized = await sanitizeAttachment(bytes, declaredMime);
    if (normalized.bytes.length > this.maxBytes) throw new Error("Invalid normalized legacy media size");
    return this.identity.exclusive(() => this.identity.store.transaction(async req => {
      await this.options.beforeLegacyAccess?.(babyId);
      const id = `att_${hash(["legacy-media-v1", babyId, reference])}`, requestFingerprint = hash([reference, originalSha]);
      const existing = await this.repository.get<StoredAttachment>("care-attachments", babyId, id, req);
      if (existing && existing.requestFingerprint !== requestFingerprint) throw new Error("Legacy media source changed; migration stopped");
      const value: StoredAttachment = existing ? { ...existing, mime: normalized.mime, byteLength: normalized.bytes.length, sha256: checksum(normalized.bytes) } : { id, babyId, mime: normalized.mime, byteLength: normalized.bytes.length, sha256: checksum(normalized.bytes), requestFingerprint,
        createdAt: new Date(this.identity.now()).toISOString(), legacyReference: reference,
        actor: { kind: "operator", id: "legacy-media-migration", sessionId: "offline-migration" }, uploadedBy: { kind: "operator", id: "legacy-media-migration" } };
      await this.options.beforeLegacyAccess?.(babyId);
      await this.writeObject(value, normalized.bytes);
      await this.repository.put("care-attachments", babyId, id, value, req);
      return this.view(value);
    }));
  }
  async verifyLegacy(babyId: string, reference: LegacyMediaReference, id: string) {
    return this.identity.exclusive(() => this.identity.store.transaction(async req => {
      await this.options.beforeLegacyAccess?.(babyId);
      const value = await this.repository.get<StoredAttachment>("care-attachments", babyId, id, req);
      if (!value || value.babyId !== babyId || value.legacyReference?.kind !== reference.kind || value.legacyReference.documentId !== reference.documentId) throw new Error("Legacy media ownership mismatch");
      await this.readObject(value); return this.view(value);
    }));
  }
  /** Caller already holds executeAuthorized(media:read), including current privacy choices. */
  async readInScope(scope: ActorScope, req: PayloadRequest, attachmentId: string) {
    const attachment = await this.validateAttachment(scope, req, attachmentId);
    return { attachment, bytes: await this.readObject(attachment) };
  }
  private normalizeSource(scope: ActorScope, source?: SourceRef): SourceRef | undefined {
    const parsed = source === undefined ? undefined : sourceSchema.safeParse(source);
    if (parsed && !parsed.success) return fail(400, "ATTACHMENT_SOURCE_INVALID", "照片来源字段不完整或格式不正确。");
    const value = parsed?.data;
    if (scope.actor.kind === "collector") {
      if (!value || value.kind !== "wechat" || !scope.groupId || value.groupId !== scope.groupId) return fail(403, "ATTACHMENT_SOURCE_FORBIDDEN", "照片来源不属于此采集群。");
      if (value.conversationId !== scope.groupId && `wechat:${value.accountId}:${value.conversationId}` !== scope.groupId) return fail(403, "ATTACHMENT_SOURCE_FORBIDDEN", "照片来源账号和会话与采集授权不一致。");
    } else if (value?.groupId || value?.kind === "wechat") return fail(403, "ATTACHMENT_SOURCE_FORBIDDEN", "群照片必须由受限采集身份上传。");
    return value;
  }
  /** Called inside the record service's executeAuthorized transaction before linking a private attachment. */
  async validateAttachment(scope: ActorScope, req: PayloadRequest, attachmentId: string): Promise<Attachment> {
    if (!scope.permissions.includes("media:read")) return fail(403, "BABY_FORBIDDEN", "没有此宝宝的照片访问权限。");
    const value = await this.repository.get<StoredAttachment>("care-attachments", scope.babyId, attachmentId, req);
    if (!value || value.babyId !== scope.babyId) return fail(404, "ATTACHMENT_NOT_FOUND", "没有找到此宝宝的照片。");
    if (scope.actor.kind === "collector" && (!scope.groupId || value.source?.groupId !== scope.groupId || value.source.kind !== "wechat")) return fail(403, "ATTACHMENT_SOURCE_FORBIDDEN", "照片来源不属于此采集群。");
    if (scope.actor.kind === "collector" || scope.actor.kind === "chat-agent" && scope.actor.purpose !== "history") this.options.imageReview?.requireProof(value.review, value.sha256);
    return this.view(value);
  }
  async upload(principal: Principal, babyId: string, bytes: Uint8Array, declaredMime: string, requestId: string, source?: SourceRef): Promise<Attachment> {
    if (this.options.imageReview && this.identity.store.currentRequest()) throw new Error("Image uploads require an independent transaction boundary");
    const groupId = principal.kind === "collector" ? principal.groupId : undefined;
    // Reject unauthorized sources before decoding. External review never holds the identity queue.
    await this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
      await this.identity.assertRecordingService(principal, babyId, req);
      this.normalizeSource(scope, source);
    }, groupId);
    if (!requestId.trim() || requestId.length > 200) return fail(400, "ATTACHMENT_REQUEST_ID_INVALID", "请提供不超过 200 字符的上传请求号。");
    if (!bytes.byteLength || bytes.byteLength > this.maxBytes) return fail(413, "ATTACHMENT_TOO_LARGE", "照片为空或超过大小限制。");
    const originalSha = checksum(bytes), normalized = await sanitizeAttachment(bytes, declaredMime);
    if (normalized.bytes.length > this.maxBytes) return fail(413, "ATTACHMENT_TOO_LARGE", "照片处理后仍超过大小限制。");
    const sha256 = checksum(normalized.bytes), mime = normalized.mime;
    const prepare = async (scope: ActorScope, req: PayloadRequest) => {
      await this.identity.assertRecordingService(principal, babyId, req);
      const normalizedSource = this.normalizeSource(scope, source);
      const attachmentId = `att_${hash([babyId, scope.actor.kind, scope.actor.id, scope.actor.onBehalfOf, scope.groupId, requestId])}`;
      const requestFingerprint = hash([originalSha, mime, normalizedSource]);
      const existing = await this.repository.get<StoredAttachment>("care-attachments", babyId, attachmentId, req);
      if (existing && existing.requestFingerprint !== requestFingerprint) return fail(409, "ATTACHMENT_IDEMPOTENCY_CONFLICT", "此上传请求号已用于不同照片或来源。");
      const value: StoredAttachment = existing ? { ...existing, sha256, mime, byteLength: normalized.bytes.length } : {
        id: attachmentId, babyId, mime, byteLength: normalized.bytes.length, sha256, requestFingerprint,
        createdAt: new Date(this.identity.now()).toISOString(), actor: scope.actor,
        uploadedBy: { kind: scope.actor.kind, id: scope.actor.id, ...(scope.actor.onBehalfOf ? { onBehalfOf: scope.actor.onBehalfOf } : {}) },
        ...(normalizedSource ? { source: normalizedSource } : {}),
      };
      return value;
    };
    const prepared = await this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
      const value = await prepare(scope, req);
      let alreadyReviewed = !this.options.imageReview;
      if (this.options.imageReview && value.review) {
        try { this.options.imageReview.requireProof(value.review, sha256); alreadyReviewed = true; } catch { /* re-review the same normalized pixels */ }
      }
      if (!alreadyReviewed) await this.options.imageReview!.reserve(scope, req);
      return { value, alreadyReviewed };
    }, groupId);
    const beforeDisclosure = async () => { await this.identity.executeAuthorized(principal, babyId, "media:write", prepare, groupId); };
    const review = prepared.alreadyReviewed ? prepared.value.review : await this.options.imageReview!.inspect(normalized.bytes, mime, sha256, beforeDisclosure);
    return this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
      // Recheck source, rights, consent, deletion and idempotency after the supplier returns.
      const value = await prepare(scope, req);
      if (this.options.imageReview) this.options.imageReview.requireProof(review, sha256);
      if (review) value.review = review;
      await this.writeObject(value, normalized.bytes);
      await this.identity.assertRecordingService(principal, babyId, req);
      await this.repository.put("care-attachments", babyId, value.id, value, req);
      return this.view(value);
    }, groupId);
  }
  /** Model input must not use the caregiver/history path to bypass image review. */
  async readForModel(principal: Principal, babyId: string, attachmentId: string) {
    return this.identity.executeAuthorized(principal, babyId, "media:read", async (scope, req) => {
      const attachment = await this.validateAttachment(scope, req, attachmentId);
      const stored = await this.repository.get<StoredAttachment>("care-attachments", babyId, attachmentId, req);
      this.options.imageReview?.requireProof(stored?.review, attachment.sha256);
      return { attachment, bytes: await this.readObject(attachment) };
    }, principal.kind === "collector" ? principal.groupId : undefined);
  }
  async read(principal: Principal, babyId: string, attachmentId: string): Promise<{ attachment: Attachment; bytes: Buffer }> {
    return this.identity.executeAuthorized(principal, babyId, "media:read", async (scope, req) => {
      const attachment = await this.validateAttachment(scope, req, attachmentId);
      return { attachment, bytes: await this.readObject(attachment) };
    }, principal.kind === "collector" ? principal.groupId : undefined);
  }
}

async function readUploadBody(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return fail(413, "ATTACHMENT_TOO_LARGE", "照片超过大小限制。");
  if (!request.body) return fail(400, "ATTACHMENT_EMPTY", "请选择照片。");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) return fail(413, "ATTACHMENT_TOO_LARGE", "照片超过大小限制。");
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

/** Call after the shared cookie/Bearer authentication and Origin check, before the ordinary JSON body check. */
export function createAttachmentHandler(service: AttachmentService) {
  return async (request: Request, principal: Principal): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const upload = request.method === "POST" && url.pathname === "/api/app/attachments";
    const download = request.method === "GET" && /^\/api\/app\/attachments\/att_[a-f0-9]{64}$/.test(url.pathname);
    if (!upload && !download) return undefined;
    const babyId = url.searchParams.get("babyId") || request.headers.get("x-baby-id") || "";
    if (!babyId || babyId.length > 200 || (request.headers.has("x-baby-id") && request.headers.get("x-baby-id") !== babyId)) return fail(400, "SCOPE_MISMATCH", "请提供一致的宝宝范围。");
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
    if (upload) {
      await service.identity.executeAuthorized(principal, babyId, "media:write", async (_scope, req) => service.identity.assertRecordingService(principal, babyId, req), principal.kind === "collector" ? principal.groupId : undefined);
      let source: SourceRef | undefined;
      const encoded = request.headers.get("x-bubu-source");
      if (encoded) {
        if (encoded.length > 4096) return fail(400, "ATTACHMENT_SOURCE_INVALID", "照片来源过长。");
        try { source = sourceSchema.parse(JSON.parse(decodeURIComponent(encoded))); }
        catch { return fail(400, "ATTACHMENT_SOURCE_INVALID", "照片来源字段不完整或格式不正确。"); }
      }
      const attachment = await service.upload(principal, babyId, await readUploadBody(request, service.maxBytes), request.headers.get("content-type") || "", request.headers.get("x-bubu-request-id") || "", source);
      return Response.json({ data: attachment }, { status: 200, headers });
    }
    const result = await service.read(principal, babyId, url.pathname.slice("/api/app/attachments/".length));
    return new Response(new Uint8Array(result.bytes), { headers: { ...headers, "Content-Type": result.attachment.mime, "Content-Length": String(result.attachment.byteLength), "Content-Disposition": "inline" } });
  };
}
