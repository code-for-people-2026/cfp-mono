import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readLegacyPhoto, protectLegacyPhotos, protectRecordPhotos } from "../src/media";
import { createHandler } from "../src/http";
import { identityFixture, type IdentityFixture } from "./fixtures/identity";

const photoOrigin = "https://photos.example.test";
const activity = { id: "activity-1", babyId: "baby-a", type: "DIAPER", poopPhotoUrl: `${photoOrigin}/private-photo.png` };
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const legacyPhotoUrl = `${photoOrigin}/record-private.png`;
const protectedPhotoUrl = (id: string, babyId = "baby-a") => `/api/app/media/activities/${encodeURIComponent(id)}?babyId=${encodeURIComponent(babyId)}`;
const photoEvent = (id: string, legacyId: string) => ({
  id, legacyId, babyId: "baby-a", version: 2, facts: { type: "DIAPER" as const, startTime: "2026-10-22T08:00:00+08:00", poopPhotoUrl: legacyPhotoUrl },
  states: { startTime: "known" as const, poopPhotoUrl: "known" as const },
  progress: "ended" as const, evidence: [{ field: "poopPhotoUrl" as const, kind: "image" as const, confirmed: true }],
  missing: [], conflicts: [{ code: "PHOTO_CONFLICT", fields: ["poopPhotoUrl"], message: "请核对照片。" }], complete: false,
  lifecycle: "active" as const, duplicateCandidates: [], sources: [], attachmentIds: [], projection: "synced" as const,
  currentActivity: { id: legacyId, babyId: "baby-a", type: "DIAPER" as const, startTime: "2026-10-22T08:00:00+08:00", poopPhotoUrl: legacyPhotoUrl },
  projected: { id: legacyId, babyId: "baby-a", type: "DIAPER" as const, startTime: "2026-10-22T08:00:00+08:00", poopPhotoUrl: legacyPhotoUrl },
  createdAt: "2026-10-22T08:01:00+08:00", updatedAt: "2026-10-22T08:02:00+08:00",
});
const noPhotoEvent = {
  id: "event-no-photo", legacyId: "legacy-no-photo", babyId: "baby-a", version: 1,
  facts: { type: "DIAPER" as const, startTime: "2026-10-22T09:00:00+08:00", poopPhotoUrl: null },
  states: { startTime: "known" as const, poopPhotoUrl: "not_applicable" as const }, progress: "ended" as const,
  evidence: [], missing: [], conflicts: [], complete: true, lifecycle: "active" as const, duplicateCandidates: [],
  sources: [], attachmentIds: [], projection: "synced" as const, currentActivity: null, projected: null,
  createdAt: "2026-10-22T09:01:00+08:00", updatedAt: "2026-10-22T09:02:00+08:00",
};
const missingPhotoEvent = {
  ...noPhotoEvent, id: "event-missing-photo", legacyId: "legacy-missing-photo",
  facts: { type: "DIAPER" as const, startTime: "2026-10-22T10:00:00+08:00" },
  states: { startTime: "known" as const, poopPhotoUrl: "pending" as const },
  currentActivity: { id: "legacy-missing-photo", babyId: "baby-a", type: "DIAPER" as const, startTime: "2026-10-22T10:00:00+08:00" },
};
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

describe("record photo redaction", () => {
  it("rewrites only snapshot activity and fact photos while preserving field metadata", () => {
    const source = {
      events: [photoEvent("event-photo", "legacy-photo"), noPhotoEvent, missingPhotoEvent],
      activities: [
        { id: "legacy-photo", babyId: "baby-a", type: "DIAPER" as const, startTime: "2026-10-22T08:00:00+08:00", poopPhotoUrl: legacyPhotoUrl },
        { id: "legacy-no-photo", babyId: "baby-a", type: "DIAPER" as const, startTime: "2026-10-22T09:00:00+08:00", poopPhotoUrl: null },
        { id: "legacy-missing-photo", babyId: "baby-a", type: "DIAPER" as const, startTime: "2026-10-22T10:00:00+08:00" },
      ],
      questions: [{ id: "question:event-photo", babyId: "baby-a", eventId: "event-photo", fields: ["poopPhotoUrl"], duplicateCandidates: [], state: "open" as const }],
    };
    const unchanged = structuredClone(source);
    const result = protectRecordPhotos(source, "baby-a") as typeof source;
    const withPhoto = result.events[0] as ReturnType<typeof photoEvent>;
    const withoutPhoto = result.events[1] as typeof noPhotoEvent;
    const missingPhoto = result.events[2] as typeof missingPhotoEvent;
    const activities = result.activities as Array<{ poopPhotoUrl?: string | null }>;

    expect(source).toEqual(unchanged);
    expect(withPhoto.facts.poopPhotoUrl).toBe(protectedPhotoUrl("legacy-photo"));
    expect(withPhoto.states.poopPhotoUrl).toBe("known");
    expect(withPhoto.evidence[0]!.field).toBe("poopPhotoUrl");
    expect(withPhoto.conflicts[0]!.fields).toEqual(["poopPhotoUrl"]);
    expect(withPhoto.currentActivity!.poopPhotoUrl).toBe(protectedPhotoUrl("legacy-photo"));
    expect(withPhoto.projected!.poopPhotoUrl).toBe(protectedPhotoUrl("legacy-photo"));
    expect(withoutPhoto.facts.poopPhotoUrl).toBeNull();
    expect(withoutPhoto.states.poopPhotoUrl).toBe("not_applicable");
    expect(missingPhoto.facts).not.toHaveProperty("poopPhotoUrl");
    expect(missingPhoto.states.poopPhotoUrl).toBe("pending");
    expect(missingPhoto.currentActivity).not.toHaveProperty("poopPhotoUrl");
    expect(activities.map(row => row.poopPhotoUrl)).toEqual([protectedPhotoUrl("legacy-photo"), null, undefined]);
    expect(result.questions[0]!.fields).toEqual(["poopPhotoUrl"]);
    expect(JSON.stringify(result)).not.toContain(photoOrigin);
  });

  it("uses each revision event's owning legacy id in receipts and before/after copies", () => {
    const before = photoEvent("event-photo", "legacy-photo");
    const after = photoEvent("event-photo", "legacy-photo");
    const receipt = { requestId: "request-photo", status: "saved" as const, events: [before, noPhotoEvent], questions: [], retryable: false };
    const revisions = [{ id: "revision:event-photo:2", eventId: "event-photo", babyId: "baby-a", version: 2, before, after, at: "2026-10-22T08:03:00+08:00" }];
    const source = { receipt, revisions };
    const unchanged = structuredClone(source);
    const result = protectRecordPhotos(source, "baby-a") as typeof source;

    expect(source).toEqual(unchanged);
    for (const event of [result.receipt.events[0]!, result.revisions[0]!.before!, result.revisions[0]!.after!]) {
      expect(event.facts.poopPhotoUrl).toBe(protectedPhotoUrl("legacy-photo"));
      expect(event.projected!.poopPhotoUrl).toBe(protectedPhotoUrl("legacy-photo"));
      expect(event.states.poopPhotoUrl).toBe("known");
    }
    expect(result.receipt.events[1]!.facts.poopPhotoUrl).toBeNull();
    expect(result.receipt.events[1]!.states.poopPhotoUrl).toBe("not_applicable");
    expect(JSON.stringify(result)).not.toContain(legacyPhotoUrl);
    expect(JSON.stringify(result)).not.toContain(protectedPhotoUrl("event-photo"));
    expect(JSON.stringify(result)).not.toContain(protectedPhotoUrl("revision:event-photo:2"));
  });

  it("rejects another baby anywhere in a record payload and refuses unsafe photo owners", () => {
    expect(() => protectRecordPhotos({ events: [photoEvent("event-photo", "legacy-photo")], activities: [{ ...activity, babyId: "baby-b" }] }, "baby-a")).toThrow("记录不属于当前宝宝");
    expect(() => protectRecordPhotos({ revisions: [{ id: "revision:event-photo:2", babyId: "baby-b", before: null, after: photoEvent("event-photo", "legacy-photo") }] }, "baby-a")).toThrow("记录不属于当前宝宝");
    expect(() => protectRecordPhotos({ ...photoEvent("event-photo", ""), facts: { ...photoEvent("event-photo", "legacy-photo").facts } }, "baby-a")).toThrow("记录不属于当前宝宝");
    expect(() => protectRecordPhotos({ ...activity, id: "", startTime: "2026-10-22T08:00:00+08:00" }, "baby-a")).toThrow("记录不属于当前宝宝");
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
