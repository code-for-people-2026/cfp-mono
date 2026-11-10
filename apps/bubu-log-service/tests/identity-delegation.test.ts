import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EventInput } from "../src/records/types";
import { recordsFixture, type RecordsFixture } from "./fixtures/records";

const fullAccess = ["records:read", "records:write", "media:read", "media:write", "baby:manage", "caregivers:manage"] as const;
const recordsOnly = ["records:read", "records:write"] as const;
const day = "2026-10-22";
const exercise = (hour: number): EventInput => ({ facts: { type: "ROLL_OVER", startTime: `${day}T${String(hour).padStart(2, "0")}:00:00+08:00`, count: 1 } });

describe("chat-agent authorization follows the parent's live and issued scope", () => {
  let fixture: RecordsFixture;
  let photo: Buffer;

  beforeAll(async () => {
    fixture = await recordsFixture();
    photo = await sharp({ create: { width: 3, height: 3, channels: 3, background: "white" } }).png().toBuffer();
  }, 30_000);
  beforeEach(async () => { await fixture.resetRecords(); });
  afterAll(async () => { await fixture?.close(); });

  it("narrows an existing delegated token when its parent loses media permissions", async () => {
    const parent = await fixture.identity.authenticate(
      (await fixture.identity.loginWechat("fixture:delegation-narrowed:nonce")).token, "bearer",
    );
    await fixture.identity.setGrant(fixture.operator, "baby-a", parent.subjectId, "active", [...fullAccess]);
    const attachment = await fixture.attachments.upload(parent, "baby-a", photo, "image/png", "narrowed-parent-photo");
    const agent = await fixture.identity.authenticate(
      (await fixture.identity.issueAgent(parent, "baby-a", "chat-agent")).token, "bearer",
    );

    await fixture.identity.setGrant(fixture.operator, "baby-a", parent.subjectId, "active", [...recordsOnly]);
    const parentEvent = (await fixture.records.record(parent, { babyId: "baby-a", requestId: "narrowed-parent-record", events: [exercise(8)] })).events[0]!;
    const agentEvent = (await fixture.records.record(agent, { babyId: "baby-a", requestId: "narrowed-agent-record", events: [exercise(9)] })).events[0]!;
    expect(parentEvent.attachmentIds).toEqual([]);
    expect(agentEvent.attachmentIds).toEqual([]);

    await expect(fixture.records.record(parent, { babyId: "baby-a", requestId: "narrowed-parent-new-link", events: [{ ...exercise(10), attachmentIds: [attachment.id] }] }))
      .rejects.toMatchObject({ status: 403, code: "MEDIA_FORBIDDEN" });
    await expect(fixture.records.record(agent, { babyId: "baby-a", requestId: "narrowed-agent-new-link", events: [{ ...exercise(11), attachmentIds: [attachment.id] }] }))
      .rejects.toMatchObject({ status: 403, code: "MEDIA_FORBIDDEN" });
    await expect(fixture.records.attach(parent, { babyId: "baby-a", requestId: "narrowed-parent-existing-link", eventId: parentEvent.id, expectedVersion: parentEvent.version, attachmentIds: [attachment.id] }))
      .rejects.toMatchObject({ status: 403, code: "MEDIA_FORBIDDEN" });
    await expect(fixture.records.attach(agent, { babyId: "baby-a", requestId: "narrowed-agent-existing-link", eventId: agentEvent.id, expectedVersion: agentEvent.version, attachmentIds: [attachment.id] }))
      .rejects.toMatchObject({ status: 403, code: "MEDIA_FORBIDDEN" });
    await expect(fixture.attachments.read(agent, "baby-a", attachment.id))
      .rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });
    await expect(fixture.attachments.upload(agent, "baby-a", photo, "image/png", "narrowed-agent-upload"))
      .rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });

    await fixture.identity.setGrant(fixture.operator, "baby-a", parent.subjectId, "active", ["records:read", "records:write", "media:read", "media:write"]);
    const linked = (await fixture.records.record(agent, { babyId: "baby-a", requestId: "media-restored-agent-link", events: [{ ...exercise(12), attachmentIds: [attachment.id] }] })).events[0]!;
    expect(linked.attachmentIds).toEqual([attachment.id]);
  });

  it("does not enlarge a restricted delegated token when the parent is granted full access later", async () => {
    const parent = await fixture.identity.authenticate(
      (await fixture.identity.loginWechat("fixture:delegation-restricted:nonce")).token, "bearer",
    );
    await fixture.identity.setGrant(fixture.operator, "baby-a", parent.subjectId, "active", [...recordsOnly]);
    const agent = await fixture.identity.authenticate(
      (await fixture.identity.issueAgent(parent, "baby-a", "chat-agent")).token, "bearer",
    );
    await fixture.identity.setGrant(fixture.operator, "baby-a", parent.subjectId, "active", [...fullAccess]);

    const attachment = await fixture.attachments.upload(parent, "baby-a", photo, "image/png", "regranted-parent-photo");
    const parentLinked = (await fixture.records.record(parent, { babyId: "baby-a", requestId: "regranted-parent-link", events: [{ ...exercise(8), attachmentIds: [attachment.id] }] })).events[0]!;
    expect(parentLinked.attachmentIds).toEqual([attachment.id]);

    const event = (await fixture.records.record(agent, { babyId: "baby-a", requestId: "regranted-agent-record", events: [exercise(9)] })).events[0]!;
    expect(event.attachmentIds).toEqual([]);
    await expect(fixture.records.record(agent, { babyId: "baby-a", requestId: "regranted-agent-link", events: [{ ...exercise(10), attachmentIds: [attachment.id] }] }))
      .rejects.toMatchObject({ status: 403, code: "MEDIA_FORBIDDEN" });
    await expect(fixture.records.attach(agent, { babyId: "baby-a", requestId: "regranted-agent-existing-link", eventId: event.id, expectedVersion: event.version, attachmentIds: [attachment.id] }))
      .rejects.toMatchObject({ status: 403, code: "MEDIA_FORBIDDEN" });
    await expect(fixture.attachments.read(agent, "baby-a", attachment.id))
      .rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });
    await expect(fixture.attachments.upload(agent, "baby-a", photo, "image/png", "regranted-agent-upload"))
      .rejects.toMatchObject({ status: 403, code: "BABY_FORBIDDEN" });
  });
});
