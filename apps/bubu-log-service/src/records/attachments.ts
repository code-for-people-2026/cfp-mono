import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { PayloadRequest } from "payload";
import sharp from "sharp";
import { AppError } from "../contracts";
import { IdentityService, type ActorScope, type Principal } from "../identity";
import { hash, RecordsRepository } from "./persistence";
import { sourceSchema } from "./schemas";
import type { SourceRef } from "./types";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
export type AttachmentMime = "image/jpeg" | "image/png" | "image/webp";
export interface Attachment {
  id: string; babyId: string; mime: AttachmentMime; byteLength: number; sha256: string;
  createdAt: string; source?: SourceRef;
  uploadedBy: Pick<ActorScope["actor"], "kind" | "id" | "onBehalfOf">;
  url: string;
}
interface StoredAttachment extends Omit<Attachment, "url"> {
  requestFingerprint: string; actor: ActorScope["actor"];
}
interface AttachmentOptions { directory: string; maxBytes?: number }
const fail = (status: number, code: string, message: string): never => { throw new AppError(status, code, message); };
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
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
  readonly maxBytes: number;
  constructor(readonly identity: IdentityService, options: AttachmentOptions) {
    this.repository = new RecordsRepository(identity.store.payload);
    this.objectDirectory = path.join(path.resolve(options.directory), "private-attachments");
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
      if (!stat.isFile() || stat.size !== value.byteLength || stat.size > this.maxBytes) throw new Error("Invalid private object");
      const bytes = await file.readFile();
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
      await file.writeFile(bytes); await file.sync(); await file.close(); file = undefined;
      await rename(temporary, target);
      for (const durableDirectory of [directory, this.objectDirectory, path.dirname(this.objectDirectory)]) {
        const parent = await open(durableDirectory, constants.O_RDONLY);
        try { await parent.sync(); } finally { await parent.close(); }
      }
    } finally { await file?.close(); await unlink(temporary).catch(() => undefined); }
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
    return this.view(value);
  }
  async upload(principal: Principal, babyId: string, bytes: Uint8Array, declaredMime: string, requestId: string, source?: SourceRef): Promise<Attachment> {
    return this.identity.executeAuthorized(principal, babyId, "media:write", async (scope, req) => {
      await this.identity.assertService(babyId, principal.kind === "collector" ? "collection" : "chat", req);
      if (!requestId.trim() || requestId.length > 200) return fail(400, "ATTACHMENT_REQUEST_ID_INVALID", "请提供不超过 200 字符的上传请求号。");
      if (!bytes.byteLength || bytes.byteLength > this.maxBytes) return fail(413, "ATTACHMENT_TOO_LARGE", "照片为空或超过大小限制。");
      const mime = await inspectAttachment(bytes, declaredMime), sha256 = checksum(bytes), normalizedSource = this.normalizeSource(scope, source);
      const attachmentId = `att_${hash([babyId, scope.actor.kind, scope.actor.id, scope.actor.onBehalfOf, scope.groupId, requestId])}`;
      const requestFingerprint = hash([sha256, mime, normalizedSource]);
      const existing = await this.repository.get<StoredAttachment>("care-attachments", babyId, attachmentId, req);
      if (existing && existing.requestFingerprint !== requestFingerprint) return fail(409, "ATTACHMENT_IDEMPOTENCY_CONFLICT", "此上传请求号已用于不同照片或来源。");
      const value: StoredAttachment = existing ?? {
        id: attachmentId, babyId, mime, byteLength: bytes.byteLength, sha256, requestFingerprint,
        createdAt: new Date(this.identity.now()).toISOString(), actor: scope.actor,
        uploadedBy: { kind: scope.actor.kind, id: scope.actor.id, ...(scope.actor.onBehalfOf ? { onBehalfOf: scope.actor.onBehalfOf } : {}) },
        ...(normalizedSource ? { source: normalizedSource } : {}),
      };
      // Exact retries also repair an object lost/corrupted after the original commit, using the same verified bytes.
      await this.identity.authorize(principal, babyId, "media:write", principal.kind === "collector" ? principal.groupId : undefined);
      await this.identity.assertService(babyId, principal.kind === "collector" ? "collection" : "chat", req);
      await this.writeObject(value, bytes);
      await this.identity.assertService(babyId, principal.kind === "collector" ? "collection" : "chat", req);
      if (!existing) await this.repository.put("care-attachments", babyId, attachmentId, value, req);
      return this.view(value);
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
      await service.identity.executeAuthorized(principal, babyId, "media:write", async (_scope, req) => service.identity.assertService(babyId, principal.kind === "collector" ? "collection" : "chat", req), principal.kind === "collector" ? principal.groupId : undefined);
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
