import { z } from "zod";
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
import type { AttachmentObjectStore } from "../storage/attachment-objects";
import { MediaOperations } from "../storage/media-operations";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const receiptSchema = z.object({ requestId: z.string().min(1).max(200).refine(value => !!value.trim()), source: sourceSchema.optional() }).strict();
const repairable = (error: unknown) => error instanceof AppError && ["ATTACHMENT_OBJECT_MISSING", "ATTACHMENT_OBJECT_CORRUPT"].includes(error.code);
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
  storage?: { kind: "oss"; key: string };
}
interface AttachmentOptions { imageReview?: ImageReviewService; directory: string; maxBytes?: number; encryptionKey?: string; beforeLegacyAccess?: (babyId: string) => Promise<void>; objectStore?: AttachmentObjectStore }
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
  private readonly uploads = new Map<string, Promise<unknown>>();
  private readonly objectDirectory: string;
  private readonly objectStore: AttachmentObjectStore | undefined;
  private readonly mediaOperations: MediaOperations | undefined;
  readonly maxBytes: number;
  private readonly encryptionKey: Buffer;
  constructor(readonly identity: IdentityService, private readonly options: AttachmentOptions) {
    this.repository = new RecordsRepository(identity.store.payload);
    this.objectDirectory = path.join(path.resolve(options.directory), "private-attachments");
    this.objectStore = options.objectStore;
    this.mediaOperations = this.objectStore ? new MediaOperations(identity, this.objectStore) : undefined;
    this.encryptionKey = mediaKey(options.directory, options.encryptionKey);
    this.maxBytes = options.maxBytes ?? MAX_ATTACHMENT_BYTES;
    if (!Number.isInteger(this.maxBytes) || this.maxBytes < 1 || this.maxBytes > MAX_ATTACHMENT_BYTES) throw new Error("Attachment size limit must be within 1–10485760 bytes");
  }
  private view(value: StoredAttachment): Attachment {
    return { id: value.id, babyId: value.babyId, mime: value.mime, byteLength: value.byteLength, sha256: value.sha256,
      createdAt: value.createdAt, uploadedBy: value.uploadedBy, ...(value.source ? { source: value.source } : {}),
      url: `/api/app/attachments/${encodeURIComponent(value.id)}?babyId=${encodeURIComponent(value.babyId)}` };
  }
  private attachmentStorage(value: Pick<StoredAttachment, "babyId" | "sha256" | "storage">): { kind: "oss"; key: string } | undefined {
    if (value.storage === undefined) return undefined;
    const key = `${hash(value.babyId)}/${value.sha256}`;
    if (value.storage?.kind !== "oss" || value.storage.key !== key) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用。");
    return value.storage;
  }
  private remoteStorage(value: Pick<StoredAttachment, "babyId" | "sha256" | "storage">): { kind: "oss"; key: string } {
    const storage = this.attachmentStorage(value);
    if (!storage || !this.objectStore) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用。");
    return storage;
  }
  private objectPath(value: Pick<StoredAttachment, "babyId" | "sha256">) {
    if (!/^[a-f0-9]{64}$/.test(value.sha256)) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用。");
    return path.join(this.objectDirectory, hash(value.babyId), value.sha256);
  }
  private async readObject(value: Pick<StoredAttachment, "babyId" | "sha256" | "byteLength" | "storage">): Promise<Buffer> {
    if (value.storage !== undefined) return this.readRemoteObject(value);
    return this.readLocalObject(value);
  }
  private async readLocalObject(value: Pick<StoredAttachment, "babyId" | "sha256" | "byteLength">): Promise<Buffer> {
    let file;
    try {
      file = await open(this.objectPath(value), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== value.byteLength + encryptedMediaOverhead || stat.size > this.maxBytes + encryptedMediaOverhead) throw new Error("Invalid private object");
      const bytes = decryptMedia(await file.readFile(), this.encryptionKey, `${hash(value.babyId)}:${value.sha256}`);
      if (checksum(bytes) !== value.sha256) throw new Error("Private object checksum mismatch");
      return bytes;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return fail(503, code === "ENOENT" ? "ATTACHMENT_OBJECT_MISSING" : file ? "ATTACHMENT_OBJECT_CORRUPT" : "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请重试上传或联系运营。");
    }
    finally { await file?.close(); }
  }
  private async readLocalCiphertext(value: Pick<StoredAttachment, "babyId" | "sha256" | "byteLength">): Promise<Buffer> {
    let file;
    try {
      file = await open(this.objectPath(value), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== value.byteLength + encryptedMediaOverhead || stat.size > this.maxBytes + encryptedMediaOverhead) throw new Error("Invalid private object");
      return await file.readFile();
    } finally { await file?.close(); }
  }
  private async readRemoteObject(value: Pick<StoredAttachment, "babyId" | "sha256" | "byteLength" | "storage">): Promise<Buffer> {
    const storage = this.remoteStorage(value);
    // Provider failures retain their classification; only verified bytes can be corrupt.
    const encrypted = await this.objectStore!.get(storage.key, this.maxBytes + encryptedMediaOverhead);
    try {
      if (encrypted.length !== value.byteLength + encryptedMediaOverhead) throw new Error("Invalid private object size");
      const bytes = decryptMedia(encrypted, this.encryptionKey, `${hash(value.babyId)}:${value.sha256}`);
      if (bytes.length !== value.byteLength || checksum(bytes) !== value.sha256) throw new Error("Private object checksum mismatch");
      return bytes;
    } catch {
      return fail(503, "ATTACHMENT_OBJECT_CORRUPT", "照片内容校验失败，请重试上传。");
    }
  }

  private async putRemoteCiphertext(value: StoredAttachment, encrypted: Buffer): Promise<{ kind: "oss"; key: string }> {
    const storage = { kind: "oss" as const, key: `${hash(value.babyId)}/${value.sha256}` };
    try {
      if (encrypted.length !== value.byteLength + encryptedMediaOverhead) throw new Error("Invalid private object size");
      await this.objectStore!.put(storage.key, encrypted);
      await this.readRemoteObject({ ...value, storage });
      return storage;
    } catch {
      return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请稍后重试。");
    }
  }
  private async putVerifiedRemoteObject<TResult>(value: StoredAttachment, bytes: Uint8Array, beforePut: () => Promise<StoredAttachment>, afterPut: (context: StoredAttachment) => Promise<TResult>): Promise<TResult> {
    if (!this.objectStore || !this.mediaOperations) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用。");
    if (bytes.length !== value.byteLength) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请稍后重试。");
    const key = `${hash(value.babyId)}/${value.sha256}`, storage = { kind: "oss" as const, key };
    let encrypted: Buffer;
    try { encrypted = encryptMedia(bytes, this.encryptionKey, `${hash(value.babyId)}:${value.sha256}`); }
    catch { return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请稍后重试。"); }
    // Do not mask errors here: pre-PUT authorization and post-PUT reauthorization must
    // keep their real codes, while an unverified remote result becomes MEDIA_UPLOAD_UNCERTAIN.
    const objectStore = this.objectStore;
    return await this.mediaOperations.putVerified<StoredAttachment, TResult>({
      babyId: value.babyId,
      actor: { kind: value.actor.kind, id: value.actor.id, ...(value.actor.onBehalfOf ? { onBehalfOf: value.actor.onBehalfOf } : {}) },
      attachmentId: value.id,
      objectKey: key,
      beforePut: async () => beforePut(),
      put: async () => { await objectStore.put(key, encrypted); },
      verify: async () => { await this.readRemoteObject({ ...value, storage }); },
      afterPut: async context => afterPut(context),
    });
  }
  private async writeRemoteObject(value: StoredAttachment, bytes: Uint8Array): Promise<{ kind: "oss"; key: string }> {
    try {
      if (bytes.length !== value.byteLength) throw new Error("Private object size mismatch");
      const encrypted = encryptMedia(bytes, this.encryptionKey, `${hash(value.babyId)}:${value.sha256}`);
      return await this.putRemoteCiphertext(value, encrypted);
    } catch {
      return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用，请稍后重试。");
    }
  }
  private async writeObject(value: StoredAttachment, bytes: Uint8Array) {
    if (value.storage !== undefined) {
      if (!this.objectStore) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片暂时不可用。");
      await this.writeRemoteObject(value, bytes);
      return;
    }
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
  /** Internal lifecycle operation. OSS I/O is serialized in the independent media queue. */
  async purgeFamilyObjects(babyId: string) {
    if (this.objectStore) {
      if (this.identity.store.currentRequest()) return fail(503, "OSS_REMOTE_IO_IN_LOCK", "OSS 照片删除不能在身份队列内执行。");
      return await this.mediaOperations!.purgeFamily(babyId);
    }
    await rm(path.join(this.objectDirectory, hash(babyId)), { recursive: true, force: true });
  }
  async purgeAccountObjects(identityIds: readonly string[], objectKeys: readonly string[]) {
    if (this.objectStore) {
      if (this.identity.store.currentRequest()) return fail(503, "OSS_REMOTE_IO_IN_LOCK", "OSS 照片删除不能在身份队列内执行。");
      await this.mediaOperations!.purgeAccount([...identityIds], objectKeys);
      return;
    }
    await this.identity.exclusive(() => this.identity.store.transaction(async req => {
      const referenced = new Set((await this.identity.store.payload.find({ collection: "care-attachments", pagination: false, limit: 0, depth: 0, overrideAccess: true, req })).docs
        .map(row => `${hash((row.value as StoredAttachment).babyId)}/${(row.value as StoredAttachment).sha256}`));
      for (const key of new Set(objectKeys)) {
        if (!/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(key) || referenced.has(key)) continue;
        await unlink(path.join(this.objectDirectory, key)).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    }));
  }
  async purgeRemovedObjects(objectKeys: readonly string[], olderThan = Number.POSITIVE_INFINITY) {
    if (this.objectStore) {
      if (this.identity.store.currentRequest()) return fail(503, "OSS_REMOTE_IO_IN_LOCK", "OSS 照片清理不能在身份队列内执行。");
      await this.mediaOperations!.purgeOrphans(objectKeys, olderThan);
      return;
    }
    await this.identity.exclusive(() => this.identity.store.transaction(async req => {
      const referenced = new Set((await this.identity.store.payload.find({ collection: "care-attachments", pagination: false, limit: 0, depth: 0, overrideAccess: true, req })).docs
        .map(row => `${hash((row.value as StoredAttachment).babyId)}/${(row.value as StoredAttachment).sha256}`));
      for (const key of new Set(objectKeys)) {
        if (!/^[a-f0-9]{64}\/[a-f0-9]{64}$/.test(key) || referenced.has(key)) continue;
        const file = path.join(this.objectDirectory, key);
        if ((await lstat(file)).mtimeMs < olderThan) await unlink(file);
      }
    }));
  }
  async assertNoUncertainMediaOperations(scope: { babyId?: string; identityIds?: string[] }, req?: PayloadRequest) {
    if (this.mediaOperations && await this.mediaOperations.hasUncertainOperations(scope, req)) throw new AppError(
      503, "MEDIA_UPLOAD_UNCERTAIN", "照片远端结果尚未核实，删除保持重试，需外部核对后处理。",
    );
  }
  async purgeOrphanObjects(req?: PayloadRequest, olderThan = Number.POSITIVE_INFINITY): Promise<void> {
    if (this.objectStore) {
      if (this.identity.store.currentRequest()) return fail(503, "OSS_REMOTE_IO_IN_LOCK", "OSS 照片清理不能在身份队列内执行。");
      // The object-store listing belongs to the media queue, outside the identity transaction.
      await this.mediaOperations!.purgeOrphans([], olderThan);
      return;
    }
    if (!req) return this.identity.exclusive(() => this.identity.store.transaction(request => this.purgeOrphanObjects(request, olderThan)));
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
    if (this.objectStore) return fail(503, "OSS_LIFECYCLE_PENDING", "OSS 附件迁移由专用命令处理，不能跳过远端对象。");
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
  /** Offline migration from verified encrypted local objects to the configured object store. */
  async migrateAttachmentStorage(options: { apply?: boolean; removeLocal?: boolean } = {}): Promise<{ scanned: number; alreadyRemote: number; migrated: number; removedLocal: number; applied: boolean }> {
    const apply = options.apply === true, removeLocal = options.removeLocal === true;
    if (removeLocal && !apply) throw new Error("Local cleanup requires --apply");
    if (!this.objectStore) return fail(503, "ATTACHMENT_OBJECT_STORE_REQUIRED", "未配置 OSS 附件存储。");
    const rows = await this.identity.exclusive(() => this.identity.store.transaction(async req => {
      const found = await this.identity.store.payload.find({ collection: "care-attachments", pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
      return found.docs.map(row => row.value as StoredAttachment);
    }));
    const groups = new Map<string, { remote?: StoredAttachment; local: StoredAttachment[] }>();
    for (const row of rows) {
      const key = `${hash(row.babyId)}/${row.sha256}`;
      const group = groups.get(key) ?? { local: [] };
      if (row.storage !== undefined) {
        this.attachmentStorage(row);
        group.remote = row;
      } else group.local.push(row);
      groups.set(key, group);
    }
    const written = new Map<string, { kind: "oss"; key: string }>();
    for (const [key, group] of groups) {
      if (group.remote) {
        await this.readRemoteObject(group.remote);
        written.set(key, { kind: "oss", key });
        continue;
      }
      // One baby+SHA ciphertext is shared by every attachment ID; verify and upload it once.
      const representative = group.local[0]!;
      const encrypted = await this.readLocalCiphertext(representative);
      const bytes = decryptMedia(encrypted, this.encryptionKey, `${hash(representative.babyId)}:${representative.sha256}`);
      if (bytes.length !== representative.byteLength || checksum(bytes) !== representative.sha256) throw new Error("Local media verification failed");
      if (apply) written.set(key, await this.putRemoteCiphertext(representative, encrypted));
    }
    let removedLocal = 0;
    if (apply) {
      // Commit every reference in one short transaction. A DB failure leaves all local last-good copies intact.
      await this.identity.exclusive(() => this.identity.store.transaction(async req => {
        for (const snapshot of rows) {
          const current = await this.repository.get<StoredAttachment>("care-attachments", snapshot.babyId, snapshot.id, req);
          if (!current || !this.sameStoredAttachment(current, snapshot)) throw new Error("Attachment metadata changed during migration");
          if (snapshot.storage === undefined) {
            const storage = written.get(`${hash(snapshot.babyId)}/${snapshot.sha256}`);
            if (!storage) throw new Error("Verified media object is missing from migration plan");
            await this.repository.put("care-attachments", snapshot.babyId, snapshot.id, { ...current, storage }, req);
          }
        }
      }));
      for (const [key, group] of groups) {
        const storage = written.get(key)!;
        const representative = group.remote ?? group.local[0]!;
        if (!representative) throw new Error("Verified media object is missing from migration plan");
        await this.readRemoteObject({ ...representative, storage });
      }
      for (const [key, group] of groups) {
        const storage = written.get(key)!;
        const representative = group.remote ?? group.local[0]!;
        if (removeLocal && representative && await this.verifyAndRemoveLocal({ ...representative, storage })) removedLocal += 1;
      }
    }
    const alreadyRemote = rows.filter(row => row.storage !== undefined).length;
    const migrated = rows.filter(row => row.storage === undefined && apply).length;
    return { scanned: rows.length, alreadyRemote, migrated, removedLocal, applied: apply };
  }
  private async verifyAndRemoveLocal(value: StoredAttachment): Promise<boolean> {
    let encrypted: Buffer;
    try { encrypted = await this.readLocalCiphertext(value); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    const bytes = decryptMedia(encrypted, this.encryptionKey, `${hash(value.babyId)}:${value.sha256}`);
    if (bytes.length !== value.byteLength || checksum(bytes) !== value.sha256) throw new Error("Local media verification failed");
    const target = this.objectPath(value), parent = await open(path.dirname(target), constants.O_RDONLY);
    try { await unlink(target); await parent.sync(); }
    finally { await parent.close(); }
    return true;
  }
  /** Offline, verified legacy migration only; no HTTP/MCP endpoint exposes this capability. */
  async importLegacy(babyId: string, reference: LegacyMediaReference, bytes: Uint8Array, declaredMime: string): Promise<Attachment> {
    if (!babyId || babyId.length > 200 || !["activity", "baby-avatar", "profile-avatar", "legacy-source"].includes(reference.kind) || !reference.documentId || reference.documentId.length > 200) throw new Error("Invalid legacy media scope");
    if (!bytes.byteLength || bytes.byteLength > this.maxBytes) throw new Error("Invalid legacy media size");
    const originalSha = checksum(bytes), normalized = await sanitizeAttachment(bytes, declaredMime);
    if (normalized.bytes.length > this.maxBytes) throw new Error("Invalid normalized legacy media size");
    const prepare = async (req: PayloadRequest) => {
      await this.options.beforeLegacyAccess?.(babyId);
      const id = `att_${hash(["legacy-media-v1", babyId, reference])}`, requestFingerprint = hash([reference, originalSha]);
      const existing = await this.repository.get<StoredAttachment>("care-attachments", babyId, id, req);
      if (existing && existing.requestFingerprint !== requestFingerprint) throw new Error("Legacy media source changed; migration stopped");
      const value: StoredAttachment = existing ? { ...existing, mime: normalized.mime, byteLength: normalized.bytes.length, sha256: checksum(normalized.bytes) } : { id, babyId, mime: normalized.mime, byteLength: normalized.bytes.length, sha256: checksum(normalized.bytes), requestFingerprint,
        createdAt: new Date(this.identity.now()).toISOString(), legacyReference: reference,
        actor: { kind: "operator", id: "legacy-media-migration", sessionId: "offline-migration" }, uploadedBy: { kind: "operator", id: "legacy-media-migration" } };
      await this.options.beforeLegacyAccess?.(babyId);
      return value;
    };
    if (this.objectStore) {
      const expected = await this.identity.exclusive(() => this.identity.store.transaction(prepare));
      if (expected.storage !== undefined) {
        await this.readRemoteObject(expected);
        return this.view(expected);
      }
      if (expected.requestFingerprint !== hash([reference, originalSha])) throw new Error("Legacy media source changed; migration stopped");
      return this.putVerifiedRemoteObject(expected, normalized.bytes,
        async () => this.identity.exclusive(() => this.identity.store.transaction(async req => {
          const current = await prepare(req);
          if (!this.sameStoredAttachment(current, expected)) throw new Error("Legacy media changed during migration");
          return current;
        })),
        async () => this.identity.exclusive(() => this.identity.store.transaction(async req => {
          await this.options.beforeLegacyAccess?.(babyId);
          const current = await prepare(req);
          if (!this.sameStoredAttachment(current, expected)) throw new Error("Legacy media changed during migration");
          const value = { ...current, storage: { kind: "oss" as const, key: `${hash(babyId)}/${checksum(normalized.bytes)}` } };
          await this.repository.put("care-attachments", babyId, value.id, value, req);
          return this.view(value);
        })));
    }
    return this.identity.exclusive(() => this.identity.store.transaction(async req => {
      const value = await prepare(req);
      await this.writeObject(value, normalized.bytes);
      await this.repository.put("care-attachments", babyId, value.id, value, req);
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
    const stored = await this.storedAttachment(scope, req, attachmentId);
    if (stored.storage !== undefined) return fail(503, "OSS_REMOTE_IO_IN_LOCK", "OSS 照片读取必须在身份队列外进行，已拒绝读取。");
    return { attachment: this.view(stored), bytes: await this.readObject(stored) };
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
    return this.view(await this.storedAttachment(scope, req, attachmentId));
  }
  private async storedAttachment(scope: ActorScope, req: PayloadRequest, attachmentId: string): Promise<StoredAttachment> {
    if (!scope.permissions.includes("media:read")) return fail(403, "BABY_FORBIDDEN", "没有此宝宝的照片访问权限。");
    const value = await this.repository.get<StoredAttachment>("care-attachments", scope.babyId, attachmentId, req);
    if (!value || value.babyId !== scope.babyId) return fail(404, "ATTACHMENT_NOT_FOUND", "没有找到此宝宝的照片。");
    if (scope.actor.kind === "collector" && (!scope.groupId || value.source?.groupId !== scope.groupId || value.source.kind !== "wechat")) return fail(403, "ATTACHMENT_SOURCE_FORBIDDEN", "照片来源不属于此采集群。");
    if (scope.actor.kind === "collector" || scope.actor.kind === "chat-agent" && scope.actor.purpose !== "history") this.options.imageReview?.requireProof(value.review, value.sha256);
    return value;
  }
  private sameStoredAttachment(left: StoredAttachment, right: StoredAttachment) {
    return hash(left) === hash(right);
  }
  private sameUploadSnapshot(left: StoredAttachment, right: StoredAttachment) {
    return hash({ ...left, createdAt: undefined }) === hash({ ...right, createdAt: undefined });
  }
  async upload(principal: Principal, babyId: string, bytes: Uint8Array, declaredMime: string, requestId: string, source?: SourceRef): Promise<Attachment> {
    // One runtime owns this database. Serialize exact request keys, independently of
    // the identity queue, so concurrent retries reuse the committed winner.
    const key = hash([babyId, requestId]);
    const previous = this.uploads.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(() => this.performUpload(principal, babyId, bytes, declaredMime, requestId, source));
    this.uploads.set(key, result);
    try { return await result; }
    finally { if (this.uploads.get(key) === result) this.uploads.delete(key); }
  }
  private async performUpload(principal: Principal, babyId: string, bytes: Uint8Array, declaredMime: string, requestId: string, source?: SourceRef): Promise<Attachment> {
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
      if (existing && (existing.sha256 !== sha256 || existing.mime !== mime || existing.byteLength !== normalized.bytes.length)) return fail(409, "ATTACHMENT_NORMALIZATION_CHANGED", "照片处理结果已变化，无法覆盖原上传回执。");
      const value: StoredAttachment = existing ? { ...existing } : {
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
    if (prepared.alreadyReviewed) {
      const receipt = await this.recoverUpload(principal, babyId, requestId, source);
      if (receipt.state === "verified") return receipt.attachment;
    }
    const beforeDisclosure = async () => { await this.identity.executeAuthorized(principal, babyId, "media:write", prepare, groupId); };
    const review = prepared.alreadyReviewed ? prepared.value.review : await this.options.imageReview!.inspect(normalized.bytes, mime, sha256, beforeDisclosure);
    if (this.objectStore) {
      const expected = prepared.value;
      const load = () => this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
        await this.identity.assertRecordingService(principal, babyId, req);
        const current = await prepare(scope, req);
        if (!this.sameUploadSnapshot(current, expected)) return fail(409, "ATTACHMENT_CHANGED_DURING_UPLOAD", "照片状态在上传过程中发生变化，请重试。");
        return current;
      }, groupId);
      // The durable upload intent and every reauthorization use short transactions; OSS I/O is only in the media queue.
      return this.putVerifiedRemoteObject(expected, normalized.bytes, load, async () => this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
        const current = await prepare(scope, req);
        if (!this.sameUploadSnapshot(current, expected)) return fail(409, "ATTACHMENT_CHANGED_DURING_UPLOAD", "照片状态在上传过程中发生变化，请重试。");
        if (this.options.imageReview) this.options.imageReview.requireProof(review, sha256);
        const value = { ...current, ...(review ? { review } : {}), storage: { kind: "oss" as const, key: `${hash(babyId)}/${sha256}` } };
        await this.identity.assertRecordingService(principal, babyId, req);
        await this.repository.put("care-attachments", babyId, value.id, value, req);
        return this.view(value);
      }, groupId));
    }
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
  async recoverUpload(principal: Principal, babyId: string, requestId: string, source?: SourceRef) {
    const groupId = principal.kind === "collector" ? principal.groupId : undefined;
    const load = () => this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
      await this.identity.assertRecordingService(principal, babyId, req);
      if (!scope.permissions.includes("media:read")) return fail(403, "BABY_FORBIDDEN", "没有照片访问权限。");
      if (!requestId.trim() || requestId.length > 200) return fail(400, "ATTACHMENT_REQUEST_ID_INVALID", "上传请求号无效。");
      const normalizedSource = this.normalizeSource(scope, source);
      const id = `att_${hash([babyId, scope.actor.kind, scope.actor.id, scope.actor.onBehalfOf, scope.groupId, requestId])}`;
      const value = await this.repository.get<StoredAttachment>("care-attachments", babyId, id, req);
      if (!value) return undefined;
      if (value.id !== id || value.babyId !== babyId || hash(value.source) !== hash(normalizedSource)) return fail(409, "ATTACHMENT_IDEMPOTENCY_CONFLICT", "上传回执来源不一致。");
      this.attachmentStorage(value);
      await this.storedAttachment(scope, req, id);
      return value;
    }, groupId);
    const snapshot = await load();
    if (!snapshot) return { state: "absent" as const };
    let objectError: unknown;
    try { await this.readObject(snapshot); } catch (error) { objectError = error; }
    const current = await load();
    if (!current || !this.sameStoredAttachment(snapshot, current)) return fail(503, "ATTACHMENT_UNAVAILABLE", "照片状态已变化，请重试。");
    if (objectError) {
      if (!repairable(objectError)) throw objectError;
      return { state: "needsRepair" as const, id: current.id, mime: current.mime, sha256: current.sha256, requestFingerprint: current.requestFingerprint };
    }
    return { state: "verified" as const, attachment: this.view(current) };
  }
  /** Model input must not use the caregiver/history path to bypass image review. */
  async readForModel(principal: Principal, babyId: string, attachmentId: string) {
    const groupId = principal.kind === "collector" ? principal.groupId : undefined;
    const load = () => this.identity.executeAuthorized(principal, babyId, "media:read", async (scope, req) => {
      const stored = await this.storedAttachment(scope, req, attachmentId);
      this.options.imageReview?.requireProof(stored.review, stored.sha256);
      return stored;
    }, groupId);
    const snapshot = await load();
    if (snapshot.storage !== undefined) {
      const bytes = await this.readObject(snapshot);
      const current = await load();
      if (!this.sameStoredAttachment(snapshot, current)) return fail(409, "ATTACHMENT_CHANGED_DURING_READ", "照片状态在读取过程中发生变化，请重试。");
      return { attachment: this.view(current), bytes };
    }
    return this.identity.executeAuthorized(principal, babyId, "media:read", async (scope, req) => {
      const attachment = await this.validateAttachment(scope, req, attachmentId);
      const stored = await this.repository.get<StoredAttachment>("care-attachments", babyId, attachmentId, req);
      this.options.imageReview?.requireProof(stored?.review, attachment.sha256);
      return { attachment, bytes: await this.readObject(attachment) };
    }, groupId);
  }
  async read(principal: Principal, babyId: string, attachmentId: string): Promise<{ attachment: Attachment; bytes: Buffer }> {
    const groupId = principal.kind === "collector" ? principal.groupId : undefined;
    const load = () => this.identity.executeAuthorized(principal, babyId, "media:read", async (scope, req) => this.storedAttachment(scope, req, attachmentId), groupId);
    const snapshot = await load();
    if (snapshot.storage !== undefined) {
      const bytes = await this.readObject(snapshot);
      const current = await load();
      if (!this.sameStoredAttachment(snapshot, current)) return fail(409, "ATTACHMENT_CHANGED_DURING_READ", "照片状态在读取过程中发生变化，请重试。");
      return { attachment: this.view(current), bytes };
    }
    return this.identity.executeAuthorized(principal, babyId, "media:read", async (scope, req) => {
      const attachment = await this.validateAttachment(scope, req, attachmentId);
      return { attachment, bytes: await this.readObject(attachment) };
    }, groupId);
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
    if (receipt) {
      await service.identity.executeAuthorized(principal, babyId, "media:write", async (_scope, req) => service.identity.assertRecordingService(principal, babyId, req), principal.kind === "collector" ? principal.groupId : undefined);
      const body = await readUploadBody(request, 16 * 1024);
      let input: unknown;
      try { input = JSON.parse(body.toString("utf8")); } catch { return fail(400, "INVALID_JSON", "请求格式不正确。"); }
      const parsed = receiptSchema.safeParse(input);
      if (!parsed.success) return fail(400, "ATTACHMENT_RECEIPT_INVALID", "上传回执查询字段不正确。");
      return Response.json({ data: await service.recoverUpload(principal, babyId, parsed.data.requestId, parsed.data.source) }, { headers });
    }
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
