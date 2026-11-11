import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectorMcpClient } from "../src/collector/runner";
import type { SourceRef } from "../src/records/types";

afterEach(() => vi.restoreAllMocks());

async function transport(responses: Array<{ status: number; body: unknown }>) {
  const requests: Request[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    const reply = responses[requests.length - 1];
    if (!reply) return new Response(JSON.stringify({ code: "TEST_SEQUENCE_EXHAUSTED" }), { status: 500 });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  });
  return { client: new CollectorMcpClient(new URL("https://collector.example/api/mcp"), async () => "synthetic-token"), requests };
}

const source: SourceRef = {
  kind: "wechat", accountId: "synthetic-account", conversationId: "synthetic-group", messageId: "42",
  eventKey: "media:0", sentAt: "2026-11-11T08:00:00+08:00", senderId: "synthetic-sender", groupId: "account:synthetic-group",
};
const original = new Uint8Array([1, 2, 3]);
const optimized = new Uint8Array([4, 5, 6]);
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const attachmentId = (character: string) => `att_${character.repeat(64)}`;

describe("collector upload receipt recovery", () => {
  it("returns an existing receipt before sending bytes", async () => {
    const id = attachmentId("a");
    const fixture = await transport([{ status: 200, body: { data: { state: "verified", attachment: { id } } } }]);
    await expect(fixture.client.uploadImage("baby-a", original, "image/jpeg", "stable-request", source)).resolves.toEqual({ id });
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({ method: "POST", url: "https://collector.example/api/app/attachments/receipt?babyId=baby-a" });
    expect(fixture.requests[0]!.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(await fixture.requests[0]!.text())).toEqual({ requestId: "stable-request", source });
  });

  it("keeps the old upload path when a predecessor has no receipt route", async () => {
    const id = attachmentId("b");
    const fixture = await transport([
      { status: 404, body: { code: "NOT_FOUND", error: "predecessor" } },
      { status: 200, body: { data: { id } } },
    ]);
    await expect(fixture.client.uploadImage("baby-a", original, "image/jpeg", "legacy-request", source)).resolves.toEqual({ id });
    expect(fixture.requests.map(request => `${request.method} ${request.url}`)).toEqual([
      "POST https://collector.example/api/app/attachments/receipt?babyId=baby-a",
      "POST https://collector.example/api/app/attachments?babyId=baby-a",
    ]);
    expect(new Uint8Array(await fixture.requests[1]!.arrayBuffer())).toEqual(original);
  });

  it("performs exactly one receipt lookup after an idempotency race resolves to a verified receipt", async () => {
    const id = attachmentId("c");
    const fixture = await transport([
      { status: 200, body: { data: { state: "absent" } } },
      { status: 409, body: { code: "ATTACHMENT_IDEMPOTENCY_CONFLICT", error: "synthetic race" } },
      { status: 200, body: { data: { state: "verified", attachment: { id } } } },
    ]);
    await expect(fixture.client.uploadImage("baby-a", original, "image/jpeg", "race-request", source)).resolves.toEqual({ id });
    expect(fixture.requests.map(request => request.url)).toEqual([
      "https://collector.example/api/app/attachments/receipt?babyId=baby-a",
      "https://collector.example/api/app/attachments?babyId=baby-a",
      "https://collector.example/api/app/attachments/receipt?babyId=baby-a",
    ]);
  });

  it("reports an explicit conflict when one-shot recovery finds no committed receipt", async () => {
    const fixture = await transport([
      { status: 200, body: { data: { state: "absent" } } },
      { status: 409, body: { code: "ATTACHMENT_IDEMPOTENCY_CONFLICT", error: "still conflicting" } },
      { status: 200, body: { data: { state: "absent" } } },
    ]);
    const error = await fixture.client.uploadImage("baby-a", original, "image/jpeg", "unresolved-request", source).catch(error => error) as Error & { status: number; serverCode: string | undefined };
    expect(error).toMatchObject({ message: "COLLECTOR_UPLOAD_IDEMPOTENCY_CONFLICT", status: 409, serverCode: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });
    expect(error.message).not.toContain("still conflicting");
    expect(fixture.requests).toHaveLength(3);
  });

  it("does not bypass an upload conflict on a predecessor without receipt recovery", async () => {
    const fixture = await transport([
      { status: 404, body: { code: "NOT_FOUND", error: "predecessor" } },
      { status: 409, body: { code: "ATTACHMENT_IDEMPOTENCY_CONFLICT", error: "conflicting bytes" } },
    ]);
    const error = await fixture.client.uploadImage("baby-a", original, "image/jpeg", "legacy-conflict", source).catch(error => error) as Error & { status: number; serverCode: string | undefined };
    expect(error).toMatchObject({ message: "COLLECTOR_UPLOAD_RECOVERY_UNSUPPORTED", status: 409, serverCode: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });
    expect(error.message).not.toContain("conflicting bytes");
    expect(fixture.requests).toHaveLength(2);
  });

  it("selects and posts the exact original bytes advertised by a repair receipt", async () => {
    const id = attachmentId("d");
    const fixture = await transport([
      { status: 200, body: { data: { state: "needsRepair", id, mime: "image/png", sha256: sha256(original) } } },
      { status: 200, body: { data: { id } } },
    ]);
    await expect(fixture.client.uploadImage("baby-a", optimized, "image/jpeg", "repair-request", source, { bytes: original, mime: "image/png" })).resolves.toEqual({ id });
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[1]).toMatchObject({ method: "POST", url: "https://collector.example/api/app/attachments?babyId=baby-a" });
    expect(fixture.requests[1]!.headers.get("content-type")).toBe("image/png");
    expect(fixture.requests[1]!.headers.get("x-bubu-request-id")).toBe("repair-request");
    expect(new Uint8Array(await fixture.requests[1]!.arrayBuffer())).toEqual(original);
  });

  it("fails closed when no in-memory payload exactly matches repair metadata", async () => {
    const fixture = await transport([
      { status: 200, body: { data: { state: "needsRepair", id: attachmentId("e"), mime: "image/png", sha256: sha256(new Uint8Array([9, 9, 9])) } } },
    ]);
    const error = await fixture.client.uploadImage("baby-a", optimized, "image/jpeg", "no-match", source, { bytes: original, mime: "image/png" }).catch(error => error) as Error;
    expect(error).toMatchObject({ message: "COLLECTOR_UPLOAD_REPAIR_REQUIRED" });
    expect(fixture.requests).toHaveLength(1);
  });

  it("bounds race recovery to one repair selection and POST", async () => {
    const id = attachmentId("f");
    const fixture = await transport([
      { status: 200, body: { data: { state: "absent" } } },
      { status: 409, body: { code: "ATTACHMENT_IDEMPOTENCY_CONFLICT", error: "first race" } },
      { status: 200, body: { data: { state: "needsRepair", id, mime: "image/png", sha256: sha256(original) } } },
      { status: 409, body: { code: "ATTACHMENT_IDEMPOTENCY_CONFLICT", error: "second race" } },
    ]);
    const error = await fixture.client.uploadImage("baby-a", optimized, "image/jpeg", "bounded-race", source, { bytes: original, mime: "image/png" }).catch(error => error) as Error & { status: number; serverCode: string | undefined };
    expect(error).toMatchObject({ message: "COLLECTOR_UPLOAD_IDEMPOTENCY_CONFLICT", status: 409, serverCode: "ATTACHMENT_IDEMPOTENCY_CONFLICT" });
    expect(error.message).not.toContain("second race");
    expect(fixture.requests.map(request => request.url)).toEqual([
      "https://collector.example/api/app/attachments/receipt?babyId=baby-a",
      "https://collector.example/api/app/attachments?babyId=baby-a",
      "https://collector.example/api/app/attachments/receipt?babyId=baby-a",
      "https://collector.example/api/app/attachments?babyId=baby-a",
    ]);
  });
});
