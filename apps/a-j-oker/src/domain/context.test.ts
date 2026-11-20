import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../cms/repository";
import type { AJoker as AJokerRecord } from "../payload-types";
import { ContextService } from "./context";
import { retryRequestId } from "./retry-lineage";

const owner = "context-owner";

function row(
  id: number,
  status: AJokerRecord["status"],
  overrides: Partial<AJokerRecord> = {},
): AJokerRecord {
  return {
    id,
    owner,
    sessionId: 3,
    requestKey: `${owner}:request-${id}`,
    fingerprint: `fingerprint-${id}`,
    input: { text: `输入 ${id}`, mediaIds: [] },
    mode: "platform",
    status,
    aJoker: status === "completed" ? `回应 ${id}` : null,
    association: "真实回应依据与来源",
    artifacts: [],
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    ...overrides,
  };
}

function serviceFor(rows: AJokerRecord[], memory: Record<string, unknown> = {}) {
  const session = { id: 3, memory };
  const repo = {
    owner: { id: owner },
    payload: {},
    get: vi.fn(async (collection: string) => {
      if (collection === "sessions") return session;
      throw new Error("unexpected collection");
    }),
    all: vi.fn(async () => rows),
    update: vi.fn(),
  } as unknown as Repository;
  return { service: new ContextService(repo), repo };
}

describe("ContextService retry lineage", () => {
  it("keeps a delivered fallback until a completed chained replacement exists", async () => {
    const unrelated = row(1, "completed");
    const fallback = row(2, "completed", { aJoker: "原回应" });
    const failedRetry = row(3, "failed", {
      requestKey: `${owner}:${retryRequestId(owner, 2)}`,
    });
    const pendingRetry = row(4, "running", {
      requestKey: `${owner}:${retryRequestId(owner, 3)}`,
    });
    const replacement = row(5, "completed", {
      requestKey: `${owner}:${retryRequestId(owner, 4)}`,
      aJoker: "替换回应",
    });
    const { service, repo } = serviceFor([
      unrelated,
      fallback,
      failedRetry,
      pendingRetry,
      replacement,
    ]);

    const context = await service.modelContext(3);

    expect(repo.all).toHaveBeenCalledWith("a-j-oker", {
      and: [
        { sessionId: { equals: 3 } },
        { id: { greater_than: 0 } },
      ],
    });
    expect(context).toEqual({
      memory: "",
      previous: [
        { input: { text: "输入 1", mediaIds: [] }, aJoker: "回应 1" },
        { input: { text: "输入 5", mediaIds: [] }, aJoker: "替换回应" },
      ],
    });
  });

  it.each(["running", "failed"] as const)(
    "retains the completed fallback before a %s retry succeeds",
    async (status) => {
      const unrelated = row(1, "completed");
      const fallback = row(2, "completed", { aJoker: "原回应" });
      const retry = row(3, status, {
        requestKey: `${owner}:${retryRequestId(owner, 2)}`,
      });
      const { service } = serviceFor([unrelated, fallback, retry]);

      expect(await service.modelContext(3)).toEqual({
        memory: "",
        previous: [
          { input: { text: "输入 1", mediaIds: [] }, aJoker: "回应 1" },
          { input: { text: "输入 2", mediaIds: [] }, aJoker: "原回应" },
        ],
      });
    },
  );

  it("respects an existing summary cursor without rewriting compacted history", async () => {
    const compactedFallback = row(2, "completed", { aJoker: "旧回应" });
    const failedRetry = row(3, "failed", {
      requestKey: `${owner}:${retryRequestId(owner, 2)}`,
    });
    const replacement = row(4, "completed", {
      requestKey: `${owner}:${retryRequestId(owner, 3)}`,
      aJoker: "新回应",
    });
    const { service, repo } = serviceFor(
      [compactedFallback, failedRetry, replacement],
      { throughId: 2, summary: "已压缩的旧回应" },
    );

    expect(await service.modelContext(3)).toEqual({
      memory: "已压缩的旧回应",
      previous: [
        { input: { text: "输入 4", mediaIds: [] }, aJoker: "新回应" },
      ],
    });
    expect(repo.update).not.toHaveBeenCalled();
  });
});
