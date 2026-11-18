import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../cms/repository";
import type { AJoker as AJokerRecord } from "../payload-types";
import { AJokerService, retryRequestId } from "./a-j-oker";

const owner = "retry-owner";
const input = { text: "请保留原问题", mediaIds: [7] };

function row(id: number, overrides: Record<string, unknown> = {}) {
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

function serviceFor(rows: ReturnType<typeof row>[]) {
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
        handoff: { status: "failed" },
      },
    });
    const service = serviceFor([completedForm]);
    const generate = vi.spyOn(service, "generateAJoker");
    await expect(service.retryFailed(11)).rejects.toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
  });
});
