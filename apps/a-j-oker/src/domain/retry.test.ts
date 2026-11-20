import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../cms/repository";
import type { AJoker as AJokerRecord } from "../payload-types";
import { imageGenerationBlocksRetry } from "@cfp/a-j-oker-contracts";
import { AJokerService, retryRequestId } from "./a-j-oker";

const owner = "retry-owner";
const input = { text: "请保留原问题", mediaIds: [7] };

function row(
  id: number,
  overrides: Partial<AJokerRecord> = {},
): AJokerRecord {
  return {
    id,
    owner,
    sessionId: 3,
    requestKey: `${owner}:request-${id}`,
    fingerprint: `fingerprint-${id}`,
    input,
    mode: "platform",
    status: "failed",
    association: "真实回应依据与来源",
    error: "本轮失败",
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

function serviceFor(rows: AJokerRecord[]) {
  const repo = {
    owner: { id: owner },
    payload: {},
    get: vi.fn(async (collection: string, id: number) => {
      if (collection === "sessions") return { id };
      return rows.find((candidate) => candidate.id === id);
    }),
    all: vi.fn(async () => rows),
  } as unknown as Repository;
  return new AJokerService(repo);
}

function imageState(
  status: NonNullable<AJokerRecord["imageGeneration"]>["status"],
): NonNullable<AJokerRecord["imageGeneration"]> {
  return {
    input: {
      prompt: "一张温暖的手绘风格日常插画",
      title: "日常插画",
      alt: "温暖的手绘风格日常插画",
      aspectRatio: "square",
    },
    model: "wan2.6-t2i",
    status,
    startedAt: "2026-11-19T00:00:00.000Z",
    ...(status === "pending" ? { taskId: "image-task" } : {}),
    ...(status === "stored" ? { mediaId: 8 } : {}),
  };
}

describe("failed turn retry lineage", () => {
  it("preserves response evidence and uses one deterministic generation after response loss", async () => {
    const original = row(9);
    const completed = row(10, {
      requestKey: `${owner}:${retryRequestId(owner, 9)}`,
      status: "completed",
      aJoker: "重试后的回答",
      association: "真实回应依据与来源",
      specialist: {
        taskId: "task-private",
        expertId: "cbt",
        name: "认知行为教练",
        method: "认知行为方法",
        configurationRevision: "r1",
        theme: "blue",
        layout: "reflection",
        allowedComponents: [],
        preferredComponents: [],
        status: "completed",
        sources: [],
        prompt: "private specialist prompt",
        currentTask: "private current task",
      },
    });
    const service = serviceFor([original, completed]);
    let generations = 0;
    const generatedByRequest = new Map<string, typeof completed>();
    vi.spyOn(service, "generateAJoker").mockImplementation(async (request: unknown) => {
      const requestId = (request as { requestId: string }).requestId;
      const existing = generatedByRequest.get(requestId);
      if (existing) return existing as unknown as AJokerRecord;
      generations++;
      generatedByRequest.set(requestId, completed);
      return completed as unknown as AJokerRecord;
    });

    const first = await service.retryFailed(9);
    const afterResponseLoss = await service.retryFailed(9);

    expect(generations).toBe(1);
    expect(first).toMatchObject({
      id: 10,
      retryOfTurnId: 9,
      association: "真实回应依据与来源",
      input,
    });
    expect(afterResponseLoss).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/private specialist prompt|private current task/);
    expect(first).not.toHaveProperty("requestKey");
    expect(first).not.toHaveProperty("owner");
    expect(first).not.toHaveProperty("fingerprint");
  });

  it("projects a failed retry as the only next actionable lineage after refresh", async () => {
    const original = row(9);
    const failedRetry = row(10, {
      requestKey: `${owner}:${retryRequestId(owner, 9)}`,
      association: "失败前仍保留的真实依据",
    });
    const service = serviceFor([original, failedRetry]);
    const history = await service.history(3);

    expect(history).toEqual([
      expect.not.objectContaining({ retryOfTurnId: expect.anything() }),
      expect.objectContaining({
        id: 10,
        retryOfTurnId: 9,
        association: "失败前仍保留的真实依据",
      }),
    ]);
    expect(retryRequestId(owner, 10)).not.toBe(retryRequestId(owner, 9));
  });

  it("does not replay a completed form submission after exhausted handoff", async () => {
    const completedForm = row(11, {
      status: "completed",
      input: {
        text: "已提交答案",
        mediaIds: [],
        formResponse: { turnId: 4, artifactId: "form", values: { answer: "done" } },
      },
      specialist: {
        taskId: "task-11",
        expertId: "cbt",
        name: "认知行为教练",
        method: "认知行为方法",
        configurationRevision: "r1",
        theme: "blue",
        layout: "reflection",
        allowedComponents: [],
        preferredComponents: [],
        status: "unavailable",
        sources: [],
        prompt: "private specialist prompt",
        currentTask: "private current task",
        handoff: {
          schemaVersion: 1,
          status: "failed",
          attempts: 3,
          finalDisposition: "retry_exhausted",
          diagnostics: [],
        },
      },
    });
    const service = serviceFor([completedForm]);
    const generate = vi.spyOn(service, "generateAJoker");
    await expect(service.retryFailed(11)).rejects.toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
  });

  it("recognizes image states that generic retry must not resubmit", () => {
    expect(imageGenerationBlocksRetry(imageState("submitting"))).toBe(true);
    expect(imageGenerationBlocksRetry(imageState("pending"))).toBe(true);
    expect(imageGenerationBlocksRetry(imageState("stored"))).toBe(true);
  });

  it.each(["submitting", "pending", "stored"] as const)(
    "does not call generation when retrying a turn with a %s image",
    async (status) => {
      const original = row(12, { imageGeneration: imageState(status) });
      const service = serviceFor([original]);
      const generate = vi.spyOn(service, "generateAJoker");

      await expect(service.retryFailed(12)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("继续取图"),
      });
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "failed", "blocked"] as const)(
    "still retries a nonimage or terminal-image failure with state %s",
    async (status) => {
      const original = row(13, {
        ...(status === undefined
          ? {}
          : { imageGeneration: { ...imageState("failed"), status } }),
      });
      const replacement = row(14, {
        status: "completed",
        aJoker: "终态图片后的新回应",
      });
      const service = serviceFor([original, replacement]);
      const generate = vi
        .spyOn(service, "generateAJoker")
        .mockResolvedValue(replacement);

      await expect(service.retryFailed(13)).resolves.toMatchObject({
        id: 14,
        retryOfTurnId: 13,
      });
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: retryRequestId(owner, 13) }),
      );
    },
  );

  it("keeps image recovery on the persisted image request rather than generic retry", async () => {
    const original = row(15, {
      requestKey: `${owner}:image-request`,
      imageGeneration: {
        ...imageState("pending"),
        startedAt: new Date().toISOString(),
      },
    });
    const service = serviceFor([original]);
    const generate = vi
      .spyOn(service, "generateAJoker")
      .mockResolvedValue(original);

    await service.resumeImage(15);

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "image-request" }),
      undefined,
      15,
    );
  });
});
