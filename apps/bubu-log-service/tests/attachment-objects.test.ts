import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { configuredAttachmentObjectStore, type AttachmentObjectStore } from "../src/storage/attachment-objects";

const babyHash = "a".repeat(64);
const contentHash = "b".repeat(64);
const key = `${babyHash}/${contentHash}`;
const rootPrefix = "bubu/attachments/v1/";
const fullKey = `${rootPrefix}${key}`;

function fakeClient() {
  return {
    put: vi.fn(async () => ({})),
    get: vi.fn(),
    getStream: vi.fn(),
    delete: vi.fn(async () => ({})),
    list: vi.fn(),
  };
}

function makeStore(env: Partial<NodeJS.ProcessEnv> = {}) {
  const client = fakeClient();
  let clientOptions: unknown;
  const store = configuredAttachmentObjectStore({
    NODE_ENV: "test",
    BUBU_MEDIA_STORAGE: "oss",
    BUBU_OSS_BUCKET: "bubu-bucket",
    BUBU_OSS_REGION: "oss-cn-shenzhen",
    BUBU_OSS_ACCESS_KEY_ID: "access-key-id",
    BUBU_OSS_ACCESS_KEY_SECRET: "access-key-secret",
    BUBU_OSS_SECURITY_TOKEN: "security-token",
    ...env,
  }, (options) => {
    clientOptions = options;
    return client;
  });
  if (!store) throw new Error("expected an OSS attachment store");
  return { client, clientOptions: () => clientOptions, store };
}

function object(name: string, lastModified = "2026-11-11T08:00:00.000Z") {
  return { name, lastModified };
}

function configurationError(env: NodeJS.ProcessEnv) {
  try {
    configuredAttachmentObjectStore(env, vi.fn());
  } catch (error) {
    return error;
  }
  throw new Error("expected configuration to fail");
}

function collect(store: AttachmentObjectStore, prefix: string) {
  return async () => {
    const entries: { key: string; lastModified: number }[] = [];
    for await (const entry of store.list(prefix)) entries.push(entry);
    return entries;
  };
}

describe("configured attachment OSS object storage", () => {
  it("returns no store only for explicit local mode in development or test", () => {
    const createClient = vi.fn();
    expect(configuredAttachmentObjectStore({ NODE_ENV: "test", BUBU_MEDIA_STORAGE: "local" }, createClient)).toBeUndefined();
    expect(configuredAttachmentObjectStore({ NODE_ENV: "development", BUBU_MEDIA_STORAGE: "local" }, createClient)).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
    expect(configuredAttachmentObjectStore({ NODE_ENV: "test" }, createClient)).toBeUndefined();
  });

  it("fails closed for unknown modes and local mode outside development or test", () => {
    const environments: NodeJS.ProcessEnv[] = [
      { NODE_ENV: "test", BUBU_MEDIA_STORAGE: "disk" },
      { NODE_ENV: "production", BUBU_MEDIA_STORAGE: "local" },
      // Node's environment typing intentionally excludes unsupported values. This
      // runtime process may still contain one, so preserve it explicitly here.
      { NODE_ENV: "staging", BUBU_MEDIA_STORAGE: "local" } as unknown as NodeJS.ProcessEnv,
    ];
    for (const env of environments) {
      expect(configurationError(env)).toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    }
  });

  it("requires explicit complete production configuration", () => {
    const required = {
      NODE_ENV: "production",
      BUBU_MEDIA_STORAGE: "oss",
      BUBU_OSS_BUCKET: "bubu-bucket",
      BUBU_OSS_REGION: "oss-cn-shenzhen",
      BUBU_OSS_ACCESS_KEY_ID: "production-key-id",
      BUBU_OSS_ACCESS_KEY_SECRET: "production-key-secret",
    } as const;
    const createClient = vi.fn();
    const environments: NodeJS.ProcessEnv[] = [
      { NODE_ENV: "production" },
      { ...required, BUBU_OSS_BUCKET: undefined },
      { ...required, BUBU_OSS_REGION: undefined },
      { ...required, BUBU_OSS_ACCESS_KEY_ID: undefined },
      { ...required, BUBU_OSS_ACCESS_KEY_SECRET: undefined },
      { ...required, BUBU_OSS_INTERNAL: "yes" },
      { ...required, BUBU_OSS_INTERNAL: "" },
      { ...required, BUBU_OSS_INTERNAL: "TRUE" },
    ];
    for (const env of environments) {
      expect(configurationError(env)).toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it("creates a TLS, V4, non-retrying public client for the mainland region under a validated dedicated prefix", () => {
    const { clientOptions, store } = makeStore({ BUBU_OSS_PREFIX: "bubu/attachments.v1-test/" });
    expect(store.kind).toBe("oss");
    expect(clientOptions()).toEqual({
      bucket: "bubu-bucket",
      region: "oss-cn-shenzhen",
      accessKeyId: "access-key-id",
      accessKeySecret: "access-key-secret",
      stsToken: "security-token",
      secure: true,
      authorizationV4: true,
      internal: false,
      retryMax: 0,
      timeout: 20_000,
    });
  });

  it("accepts explicit internal routing but rejects unsafe bucket and region identifiers", () => {
    const { clientOptions } = makeStore({ BUBU_OSS_INTERNAL: "true" });
    expect(clientOptions()).toMatchObject({ region: "oss-cn-shenzhen", internal: true });

    const required = {
      NODE_ENV: "test",
      BUBU_MEDIA_STORAGE: "oss",
      BUBU_OSS_ACCESS_KEY_ID: "access-key-id",
      BUBU_OSS_ACCESS_KEY_SECRET: "access-key-secret",
    } as const;
    const unsafe = [
      { ...required, BUBU_OSS_BUCKET: "bubu bucket", BUBU_OSS_REGION: "oss-cn-shenzhen" },
      { ...required, BUBU_OSS_BUCKET: "BubuBucket", BUBU_OSS_REGION: "oss-cn-shenzhen" },
      { ...required, BUBU_OSS_BUCKET: "bubu-bucket.evil.example", BUBU_OSS_REGION: "oss-cn-shenzhen" },
      { ...required, BUBU_OSS_BUCKET: "-bucket", BUBU_OSS_REGION: "oss-cn-shenzhen" },
      { ...required, BUBU_OSS_BUCKET: "b--ucket", BUBU_OSS_REGION: "oss-cn-shenzhen" },
      { ...required, BUBU_OSS_BUCKET: "bubu-bucket", BUBU_OSS_REGION: "https://oss-cn-shenzhen.aliyuncs.com" },
      { ...required, BUBU_OSS_BUCKET: "bubu-bucket", BUBU_OSS_REGION: "oss-cn-shenzhen internal" },
      { ...required, BUBU_OSS_BUCKET: "bubu-bucket", BUBU_OSS_REGION: "oss-cn-shenzhen/" },
      { ...required, BUBU_OSS_BUCKET: "bubu-bucket", BUBU_OSS_REGION: "OSS-CN-SHENZHEN" },
      { ...required, BUBU_OSS_BUCKET: "bubu-bucket", BUBU_OSS_REGION: "cn-shenzhen" },
    ];
    for (const env of unsafe) {
      const error = configurationError(env);
      expect(error).toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
      expect((error as Error).message).toBe("附件存储暂不可用，请稍后重试。");
    }
  });

  it("sanitizes malformed prefix configuration without echoing environment values", () => {
    const malformed = "bubu/secret-../attachments/";
    const error = configurationError({
      NODE_ENV: "test",
      BUBU_MEDIA_STORAGE: "oss",
      BUBU_OSS_BUCKET: "bubu-bucket",
      BUBU_OSS_REGION: "oss-cn-shenzhen",
      BUBU_OSS_ACCESS_KEY_ID: "secret-key-id",
      BUBU_OSS_ACCESS_KEY_SECRET: "secret-key-secret",
      BUBU_OSS_INTERNAL: "true",
      BUBU_OSS_PREFIX: malformed,
    });
    expect(error).toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    const message = (error as Error).message;
    expect(message).not.toContain(malformed);
    expect(message).not.toContain("secret-key");
  });
});

describe("attachment OSS object operations", () => {
  it("uploads private encrypted octet streams only under the dedicated prefix", async () => {
    const { client, store } = makeStore();
    const parent = new Uint8Array([99, 1, 2, 3, 99]);
    const view = parent.subarray(1, 4);
    await store.put(key, view);
    expect(client.put).toHaveBeenCalledWith(fullKey, Buffer.from([1, 2, 3]), {
      timeout: 20_000,
      mime: "application/octet-stream",
      headers: {
        "x-oss-object-acl": "private",
        "x-oss-server-side-encryption": "AES256",
      },
    });
  });

  it("rejects relative-key and list-prefix escapes without an SDK call", async () => {
    const { client, store } = makeStore();
    const badKey = `../${contentHash}`;
    await expect(store.put(badKey, new Uint8Array())).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    await expect(store.get("not-a-key", 10)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    await expect(store.remove(`${babyHash}/${contentHash}/../${contentHash}`)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    await expect(collect(store, `${babyHash}/../`)()).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    await expect(collect(store, `${babyHash.slice(0, 63)}/`)()).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    await expect(collect(store, `//`)()).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    expect(client.put).not.toHaveBeenCalled();
    expect(client.getStream).not.toHaveBeenCalled();
    expect(client.delete).not.toHaveBeenCalled();
    expect(client.list).not.toHaveBeenCalled();
  });

  it("reads a bounded stream and uses an optional content-length precheck", async () => {
    const { client, store } = makeStore();
    const stream = Readable.from([Buffer.from("ab"), Buffer.from("cd")]);
    client.getStream.mockResolvedValue({ stream, res: { headers: { "content-length": "4" } } });
    await expect(store.get(key, 4)).resolves.toEqual(Buffer.from("abcd"));
    expect(client.get).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);

    const declaredOversized = Readable.from([Buffer.from("abc")]);
    client.getStream.mockResolvedValue({ stream: declaredOversized, res: { headers: { "content-length": "3" } } });
    await expect(store.get(key, 2)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_OBJECT_CORRUPT" });
    expect(declaredOversized.destroyed).toBe(true);
  });

  it("rejects when streamed content exceeds the caller bound", async () => {
    const { client, store } = makeStore();
    const unheadered = Readable.from([Buffer.from("ab"), Buffer.from("c")]);
    client.getStream.mockResolvedValueOnce({ stream: unheadered });
    await expect(store.get(key, 2)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_OBJECT_CORRUPT" });
    expect(unheadered.destroyed).toBe(true);

    const underreported = Readable.from([Buffer.from("ab"), Buffer.from("c")]);
    client.getStream.mockResolvedValueOnce({ stream: underreported, res: { headers: { "content-length": "2" } } });
    await expect(store.get(key, 2)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_OBJECT_CORRUPT" });
    expect(underreported.destroyed).toBe(true);
  });

  it("keeps an invalid caller bound unavailable rather than repairable corruption", async () => {
    const { client, store } = makeStore();
    for (const maxBytes of [-1, 1.5, Number.NaN]) {
      await expect(store.get(key, maxBytes)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    }
    expect(client.getStream).not.toHaveBeenCalled();
  });

  it("sanitizes stream errors", async () => {
    const { client, store } = makeStore();
    const stream = new Readable({ read() { this.destroy(new Error("provider secret")); } });
    client.getStream.mockResolvedValue({ stream });
    await expect(store.get(key, 10)).rejects.toSatisfy((error: unknown) => {
      const appError = error as { status?: number; code?: string; message?: string };
      return appError.status === 503 && appError.code === "ATTACHMENT_STORAGE_UNAVAILABLE" && !appError.message?.includes("provider secret");
    });
  });

  it("enforces the read deadline and destroys a stalled stream", async () => {
    vi.useFakeTimers();
    try {
      const { client, store } = makeStore();
      const stream = new Readable({ read() { /* stall */ } });
      client.getStream.mockResolvedValue({ stream });
      const pending = store.get(key, 10);
      const rejection = expect(pending).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
      await vi.advanceTimersByTimeAsync(20_000);
      await rejection;
      expect(stream.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("destroys a stream if provider headers resolve after the total read deadline", async () => {
    vi.useFakeTimers();
    try {
      const { client, store } = makeStore();
      let resolveHeaders: ((value: { stream: Readable }) => void) | undefined;
      client.getStream.mockReturnValue(new Promise<{ stream: Readable }>((resolve) => {
        resolveHeaders = resolve;
      }));
      const stream = new Readable({ read() { /* stall */ } });
      const pending = store.get(key, 10);
      const rejection = expect(pending).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
      await vi.advanceTimersByTimeAsync(20_000);
      resolveHeaders?.({ stream });
      await vi.advanceTimersByTimeAsync(0);
      await rejection;
      expect(stream.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives put, remove, and list bounded deadlines", async () => {
    vi.useFakeTimers();
    try {
      const { client, store } = makeStore();
      const never = () => new Promise<never>(() => undefined);
      client.put.mockImplementation(never);
      client.delete.mockImplementation(never);
      client.list.mockImplementation(never);
      const operations = [
        expect(store.put(key, new Uint8Array())).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" }),
        expect(store.remove(key)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" }),
        expect(collect(store, "")()).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" }),
      ];
      await vi.advanceTimersByTimeAsync(20_000);
      await Promise.all(operations);
      expect(vi.getTimerCount()).toBe(0);
      expect(client.put).toHaveBeenCalledWith(fullKey, Buffer.from([]), expect.anything());
      expect(client.delete).toHaveBeenCalledWith(fullKey, { timeout: 20_000 });
      expect(client.list).toHaveBeenCalledWith({ prefix: rootPrefix, "max-keys": 1_000 }, { timeout: 20_000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not charge list consumer time to the next page deadline", async () => {
    vi.useFakeTimers();
    try {
      const { client, store } = makeStore();
      const secondHash = "c".repeat(64);
      const secondKey = `${babyHash}/${secondHash}`;
      client.list
        .mockResolvedValueOnce({ objects: [object(fullKey)], isTruncated: true, nextMarker: fullKey })
        .mockResolvedValueOnce({ objects: [object(`${rootPrefix}${secondKey}`)], isTruncated: false, nextMarker: "" });
      const iterator = store.list("")[Symbol.asyncIterator]();

      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { key, lastModified: Date.parse("2026-11-11T08:00:00.000Z") },
      });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(vi.getTimerCount()).toBe(0);
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: { key: secondKey, lastModified: Date.parse("2026-11-11T08:00:00.000Z") },
      });
      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
      expect(client.list).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sanitizes get and put provider failures", async () => {
    const { client, store } = makeStore();
    client.put.mockRejectedValue(new Error("PUT access-key-secret"));
    client.getStream.mockRejectedValue(new Error("GET oss-cn-hangzhou"));
    await expect(store.put(key, new Uint8Array())).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    await expect(store.get(key, 10)).rejects.toSatisfy((error: unknown) => {
      const appError = error as { status?: number; code?: string; message?: string };
      return appError.status === 503 && appError.code === "ATTACHMENT_STORAGE_UNAVAILABLE" && !appError.message?.includes("oss-cn-hangzhou");
    });
  });

  it("maps only OSS NoSuchKey to a sanitized missing-object error", async () => {
    const { client, store } = makeStore();
    const missing = Object.assign(new Error("NoSuchKey request-id secret"), { status: 404, code: "NoSuchKey" });
    client.getStream.mockRejectedValueOnce(missing);
    await expect(store.get(key, 10)).rejects.toSatisfy((error: unknown) => {
      const appError = error as { status?: number; code?: string; message?: string };
      return appError.status === 404 && appError.code === "ATTACHMENT_OBJECT_MISSING" &&
        !appError.message?.includes("request-id") && !appError.message?.includes("secret");
    });

    const transient = [
      Object.assign(new Error("timeout secret"), { status: -2, code: "ResponseTimeoutError" }),
      Object.assign(new Error("rate-limit secret"), { status: 429, code: "TooManyRequests" }),
      Object.assign(new Error("auth secret"), { status: 401, code: "AccessDenied" }),
      Object.assign(new Error("server secret"), { status: 500, code: "InternalError" }),
    ];
    for (const error of transient) client.getStream.mockRejectedValueOnce(error);
    for (let index = 0; index < transient.length; index += 1) {
      await expect(store.get(key, 10)).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    }
  });

  it("lists only validated relative keys from the dedicated prefix with pagination", async () => {
    const { client, store } = makeStore();
    const secondHash = "c".repeat(64);
    client.list.mockResolvedValueOnce({
      objects: [object(fullKey)],
      isTruncated: true,
      nextMarker: fullKey,
    }).mockResolvedValueOnce({
      objects: [object(`${rootPrefix}${babyHash}/${secondHash}`)],
      isTruncated: false,
      nextMarker: "",
    });
    await expect(collect(store, `${babyHash}/`)()).resolves.toEqual([
      { key, lastModified: Date.parse("2026-11-11T08:00:00.000Z") },
      { key: `${babyHash}/${secondHash}`, lastModified: Date.parse("2026-11-11T08:00:00.000Z") },
    ]);
    const queryPrefix = `${rootPrefix}${babyHash}/`;
    expect(client.list).toHaveBeenNthCalledWith(1, { prefix: queryPrefix, "max-keys": 1_000 }, { timeout: 20_000 });
    expect(client.list).toHaveBeenNthCalledWith(2, { prefix: queryPrefix, marker: fullKey, "max-keys": 1_000 }, { timeout: 20_000 });
  });

  it("rejects unexpected names leaked by a prefix listing", async () => {
    const { client, store } = makeStore();
    const escapedName = `${rootPrefix}unexpected/${contentHash}`;
    client.list.mockResolvedValue({ objects: [object(escapedName)], isTruncated: false, nextMarker: "" });
    const entries: unknown[] = [];
    await expect(async () => {
      for await (const entry of store.list("")) entries.push(entry);
    }).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    expect(entries).toEqual([]);
    expect(client.list).toHaveBeenCalledWith({ prefix: rootPrefix, "max-keys": 1_000 }, { timeout: 20_000 });
  });

  it("detects repeated list markers after an intervening marker", async () => {
    const { client, store } = makeStore();
    const secondKey = `${babyHash}/${"c".repeat(64)}`;
    client.list
      .mockResolvedValueOnce({ objects: [object(fullKey)], isTruncated: true, nextMarker: fullKey })
      .mockResolvedValueOnce({ objects: [object(`${rootPrefix}${secondKey}`)], isTruncated: true, nextMarker: `${rootPrefix}${secondKey}` })
      .mockResolvedValueOnce({ objects: [object(fullKey)], isTruncated: true, nextMarker: fullKey });
    const entries: unknown[] = [];
    await expect(async () => {
      for await (const entry of store.list("")) entries.push(entry);
    }).rejects.toMatchObject({ status: 503, code: "ATTACHMENT_STORAGE_UNAVAILABLE" });
    expect(client.list).toHaveBeenCalledTimes(3);
    expect(entries).toEqual([
      { key, lastModified: Date.parse("2026-11-11T08:00:00.000Z") },
      { key: secondKey, lastModified: Date.parse("2026-11-11T08:00:00.000Z") },
    ]);
  });
});
