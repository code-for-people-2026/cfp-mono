import OSS from "ali-oss";
import { AppError } from "../contracts";

export interface AttachmentObjectStore {
  readonly kind: "oss";
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string, maxBytes: number): Promise<Buffer>;
  remove(key: string): Promise<void>;
  list(prefix: string): AsyncIterable<{ key: string; lastModified: number }>;
}

interface ReadableLike {
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
  destroy?(error?: Error): void;
}

interface OssClient {
  put(name: string, file: unknown, options?: OSS.PutObjectOptions): Promise<unknown>;
  getStream(name: string, options?: OSS.GetStreamOptions): Promise<{ stream?: unknown; res?: { headers?: unknown } }>;
  delete(name: string, options?: OSS.RequestOptions): Promise<unknown>;
  list(query: OSS.ListObjectsQuery, options: OSS.RequestOptions): Promise<OSS.ListObjectResult>;
}

type OssClientOptions = OSS.Options & { retryMax: number };
type OssClientFactory = (options: OssClientOptions) => OssClient;

const DEFAULT_PREFIX = "bubu/attachments/v1/";
const DEADLINE_MS = 20_000;
const LIST_PAGE_SIZE = 1_000;
const MAX_LIST_PAGES = 1_000;
const ATTACHMENT_KEY = /^[a-f0-9]{64}\/[a-f0-9]{64}$/;
const ATTACHMENT_LIST_PREFIX = /^(?:[a-f0-9]{64}\/)?$/;
const SAFE_PREFIX_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const OSS_BUCKET = /^[a-z0-9-]+$/;
const OSS_REGION = /^oss-cn-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ROOT_PREFIX_LENGTH = 512;
const MAX_ROOT_PREFIX_SEGMENT_LENGTH = 128;

function storageUnavailable(): AppError {
  return new AppError(503, "ATTACHMENT_STORAGE_UNAVAILABLE", "附件存储暂不可用，请稍后重试。");
}

function objectMissing(): AppError {
  return new AppError(404, "ATTACHMENT_OBJECT_MISSING", "照片对象缺失，请重新上传修复。");
}

function objectCorrupt(): AppError {
  return new AppError(503, "ATTACHMENT_OBJECT_CORRUPT", "照片暂时不可用，请重试上传或联系运营。");
}

function unavailable(): never {
  throw storageUnavailable();
}

function isKnownAttachmentError(error: unknown): error is AppError {
  return error instanceof AppError && (
    error.code === "ATTACHMENT_STORAGE_UNAVAILABLE" ||
    error.code === "ATTACHMENT_OBJECT_MISSING" ||
    error.code === "ATTACHMENT_OBJECT_CORRUPT"
  );
}

function storageFailure(error: unknown, missingIsAbsent = false): AppError {
  if (isKnownAttachmentError(error)) return error;
  if (missingIsAbsent && isNoSuchKey(error)) return objectMissing();
  return storageUnavailable();
}

function isNoSuchKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return candidate.status === 404 && candidate.code === "NoSuchKey";
}

interface Deadline {
  readonly expired: boolean;
  readonly expiration: Promise<never>;
  clear(): void;
}

function startDeadline(): Deadline {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiration = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(storageUnavailable());
    }, DEADLINE_MS);
  });
  return {
    get expired() { return expired; },
    expiration,
    clear() {
      if (timer) clearTimeout(timer);
    },
  };
}

async function withDeadline<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = startDeadline();
  try {
    return await Promise.race([operation(), deadline.expiration]);
  } finally {
    deadline.clear();
  }
}

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function parseRootPrefix(value: string | undefined): string {
  const prefix = value ?? DEFAULT_PREFIX;
  if (prefix.length > MAX_ROOT_PREFIX_LENGTH || !prefix.startsWith("bubu/") || !prefix.endsWith("/")) unavailable();
  const segments = prefix.slice(0, -1).split("/");
  if (segments.some((segment) => segment.length === 0 || segment.length > MAX_ROOT_PREFIX_SEGMENT_LENGTH ||
      !SAFE_PREFIX_SEGMENT.test(segment) || segment === "." || segment.includes(".."))) unavailable();
  return prefix;
}

function attachmentKey(key: string, rootPrefix: string): string {
  if (!ATTACHMENT_KEY.test(key)) unavailable();
  return `${rootPrefix}${key}`;
}

function listPrefix(prefix: string, rootPrefix: string): string {
  if (!ATTACHMENT_LIST_PREFIX.test(prefix)) unavailable();
  return `${rootPrefix}${prefix}`;
}

function contentLength(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined;
}

function putBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readableStream(value: unknown): ReadableLike | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const iterator = (value as Record<symbol, unknown>)[Symbol.asyncIterator];
  return typeof iterator === "function" ? value as ReadableLike : undefined;
}

async function readBoundedStream(stream: ReadableLike, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const value of stream) {
      if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw storageUnavailable();
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) throw objectCorrupt();
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    stream.destroy?.();
  }
}

function createStore(rootPrefix: string, client: OssClient): AttachmentObjectStore {
  return {
    kind: "oss",
    async put(key, bytes) {
      const name = attachmentKey(key, rootPrefix);
      if (!(bytes instanceof Uint8Array)) unavailable();
      const bytesToSend = putBuffer(bytes);
      try {
        await withDeadline(() => client.put(name, bytesToSend, {
          timeout: DEADLINE_MS,
          mime: "application/octet-stream",
          headers: {
            "x-oss-object-acl": "private",
            "x-oss-server-side-encryption": "AES256",
          },
        }));
      } catch {
        throw storageUnavailable();
      }
    },
    async get(key, maxBytes) {
      let stream: ReadableLike | undefined;
      const deadline = startDeadline();
      try {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) unavailable();
        const request = client.getStream(attachmentKey(key, rootPrefix), { timeout: DEADLINE_MS });
        // A timeout must not leave a stream created by a late provider response open.
        void request.then((lateResult) => {
          const lateStream = lateResult && readableStream(lateResult.stream);
          if (!lateStream) return;
          if (deadline.expired) lateStream.destroy?.();
          else stream = lateStream;
        }, () => undefined);
        const result = await Promise.race([request, deadline.expiration]);
        const returnedStream = result && readableStream(result.stream);
        if (!result || !returnedStream) unavailable();
        stream = returnedStream;
        const headers = result.res?.headers as Record<string, unknown> | undefined;
        const declaredLength = contentLength(headers?.["content-length"] ?? headers?.["Content-Length"]);
        if (declaredLength !== undefined && declaredLength > maxBytes) throw objectCorrupt();
        return await Promise.race([readBoundedStream(stream, maxBytes), deadline.expiration]);
      } catch (error) {
        stream?.destroy?.();
        throw storageFailure(error, true);
      } finally {
        deadline.clear();
      }
    },
    async remove(key) {
      try {
        const name = attachmentKey(key, rootPrefix);
        await withDeadline(() => client.delete(name, { timeout: DEADLINE_MS }));
      } catch (error) {
        throw storageFailure(error, true);
      }
    },
    async *list(prefix) {
      const fullPrefix = listPrefix(prefix, rootPrefix);
      let marker: string | undefined;
      const seenMarkers = new Set<string>();
      try {
        for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
          const result = await withDeadline(() => client.list({
            prefix: fullPrefix,
            ...(marker ? { marker } : {}),
            "max-keys": LIST_PAGE_SIZE,
          }, { timeout: DEADLINE_MS }));
          const entries = (result.objects ?? []).map((object) => {
            if (!object.name.startsWith(fullPrefix)) unavailable();
            const key = object.name.slice(rootPrefix.length);
            if (!ATTACHMENT_KEY.test(key)) unavailable();
            const lastModified = Date.parse(object.lastModified);
            if (!Number.isFinite(lastModified)) unavailable();
            return { key, lastModified };
          });
          if (!result.isTruncated) {
            yield *entries;
            return;
          }
          const nextMarker = result.nextMarker;
          if (!nextMarker || seenMarkers.has(nextMarker) || !nextMarker.startsWith(fullPrefix)) unavailable();
          seenMarkers.add(nextMarker);
          marker = nextMarker;
          yield *entries;
        }
        unavailable();
      } catch (error) {
        throw storageFailure(error);
      }
    },
  };
}

function createDefaultClient(options: OssClientOptions): OssClient {
  return new OSS(options);
}

export function configuredAttachmentObjectStore(
  env: NodeJS.ProcessEnv = process.env,
  createClient: OssClientFactory = createDefaultClient,
): AttachmentObjectStore | undefined {
  try {
    const nodeEnv = env.NODE_ENV ?? "development";
    const localModeAllowed = nodeEnv === "development" || nodeEnv === "test";
    const mode = env.BUBU_MEDIA_STORAGE ?? "local";
    if (mode === "local") {
      if (!localModeAllowed) unavailable();
      return undefined;
    }
    if (mode !== "oss") unavailable();

    const { BUBU_OSS_BUCKET: bucket, BUBU_OSS_REGION: region } = env;
    const accessKeyId = env.BUBU_OSS_ACCESS_KEY_ID;
    const accessKeySecret = env.BUBU_OSS_ACCESS_KEY_SECRET;
    if (!isNonEmpty(bucket) || bucket.length < 3 || bucket.length > 63 || !OSS_BUCKET.test(bucket) ||
        bucket.startsWith("-") || bucket.endsWith("-") || bucket.includes("--")) unavailable();
    if (!isNonEmpty(region) || region.length > 63 || !OSS_REGION.test(region)) unavailable();
    if (!isNonEmpty(accessKeyId) || !isNonEmpty(accessKeySecret)) unavailable();

    const internalValue = env.BUBU_OSS_INTERNAL;
    if (internalValue !== undefined && internalValue !== "true" && internalValue !== "false") unavailable();
    const internal = internalValue === "true";
    const rootPrefix = parseRootPrefix(env.BUBU_OSS_PREFIX);
    const client = createClient({
      bucket,
      region,
      accessKeyId,
      accessKeySecret,
      ...(env.BUBU_OSS_SECURITY_TOKEN ? { stsToken: env.BUBU_OSS_SECURITY_TOKEN } : {}),
      secure: true,
      authorizationV4: true,
      internal,
      retryMax: 0,
      timeout: DEADLINE_MS,
    });
    return createStore(rootPrefix, client);
  } catch (error) {
    throw storageFailure(error);
  }
}
