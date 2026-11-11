import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { PayloadRequest } from "payload";
import sharp from "sharp";
import { z } from "zod";
import { AppError } from "../contracts";
import { IdentityService, type ActorScope, type Principal } from "../identity";
import type { AttachmentObjectStore } from "../storage/attachment-objects";
import { hash, RecordsRepository } from "./persistence";
import { sourceSchema } from "./schemas";
import type { SourceRef } from "./types";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_RECEIPT_JSON_BYTES = 16 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
export type AttachmentMime = "image/jpeg" | "image/png" | "image/webp";
export interface Attachment {
  id: string; babyId: string; mime: AttachmentMime; byteLength: number; sha256: string;
  createdAt: string; source?: SourceRef;
  uploadedBy: Pick<ActorScope["actor"], "kind" | "id" | "onBehalfOf">;
  url: string;
}
type AttachmentUploadReceipt =
  | { state: "absent" }
  | { state: "verified"; attachment: Attachment }
  | { state: "needsRepair"; id: string; mime: AttachmentMime; sha256: string; requestFingerprint: string };
interface StoredAttachment extends Omit<Attachment, "url"> {
  requestFingerprint: string; actor: ActorScope["actor"];
  storage?: { kind: "oss"; key: string };
}
interface AttachmentOptions { directory: string; maxBytes?: number; objectStore?: AttachmentObjectStore }
interface UploadSnapshot {
  scope: ActorScope; normalizedSource?: SourceRef; attachmentId: string;
  existing?: StoredAttachment;
}
type RecoverSnapshot = { state: "absent" } | { state: "found"; value: StoredAttachment; normalizedSource?: SourceRef };
const receiptSchema = z.object({ requestId: z.string().max(200), source: sourceSchema.optional() }).strict();
const fail = (status: number, code: string, message: string): never => { throw new AppError(status, code, message); };
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const attachmentObjectKey = (babyId: string, sha256: string) => `${hash(babyId)}/${sha256}`;
const formatError = () => fail(415, "ATTACHMENT_INVALID_IMAGE", "照片内容与支持的图片格式不符。");
/** Decode only for validation; the uploaded bytes are stored without recompression or metadata changes. */
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

export class AttachmentService {
  private readonly repository: RecordsRepository;
  private readonly objectDirectory: string;
  private readonly objectStore?: AttachmentObjectStore;
  readonly maxBytes: number;
  constructor(readonly identity: IdentityService, options: AttachmentOptions) {
    this.repository = new RecordsRepository(identity.store.payload);
    this.objectDirectory = path.join(path.resolve(options.directory), "private-attachments");
    this.objectStore = options.objectStore;
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
  private validateStorage(value: Pick<StoredAttachment, "babyId" | "sha256" | "storage">): string {
    if (!value.storage) return "";
    const expected = attachmentObjectKey(value.babyId, value.sha256);
    if (value.storage.kind !== "oss" || value.storage.key !== expected || !this.objectStore) {
      return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用。");
    }
    return value.storage.key;
  }
  private metadataFingerprint(value: StoredAttachment): string {
    const metadata = { ...value };
    delete metadata.storage;
    return hash(metadata);
  }
  private storageEquals(value: StoredAttachment, expected: StoredAttachment["storage"]): boolean {
    return hash(value.storage) === hash(expected);
  }
  private canCommitStorage(value: StoredAttachment, expected: StoredAttachment["storage"]): boolean {
    if (this.storageEquals(value, expected)) return true;
    // A deployment may introduce OSS after a legacy upload committed. Its exact retry can then
    // add the verified deterministic key, but an already-selected key can never be replaced.
    if (value.storage) return false;
    return expected?.kind === "oss" && expected.key === attachmentObjectKey(value.babyId, value.sha256);
  }
  private concurrentInsertMatches(current: StoredAttachment, candidate: StoredAttachment): boolean {
    const actor = current.actor as ActorScope["actor"] | undefined;
    return current.id === candidate.id && current.babyId === candidate.babyId &&
      current.sha256 === candidate.sha256 && current.mime === candidate.mime &&
      current.byteLength === candidate.byteLength && hash(current.source) === hash(candidate.source) &&
      hash(current.uploadedBy) === hash(candidate.uploadedBy) &&
      actor?.kind === candidate.actor.kind && actor?.id === candidate.actor.id &&
      actor?.onBehalfOf === candidate.actor.onBehalfOf &&
      typeof current.createdAt === "string" && typeof actor?.sessionId === "string";
  }
  private validateCurrentForUpload(current: StoredAttachment, candidate: StoredAttachment, strict: boolean): void {
    if (!strict && current.requestFingerprint !== candidate.requestFingerprint) {
      return fail(409, "ATTACHMENT_IDEMPOTENCY_CONFLICT", "此上传请求号已用于不同照片或来源。");
    }
    if (strict ? this.metadataFingerprint(current) !== this.metadataFingerprint(candidate)
               : !this.concurrentInsertMatches(current, candidate)) {
      return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。");
    }
  }
  private async readObject(value: Pick<StoredAttachment, "babyId" | "sha256" | "byteLength" | "storage">): Promise<Buffer> {
    const remoteKey = this.validateStorage(value);
    if (remoteKey) return this.readRemoteObject(remoteKey, value);
    let file;
    try {
      file = await open(this.objectPath(value), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await file.stat();
      if (!stat.isFile()) throw new Error("Invalid private object");
      if (stat.size !== value.byteLength || stat.size > this.maxBytes) throw new Error("Private object length mismatch");
      const bytes = await file.readFile();
      if (checksum(bytes) !== value.sha256) throw new Error("Private object checksum mismatch");
      return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail(503, "ATTACHMENT_OBJECT_MISSING", "照片暂时不可用，请重试上传或联系运营。");
      if (error instanceof AppError) throw error;
      if (error instanceof Error && (error.message === "Private object length mismatch" || error.message === "Private object checksum mismatch")) {
        return fail(503, "ATTACHMENT_OBJECT_CORRUPT", "照片暂时不可用，请重试上传或联系运营。");
      }
      return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。");
    }
    finally { await file?.close(); }
  }
  private async readRemoteObject(key: string, value: Pick<StoredAttachment, "sha256" | "byteLength">): Promise<Buffer> {
    let bytes: Buffer;
    try {
      bytes = await this.objectStore!.get(key, this.maxBytes);
    } catch (error) {
      if (error instanceof AppError && (
        error.code === "ATTACHMENT_OBJECT_MISSING" ||
        error.code === "ATTACHMENT_STORAGE_UNAVAILABLE" ||
        error.code === "ATTACHMENT_OBJECT_CORRUPT"
      )) throw error;
      return fail(503, "ATTACHMENT_STORAGE_UNAVAILABLE", "附件存储暂不可用，请稍后重试。");
    }
    if (bytes.byteLength !== value.byteLength || bytes.byteLength > this.maxBytes || checksum(bytes) !== value.sha256) {
      return fail(503, "ATTACHMENT_OBJECT_CORRUPT", "照片暂时不可用，请重试上传或联系运营。");
    }
    return bytes;
  }
  private async writeObject(value: StoredAttachment, bytes: Uint8Array): Promise<StoredAttachment> {
    if (this.objectStore) {
      const key = attachmentObjectKey(value.babyId, value.sha256);
      const stored = { ...value, storage: { kind: "oss" as const, key } };
      try {
        const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        await this.objectStore.put(key, view);
      } catch (error) {
        if (error instanceof AppError && error.code === "ATTACHMENT_STORAGE_UNAVAILABLE") throw error;
        return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。");
      }
      // An accepted PUT can still be ambiguous or later corrupt. Commit metadata only after a fresh GET.
      try { await this.readRemoteObject(key, stored); }
      catch (error) {
        if (error instanceof AppError && error.code === "ATTACHMENT_STORAGE_UNAVAILABLE") throw error;
        return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。");
      }
      return stored;
    }
    const target = this.objectPath(value), directory = path.dirname(target);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // A crash may leave an unreferenced object/temp file, never metadata that points at a partially written object.
    const temporary = path.join(directory, `.upload-${randomUUID()}`);
    let file;
    try {
      file = await open(temporary, "wx", 0o600);
      await file.writeFile(bytes); await file.sync(); await file.close(); file = undefined;
      await rename(temporary, target);
      for (const durableDirectory of [directory, this.objectDirectory, path.dirname(this.objectDirectory)]) {
        const parent = await open(durableDirectory, constants.O_RDONLY);
        try { await parent.sync(); } finally { await parent.close(); }
      }
    } finally { await file?.close(); await unlink(temporary).catch(() => undefined); }
    return value;
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
  private attachmentId(babyId: string, scope: ActorScope, requestId: string): string {
    return `att_${hash([babyId, scope.actor.kind, scope.actor.id, scope.actor.onBehalfOf, scope.groupId, requestId])}`;
  }
  private async storedAttachment(scope: ActorScope, req: PayloadRequest, attachmentId: string): Promise<StoredAttachment> {
    if (!scope.permissions.includes("media:read")) return fail(403, "BABY_FORBIDDEN", "没有此宝宝的照片访问权限。");
    const value = await this.repository.get<StoredAttachment>("care-attachments", scope.babyId, attachmentId, req);
    if (!value || value.babyId !== scope.babyId) return fail(404, "ATTACHMENT_NOT_FOUND", "没有找到此宝宝的照片。");
    if (scope.actor.kind === "collector" && (!scope.groupId || value.source?.groupId !== scope.groupId || value.source.kind !== "wechat")) return fail(403, "ATTACHMENT_SOURCE_FORBIDDEN", "照片来源不属于此采集群。");
    this.validateStorage(value);
    return value;
  }
  /** Called inside the record service's executeAuthorized transaction before linking a private attachment. */
  async validateAttachment(scope: ActorScope, req: PayloadRequest, attachmentId: string): Promise<Attachment> {
    return this.view(await this.storedAttachment(scope, req, attachmentId));
  }
  async upload(principal: Principal, babyId: string, bytes: Uint8Array, declaredMime: string, requestId: string, source?: SourceRef): Promise<Attachment> {
    if (!requestId.trim() || requestId.length > 200) return fail(400, "ATTACHMENT_REQUEST_ID_INVALID", "请提供不超过 200 字符的上传请求号。");
    if (!bytes.byteLength || bytes.byteLength > this.maxBytes) return fail(413, "ATTACHMENT_TOO_LARGE", "照片为空或超过大小限制。");
    // The first authorization and metadata read is deliberately short. Image decoding and object I/O happen outside the global queue.
    const snapshot: UploadSnapshot = await this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
      if (!requestId.trim() || requestId.length > 200) return fail(400, "ATTACHMENT_REQUEST_ID_INVALID", "请提供不超过 200 字符的上传请求号。");
      if (!bytes.byteLength || bytes.byteLength > this.maxBytes) return fail(413, "ATTACHMENT_TOO_LARGE", "照片为空或超过大小限制。");
      const normalizedSource = this.normalizeSource(scope, source);
      const attachmentId = this.attachmentId(babyId, scope, requestId);
      const existing = await this.repository.get<StoredAttachment>("care-attachments", babyId, attachmentId, req);
      if (existing) this.validateStorage(existing);
      return { scope, normalizedSource, attachmentId, ...(existing ? { existing } : {}) };
    }, principal.kind === "collector" ? principal.groupId : undefined);

    const mime = await inspectAttachment(bytes, declaredMime), sha256 = checksum(bytes);
    const requestFingerprint = hash([sha256, mime, snapshot.normalizedSource]);
    if (snapshot.existing && snapshot.existing.requestFingerprint !== requestFingerprint) {
      return fail(409, "ATTACHMENT_IDEMPOTENCY_CONFLICT", "此上传请求号已用于不同照片或来源。");
    }
    const candidate: StoredAttachment = snapshot.existing ?? {
      id: snapshot.attachmentId, babyId, mime, byteLength: bytes.byteLength, sha256, requestFingerprint,
      createdAt: new Date(this.identity.now()).toISOString(), actor: snapshot.scope.actor,
      uploadedBy: { kind: snapshot.scope.actor.kind, id: snapshot.scope.actor.id, ...(snapshot.scope.actor.onBehalfOf ? { onBehalfOf: snapshot.scope.actor.onBehalfOf } : {}) },
      ...(snapshot.normalizedSource ? { source: snapshot.normalizedSource } : {}),
    };
    // Exact retries also repair an object lost/corrupted after the original commit, using the same verified bytes.
    let stored: StoredAttachment | undefined;
    try { stored = await this.writeObject(candidate, bytes); }
    catch (error) {
      await this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
        const normalizedSource = this.normalizeSource(scope, source);
        if (this.attachmentId(babyId, scope, requestId) !== snapshot.attachmentId ||
            hash([sha256, mime, normalizedSource]) !== requestFingerprint) {
          return fail(409, "ATTACHMENT_IDEMPOTENCY_CONFLICT", "此上传请求号已用于不同照片或来源。");
        }
        const current = await this.repository.get<StoredAttachment>("care-attachments", babyId, snapshot.attachmentId, req);
        if (current) {
          this.validateCurrentForUpload(current, candidate, snapshot.existing !== undefined);
          this.validateStorage(current);
        } else if (snapshot.existing) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。");
        return undefined;
      }, principal.kind === "collector" ? principal.groupId : undefined);
      throw error;
    }
    // Reauthorize and compare metadata before commit. Never overwrite a request whose identity changed while storage was busy.
    return this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
      const normalizedSource = this.normalizeSource(scope, source);
      if (this.attachmentId(babyId, scope, requestId) !== snapshot.attachmentId ||
          hash([sha256, mime, normalizedSource]) !== requestFingerprint) {
        return fail(409, "ATTACHMENT_IDEMPOTENCY_CONFLICT", "此上传请求号已用于不同照片或来源。");
      }
      const current = await this.repository.get<StoredAttachment>("care-attachments", babyId, snapshot.attachmentId, req);
      if (current) {
        this.validateCurrentForUpload(current, candidate, snapshot.existing !== undefined);
        this.validateStorage(current);
        if (!this.canCommitStorage(current, stored.storage)) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。");
        if (!current.storage && stored.storage) {
          const merged = { ...current, storage: stored.storage };
          await this.repository.put("care-attachments", babyId, snapshot.attachmentId, merged, req);
          return this.view(merged);
        }
        return this.view(current);
      }
      if (snapshot.existing) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。");
      await this.repository.put("care-attachments", babyId, snapshot.attachmentId, stored, req);
      return this.view(stored);
    }, principal.kind === "collector" ? principal.groupId : undefined);
  }
  /**
   * Recover metadata for a prior upload after its HTTP response was lost. This is
   * deliberately read-only. An unavailable object is advertised only through
   * authorized metadata so the client can select the exact committed bytes.
   */
  async recoverUpload(principal: Principal, babyId: string, requestId: string, source?: SourceRef): Promise<AttachmentUploadReceipt> {
    const snapshot: RecoverSnapshot = await this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
      if (!scope.permissions.includes("media:read")) return fail(403, "BABY_FORBIDDEN", "没有此宝宝的照片访问权限。");
      if (!requestId.trim() || requestId.length > 200) return fail(400, "ATTACHMENT_REQUEST_ID_INVALID", "请提供不超过 200 字符的上传请求号。");
      const normalizedSource = this.normalizeSource(scope, source);
      const attachmentId = this.attachmentId(babyId, scope, requestId);
      const existing = await this.repository.get<StoredAttachment>("care-attachments", babyId, attachmentId, req);
      if (!existing || existing.babyId !== babyId || existing.id !== attachmentId) return { state: "absent" };
      // hash uses the same canonical JSON convention as the persisted upload
      // fingerprint. All authorization, source, and fingerprint checks happen
      // before any private object is read or metadata is returned.
      if (hash(existing.source) !== hash(normalizedSource) ||
          existing.requestFingerprint !== hash([existing.sha256, existing.mime, normalizedSource])) {
        return fail(409, "ATTACHMENT_IDEMPOTENCY_CONFLICT", "此上传请求号已用于不同照片或来源。");
      }
      return { state: "found", value: existing, normalizedSource };
    }, principal.kind === "collector" ? principal.groupId : undefined);
    if (snapshot.state === "absent") return snapshot;

    let objectError: unknown;
    try { await this.readObject(snapshot.value); }
    catch (error) { objectError = error; }
    return this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
      if (!scope.permissions.includes("media:read")) return fail(403, "BABY_FORBIDDEN", "没有此宝宝的照片访问权限。");
      const normalizedSource = this.normalizeSource(scope, source);
      const attachmentId = this.attachmentId(babyId, scope, requestId);
      const current = await this.repository.get<StoredAttachment>("care-attachments", babyId, attachmentId, req);
      if (!current || this.metadataFingerprint(current) !== this.metadataFingerprint(snapshot.value) ||
          this.storageEquals(current, snapshot.value.storage) === false ||
          hash(current.source) !== hash(normalizedSource) ||
          current.requestFingerprint !== hash([current.sha256, current.mime, normalizedSource])) {
        return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。");
      }
      this.validateStorage(current);
      if (objectError) {
        if (objectError instanceof AppError && (
          objectError.code === "ATTACHMENT_OBJECT_MISSING" || objectError.code === "ATTACHMENT_OBJECT_CORRUPT"
        )) {
          return { state: "needsRepair", id: current.id, mime: current.mime, sha256: current.sha256, requestFingerprint: current.requestFingerprint };
        }
        throw objectError;
      }
      return { state: "verified", attachment: this.view(current) };
    }, principal.kind === "collector" ? principal.groupId : undefined);
  }
  async read(principal: Principal, babyId: string, attachmentId: string): Promise<{ attachment: Attachment; bytes: Buffer }> {
    const snapshot = await this.identity.executeAuthorized(principal, babyId, "media:read", async (scope, req) => {
      const value = await this.storedAttachment(scope, req, attachmentId);
      return { value };
    }, principal.kind === "collector" ? principal.groupId : undefined);

    let bytes: Buffer;
    let objectError: unknown;
    try { bytes = await this.readObject(snapshot.value); }
    catch (error) { objectError = error; }
    return this.identity.executeAuthorized(principal, babyId, "media:read", async (scope, req) => {
      const value = await this.storedAttachment(scope, req, attachmentId);
      if (this.metadataFingerprint(value) !== this.metadataFingerprint(snapshot.value) || this.storageEquals(value, snapshot.value.storage) === false) {
        return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。");
      }
      if (objectError) throw objectError;
      return { attachment: this.view(value), bytes };
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
    const receipt = request.method === "POST" && url.pathname === "/api/app/attachments/receipt";
    const download = request.method === "GET" && /^\/api\/app\/attachments\/att_[a-f0-9]{64}$/.test(url.pathname);
    if (!upload && !receipt && !download) return undefined;
    const babyId = url.searchParams.get("babyId") || request.headers.get("x-baby-id") || "";
    if (!babyId || babyId.length > 200 || (request.headers.has("x-baby-id") && request.headers.get("x-baby-id") !== babyId)) return fail(400, "SCOPE_MISMATCH", "请提供一致的宝宝范围。");
    const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
    if (upload) {
      await service.identity.executeAuthorized(principal, babyId, "media:write", async () => undefined, principal.kind === "collector" ? principal.groupId : undefined);
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
    if (receipt) {
      // Size enforcement is deliberately outside the JSON catch: an oversized
      // body must remain 413 even when its bytes are also invalid JSON.
      const body = await readUploadBody(request, MAX_ATTACHMENT_RECEIPT_JSON_BYTES);
      let input: unknown;
      try { input = JSON.parse(body.toString("utf8")); }
      catch { return fail(400, "INVALID_JSON", "请求格式不正确。"); }
      const parsed = receiptSchema.safeParse(input);
      if (!parsed.success) return fail(400, "ATTACHMENT_RECEIPT_INVALID", "上传回执查询字段不完整或格式不正确。");
      return Response.json({ data: await service.recoverUpload(principal, babyId, parsed.data.requestId, parsed.data.source) }, { status: 200, headers });
    }
    const result = await service.read(principal, babyId, url.pathname.slice("/api/app/attachments/".length));
    return new Response(new Uint8Array(result.bytes), { headers: { ...headers, "Content-Type": result.attachment.mime, "Content-Length": String(result.attachment.byteLength), "Content-Disposition": "inline" } });
  };
}
