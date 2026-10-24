import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readLegacyPhoto, protectLegacyPhotos } from "../src/media";
import { createHandler } from "../src/http";
import { identityFixture, type IdentityFixture } from "./fixtures/identity";

const photoOrigin = "https://photos.example.test";
const activity = { id: "activity-1", babyId: "baby-a", type: "DIAPER", poopPhotoUrl: `${photoOrigin}/private-photo.png` };
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
afterEach(() => { vi.restoreAllMocks(); });

describe("legacy photo URLs exposed through authorized routes", () => {
  it("rewrites photos to a baby-scoped service route without modifying persisted data", () => {
    const input = { ...activity, id: "record/with?syntax", babyId: "baby with space" };
    const result = protectLegacyPhotos(input, "baby with space");
    expect(result).toEqual({ ...input, poopPhotoUrl: "/api/app/media/activities/record%2Fwith%3Fsyntax?babyId=baby%20with%20space" });
    expect(input.poopPhotoUrl).toBe(activity.poopPhotoUrl);
  });
  it("rewrites lists while keeping ordinary legacy fields and missing photos unchanged", () => {
    const ordinary = { id: "no-photo", babyId: "baby-a", type: "SLEEP", notes: "原备注", poopPhotoUrl: null };
    expect(protectLegacyPhotos([activity, ordinary], "baby-a")).toEqual([
      { ...activity, poopPhotoUrl: "/api/app/media/activities/activity-1?babyId=baby-a" }, ordinary,
    ]);
    expect(protectLegacyPhotos(null, "baby-a")).toBeNull();
  });
  it("refuses to mint a media URL for another baby's record or an unidentified record", () => {
    expect(() => protectLegacyPhotos(activity, "baby-b")).toThrow("记录不属于当前宝宝");
    expect(() => protectLegacyPhotos({ ...activity, id: undefined }, "baby-a")).toThrow("记录不属于当前宝宝");
  });
});

describe("legacy photo proxy security", () => {
  it.each(["image/png", "image/jpeg", "image/webp", "image/gif"])("serves allowed %s privately with no redirects or upstream headers", async (contentType) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, { headers: { "Content-Type": `${contentType}; charset=binary`, "Set-Cookie": "provider-secret=value", "Access-Control-Allow-Origin": "*", Location: "https://outside.example" } }));
    const response = await readLegacyPhoto(activity, "baby-a", { allowedOrigins: [photoOrigin], fetch: fetcher });
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe(contentType);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    const [target, init] = fetcher.mock.calls[0]!;
    expect(String(target)).toBe(activity.poopPhotoUrl);
    expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toBeUndefined();
  });

  it.each([
    "http://photos.example.test/photo.png",
    "https://photos.example.test.evil.example/photo.png",
    "https://photos.example.test:444/photo.png",
    "https://user:secret@photos.example.test/photo.png",
    "https://127.0.0.1/photo.png",
    "file:///tmp/private-photo.png",
    "data:image/png;base64,AAAA",
  ])("rejects untrusted media address %s before fetching", async (url) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(readLegacyPhoto({ ...activity, poopPhotoUrl: url }, "baby-a", { allowedOrigins: [photoOrigin], fetch: fetcher })).rejects.toMatchObject({ status: 503, code: "MEDIA_ORIGIN_NOT_CONFIGURED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires explicit origin configuration and refuses missing or malformed URLs", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(readLegacyPhoto(activity, "baby-a", { allowedOrigins: [], fetch: fetcher })).rejects.toMatchObject({ code: "MEDIA_ORIGIN_NOT_CONFIGURED" });
    await expect(readLegacyPhoto({ ...activity, poopPhotoUrl: "not a URL" }, "baby-a", { allowedOrigins: [photoOrigin], fetch: fetcher })).rejects.toMatchObject({ status: 502, code: "MEDIA_UNAVAILABLE" });
    await expect(readLegacyPhoto({ ...activity, poopPhotoUrl: null }, "baby-a", { allowedOrigins: [photoOrigin], fetch: fetcher })).rejects.toMatchObject({ status: 404, code: "MEDIA_NOT_FOUND" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["image/svg+xml", "text/html", "application/octet-stream", ""])("rejects unsupported content type %s and cancels the upstream stream", async (contentType) => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); }, cancel: cancelled });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: contentType ? { "Content-Type": contentType } : {} }));
    await expect(readLegacyPhoto(activity, "baby-a", { allowedOrigins: [photoOrigin], fetch: fetcher })).rejects.toMatchObject({ status: 415, code: "MEDIA_TYPE_UNSUPPORTED" });
    expect(cancelled).toHaveBeenCalled();
  });

  it("counts streamed bytes instead of trusting a small Content-Length and stops over the limit", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4)); controller.enqueue(new Uint8Array(4)); }, cancel: cancelled });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { "Content-Type": "image/png", "Content-Length": "1" } }));
    await expect(readLegacyPhoto(activity, "baby-a", { allowedOrigins: [photoOrigin], fetch: fetcher, maxBytes: 7 })).rejects.toMatchObject({ status: 413, code: "MEDIA_TOO_LARGE" });
    expect(cancelled).toHaveBeenCalled();
  });

  it("accepts exactly the configured maximum byte count", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, { headers: { "Content-Type": "image/png" } }));
    const response = await readLegacyPhoto(activity, "baby-a", { allowedOrigins: [photoOrigin], fetch: fetcher, maxBytes: bytes.length });
    expect((await response.arrayBuffer()).byteLength).toBe(bytes.length);
  });

  it.each([301, 302, 307, 404, 500])("does not serve HTTP %s or follow its Location", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, { status, headers: { "Content-Type": "image/png", Location: "https://evil.example/secret" } }));
    await expect(readLegacyPhoto(activity, "baby-a", { allowedOrigins: [photoOrigin], fetch: fetcher })).rejects.toMatchObject({ status: 502, code: "MEDIA_UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]?.redirect).toBe("error");
  });

  it("checks the resource baby before fetching and redacts transport failure details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private-photo.png?token=secret"));
    await expect(readLegacyPhoto(activity, "baby-b", { allowedOrigins: [photoOrigin], fetch: fetcher })).rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(readLegacyPhoto(activity, "baby-a", { allowedOrigins: [photoOrigin], fetch: fetcher })).rejects.toMatchObject({ status: 502, message: "照片暂时不可用。" });
  });
});

describe("media HTTP authorization and errors", () => {
  let fixture: IdentityFixture;
  beforeAll(async () => { fixture = await identityFixture(); }, 30_000);
  afterAll(async () => { await fixture?.close(); });

  it("uses service authorization, rejects cross-baby access and returns structured media errors", async () => {
    const login = await fixture.service.loginLegacy("old-alice", "correct-password", "native");
    const read = vi.spyOn(fixture.service.legacy, "read").mockResolvedValue(activity);
    const fetcher = vi.fn<typeof fetch>();
    const handler = createHandler(fixture.service, "https://bubu.example.test", { allowedOrigins: [], fetch: fetcher });
    const request = (babyId: string) => new Request(`https://bubu.example.test/api/app/media/activities/activity-1?babyId=${babyId}`, { headers: { Authorization: `Bearer ${login.token}` } });
    const forbidden = await handler(request("baby-b"));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: "BABY_FORBIDDEN" });
    expect(read).not.toHaveBeenCalled();
    const unavailable = await handler(request("baby-a"));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: "MEDIA_ORIGIN_NOT_CONFIGURED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("uses an already-authorized private attachment reader without ever fetching its URI", async () => {
  const fetcher = vi.fn(), id = "att_" + "a".repeat(64), readPrivate = vi.fn(async () => new Response(bytes));
  const item = { ...activity, poopPhotoUrl: `bubu-attachment:${id}` };
  expect(new Uint8Array(await (await readLegacyPhoto(item, "baby-a", { allowedOrigins: [], fetch: fetcher, readPrivate })).arrayBuffer())).toEqual(bytes);
  expect(readPrivate).toHaveBeenCalledWith(id); expect(fetcher).not.toHaveBeenCalled();
  await expect(readLegacyPhoto(item, "baby-a", { allowedOrigins: [], fetch: fetcher })).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
  await expect(readLegacyPhoto(item, "baby-b", { allowedOrigins: [], readPrivate })).rejects.toMatchObject({ status: 403 });
});
