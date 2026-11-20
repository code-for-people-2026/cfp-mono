import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Payload } from "payload";
import type { Owner } from "../domain/contracts";
import { noticeText, TWO_HOURS } from "./policy";

const seams = vi.hoisted(() => {
  const ageProfile = vi.fn();
  const requireCapability = vi.fn();
  const privacyRequire = vi.fn();
  const withAgeLock = vi.fn();
  const alertStatus = vi.fn();
  return { ageProfile, requireCapability, privacyRequire, withAgeLock, alertStatus };
});

vi.mock("../age/service", () => ({
  ageProfile: seams.ageProfile,
  AgeService: class {
    requireCapability = seams.requireCapability;
  },
}));
vi.mock("../age/lock", () => ({ withAgeLock: seams.withAgeLock }));
vi.mock("../privacy/service", () => ({
  privacyService: () => ({ require: seams.privacyRequire }),
}));
vi.mock("../operations/alerts", () => ({
  feishuAlertStatus: seams.alertStatus,
}));

const { InteractionService } = await import("./service");

type NoticeKind = "duration" | "dependency" | "crisis";
type InteractionState = {
  activeMs: number;
  lastSeen: number;
  reminded: number;
  notice: {
    id: string;
    kind: NoticeKind;
    text: string;
  } | null;
  noticeSource?: "timer" | "semantic";
};

describe("InteractionService heartbeat", () => {
  const now = Date.parse("2026-11-19T06:00:00.000Z");
  const owner: Owner = { id: "owner-1", auth: "miniapp" };
  const breakMs = 15 * 60 * 1000;
  let persisted: { id: number; interaction: InteractionState };
  let payload: Payload;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now);
    persisted = {
      id: 701,
      interaction: {
        activeMs: 0,
        lastSeen: 0,
        reminded: 0,
        notice: null,
      },
    };
    const update = vi.fn(async ({ data }: { data: { interaction: InteractionState } }) => {
      persisted.interaction = data.interaction;
      return persisted;
    });
    payload = { update, secret: "test-secret" } as unknown as Payload;
    seams.ageProfile.mockResolvedValue(persisted);
    seams.requireCapability.mockResolvedValue(undefined);
    seams.privacyRequire.mockResolvedValue(undefined);
    seams.alertStatus.mockResolvedValue({ ready: false });
    seams.withAgeLock.mockImplementation(
      async (
        _payload: Payload,
        _key: string,
        task: (assertLease: () => Promise<void>) => Promise<unknown>,
      ) => task(async () => undefined),
    );
  });

  it("expires a timer duration notice at the exact 15-minute usage-cycle boundary", async () => {
    persisted.interaction = {
      activeMs: TWO_HOURS,
      lastSeen: now - breakMs,
      reminded: 1,
      notice: {
        id: "44d0f2a3-6f74-4d0e-943f-9025fcb40b53",
        kind: "duration",
        text: noticeText.duration,
      },
      noticeSource: "timer",
    };

    const status = await new InteractionService(payload, owner).heartbeat();

    expect(status.activeMs).toBe(0);
    expect(status.notice).toBeNull();
    expect(persisted.interaction).toMatchObject({
      activeMs: 0,
      lastSeen: now,
      reminded: 0,
      notice: null,
    });
    expect(persisted.interaction.noticeSource).toBeUndefined();
  });

  it("keeps an existing duration notice through a short reconnect", async () => {
    persisted.interaction = {
      activeMs: TWO_HOURS,
      lastSeen: now - breakMs + 1_000,
      reminded: 1,
      notice: {
        id: "44d0f2a3-6f74-4d0e-943f-9025fcb40b53",
        kind: "duration",
        text: noticeText.duration,
      },
      noticeSource: "timer",
    };

    const status = await new InteractionService(payload, owner).heartbeat();

    expect(status.activeMs).toBe(TWO_HOURS);
    expect(status.notice).toMatchObject({ kind: "duration", text: noticeText.duration });
    expect(persisted.interaction).toMatchObject({
      activeMs: TWO_HOURS,
      lastSeen: now,
      reminded: 1,
      noticeSource: "timer",
    });
  });

  it("creates a new duration notice at the unchanged two-hour threshold", async () => {
    persisted.interaction = {
      activeMs: TWO_HOURS - 90_000,
      lastSeen: now - 90_000,
      reminded: 0,
      notice: null,
    };

    const status = await new InteractionService(payload, owner).heartbeat();

    expect(status.activeMs).toBe(TWO_HOURS);
    expect(status.notice).toMatchObject({ kind: "duration", text: noticeText.duration });
    expect(persisted.interaction).toMatchObject({
      activeMs: TWO_HOURS,
      noticeSource: "timer",
    });
  });

  it("expires an overnight stale timer notice while resetting activity", async () => {
    persisted.interaction = {
      activeMs: TWO_HOURS,
      lastSeen: Date.parse("2026-11-18T22:00:00.000Z"),
      reminded: 0,
      notice: {
        id: "44d0f2a3-6f74-4d0e-943f-9025fcb40b53",
        kind: "duration",
        text: noticeText.duration,
      },
      noticeSource: "timer",
    };

    const status = await new InteractionService(payload, owner).heartbeat();

    expect(status.activeMs).toBe(0);
    expect(status.notice).toBeNull();
    expect(persisted.interaction).toMatchObject({
      activeMs: 0,
      lastSeen: now,
      reminded: 0,
      notice: null,
    });
  });

  it.each(["dependency", "crisis"] as const)(
    "preserves an active %s notice when a break starts a new usage cycle",
    async (kind) => {
      persisted.interaction = {
        activeMs: TWO_HOURS,
        lastSeen: now - breakMs,
        reminded: 0,
        notice: {
          id: "b6ac3347-52b1-4820-b04b-83dd614bd028",
          kind,
          text: `${kind} guidance`,
        },
        noticeSource: "semantic",
      };

      const status = await new InteractionService(payload, owner).heartbeat();

      expect(status.activeMs).toBe(0);
      expect(status.notice).toMatchObject({ kind, text: `${kind} guidance` });
      expect(persisted.interaction).toMatchObject({
        activeMs: 0,
        notice: { kind },
        noticeSource: "semantic",
      });
    },
  );

  it("retains fresh semantic overuse guidance across the next usage-cycle break", async () => {
    const service = new InteractionService(payload, owner);
    await service.heartbeat();

    const semanticVerdict = {
      minor: false,
      crisis: false,
      dependency: false,
      overuse: true,
      exit: false,
      forget_context: false,
      image_requested: false,
      single_choice_only: false,
    };
    await service.inspectInput("通宵继续聊", 17, "request-1", semanticVerdict);
    expect(persisted.interaction).toMatchObject({
      notice: { kind: "duration", text: noticeText.semanticOveruse },
      noticeSource: "semantic",
    });

    vi.spyOn(Date, "now").mockReturnValue(now + breakMs);
    const status = await service.heartbeat();

    expect(status.activeMs).toBe(0);
    expect(status.notice).toEqual({
      id: expect.any(String),
      kind: "duration",
      text: noticeText.semanticOveruse,
    });
    expect(persisted.interaction).toMatchObject({
      activeMs: 0,
      noticeSource: "semantic",
    });
  });
});
