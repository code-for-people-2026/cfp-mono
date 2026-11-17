import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "../cms/repository";
import { AppError, ContentReviewError, ServiceProblemError } from "./contracts";
import { ContextService } from "./context";
import { GreetingService } from "./greetings";
import type { Moderator } from "./moderation";

vi.mock("../operations/enforcement", () => ({
  assertGenerationAllowed: vi.fn(),
  assertMediaAllowed: vi.fn(),
}));

import { assertGenerationAllowed } from "../operations/enforcement";

const owner = "handoff-owner";
const requestId = "11111111-1111-4111-8111-111111111111";
const baseRow = {
  id: 12,
  sessionId: 7,
  requestKey: `${owner}:${requestId}`,
  mode: "byok" as const,
  input: { text: "我最近总是自责", mediaIds: [] },
  status: "running" as const,
};

function fakeRepo(row: Record<string, unknown> & { id: number } = { ...baseRow }) {
  const rows = new Map<number, Record<string, unknown>>([[row.id, row]]);
  const update = vi.fn(async (_collection: string, id: number, patch: unknown) => {
    const current = rows.get(id)!;
    const next = { ...current, ...(patch as Record<string, unknown>) };
    rows.set(id, next);
    return next;
  });
  const repo = {
    owner: { id: owner },
    payload: {},
    acquire: vi.fn(async () => Object.assign(
      async () => undefined,
      {
        run: async <T>(work: () => Promise<T>) => work(),
        signal: new AbortController().signal,
      },
    )),
    all: vi.fn(async () => []),
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ ...row })),
    get: vi.fn(async (_collection: string, id: number) => rows.get(id)),
    update,
  } as unknown as Repository;
  return { repo, update };
}

async function callbackService(options: {
  repo: Repository;
  moderate: Moderator;
  row?: typeof baseRow;
}) {
  const service = new GreetingService(
    options.repo,
    async (request) => {
      await request.saveHandoffPreamble("我先听见了这件事。接下来请这位 AI 专家陪你把它说清楚。");
      throw new AppError(503, "stop after callback");
    },
    undefined,
    undefined,
    { moderate: options.moderate },
  );
  vi.spyOn(
    service as unknown as { begin: (unknown: unknown) => Promise<unknown> },
    "begin",
  ).mockResolvedValue({
    row: options.row ?? baseRow,
    duplicate: false,
    imageRequested: false,
  });
  await service.generateGreeting({
    sessionId: 7,
    requestId,
    mode: "byok",
    apiKey: "review-key",
    input: baseRow.input,
  });
}

describe("expert handoff preamble safety boundary", () => {
  beforeEach(() => {
    vi.mocked(assertGenerationAllowed).mockResolvedValue(undefined);
    vi.spyOn(ContextService.prototype, "forgottenThroughId").mockResolvedValue(0);
  });

  it("checks generation permission and output-moderates before one immutable persistence", async () => {
    const { repo, update } = fakeRepo();
    const moderate = vi.fn(async (request: unknown) => {
      expect(assertGenerationAllowed).toHaveBeenCalled();
      expect(request).toMatchObject({
        stage: "output",
        mode: "byok",
        texts: ["我先听见了这件事。接下来请这位 AI 专家陪你把它说清楚。"],
        context: "我最近总是自责",
        turnId: 12,
        sessionId: 7,
      });
      expect(String((request as { requestId: string }).requestId)).toMatch(
        /^handoff-preamble-output:12:[^:]+$/,
      );
    });
    await expect(callbackService({ repo, moderate })).rejects.toMatchObject({
      status: 503,
      message: "stop after callback",
    });
    expect(moderate).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith("greetings", 12, {
      handoffPreamble: "我先听见了这件事。接下来请这位 AI 专家陪你把它说清楚。",
    });
  });

  it("rejects a conflicting second callback without a second moderation or overwrite", async () => {
    const row = { ...baseRow, handoffPreamble: "已经保存且不可变的阿 J 前导说明。" };
    const { repo, update } = fakeRepo(row);
    const moderate = vi.fn();
    const service = new GreetingService(
      repo,
      async (request) => {
        await expect(request.saveHandoffPreamble(row.handoffPreamble!))
          .resolves.toBe(row.handoffPreamble);
        await expect(request.saveHandoffPreamble("另一段试图覆盖的前导说明。"))
          .rejects.toMatchObject({ status: 409 });
        throw new AppError(503, "stop after callback");
      },
      undefined,
      undefined,
      { moderate },
    );
    vi.spyOn(service as unknown as { begin: (unknown: unknown) => Promise<unknown> }, "begin")
      .mockResolvedValue({ row, duplicate: false, imageRequested: false });
    await expect(service.generateGreeting({
      sessionId: 7,
      requestId,
      mode: "byok",
      apiKey: "review-key",
      input: baseRow.input,
    })).rejects.toMatchObject({ status: 503 });
    expect(assertGenerationAllowed).toHaveBeenCalled();
    expect(moderate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalledWith("greetings", 12, { handoffPreamble: row.handoffPreamble });
  });

  it("checks permission and quarantine before reusing an identical persisted preamble", async () => {
    const row = {
      ...baseRow,
      visibility: "quarantined" as const,
      handoffPreamble: "已经保存且不可变的阿 J 前导说明。",
    };
    const { repo } = fakeRepo(row);
    const moderate = vi.fn();
    await expect(callbackService({ repo, moderate, row: baseRow })).rejects.toMatchObject({
      status: 403,
    });
    expect(assertGenerationAllowed).toHaveBeenCalled();
    expect(moderate).not.toHaveBeenCalled();
  });

  it("does not persist an unsafe preamble when output review rejects it", async () => {
    const { repo, update } = fakeRepo();
    const rejection = new ContentReviewError(422, "这次回应未通过内容审核");
    const moderate = vi.fn().mockRejectedValue(rejection);
    await expect(callbackService({ repo, moderate })).rejects.toBe(rejection);
    expect(update).not.toHaveBeenCalledWith("greetings", 12, {
      handoffPreamble: "我先听见了这件事。接下来请这位 AI 专家陪你把它说清楚。",
    });
  });

  it("preserves an output review service failure as a service problem", async () => {
    const { repo, update } = fakeRepo();
    const failure = new ServiceProblemError(
      503,
      "服务暂时不可用，本次结果尚未确认；请先确认本轮状态，不要直接重复生成。",
      { code: "SERVICE_PROBLEM", retryable: true, definitive: false },
    );
    const moderate = vi.fn().mockRejectedValue(failure);
    await expect(callbackService({ repo, moderate })).rejects.toBe(failure);
    expect(failure).not.toBeInstanceOf(ContentReviewError);
    expect(update).not.toHaveBeenCalledWith("greetings", 12, {
      handoffPreamble: "我先听见了这件事。接下来请这位 AI 专家陪你把它说清楚。",
    });
  });

  it("persists a swallowed output review service failure instead of the generic model error", async () => {
    const row = {
      ...baseRow,
      imageGeneration: {
        input: {
          prompt: "一张温暖的手绘风格日常插画",
          title: "日常插画",
          alt: "温暖的手绘风格日常插画",
          aspectRatio: "square" as const,
        },
        model: "wan2.6-t2i",
        status: "pending" as const,
        startedAt: new Date().toISOString(),
      },
    };
    const { repo, update } = fakeRepo(row);
    const failure = new ServiceProblemError(
      503,
      "服务暂时不可用，本次结果尚未确认；请先确认本轮状态，不要直接重复生成。",
      { code: "SERVICE_PROBLEM", retryable: true, definitive: false },
    );
    const moderate = vi.fn().mockRejectedValue(failure);
    const generate = vi.fn(async (request: {
      saveHandoffPreamble: (value: string) => Promise<string>;
    }) => {
      await request.saveHandoffPreamble(
        "我先听见了这件事。接下来请这位 AI 专家陪你把它说清楚。",
      ).catch(() => undefined);
    });
    const service = new GreetingService(repo, generate, undefined, undefined, {
      moderate,
    });
    vi.spyOn(
      service as unknown as { begin: (unknown: unknown) => Promise<unknown> },
      "begin",
    ).mockResolvedValue({ row, duplicate: false, imageRequested: false });

    await expect(service.generateGreeting({
      sessionId: 7,
      requestId,
      mode: "byok",
      apiKey: "review-key",
      input: baseRow.input,
    })).rejects.toBe(failure);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("greetings", 12, expect.objectContaining({
      status: "failed",
      error: "服务暂时不可用，本次结果尚未确认；请先确认本轮状态，不要直接重复生成。",
    }));
    expect(update.mock.calls[0]?.[2]).not.toHaveProperty("imageGeneration");
  });

  it("rejects an input review service failure before any generator work", async () => {
    const { repo } = fakeRepo();
    const failure = new ServiceProblemError(
      503,
      "服务暂时不可用，本次尚未开始生成；稍后可用原输入重试，同一请求不会重复保存。",
      { code: "SERVICE_PROBLEM", retryable: true, definitive: true },
    );
    const moderate = vi.fn().mockRejectedValue(failure);
    const generate = vi.fn();
    const reviewContext = vi
      .spyOn(ContextService.prototype, "reviewContext")
      .mockResolvedValue({ memory: "", previous: [] });
    const service = new GreetingService(repo, generate, undefined, undefined, {
      moderate,
    });
    vi.mocked(repo.get).mockImplementation(async () =>
      ({ ...baseRow }) as unknown as Awaited<ReturnType<typeof repo.get>>,
    );
    vi.mocked(repo.list).mockResolvedValue([]);

    try {
      await expect(service.generateGreeting({
      sessionId: 7,
      requestId,
      mode: "byok",
      apiKey: "review-key",
      input: baseRow.input,
      })).rejects.toBe(failure);
    } finally {
      reviewContext.mockRestore();
    }
    expect(generate).not.toHaveBeenCalled();
    expect((repo as unknown as { create: ReturnType<typeof vi.fn> }).create)
      .not.toHaveBeenCalled();
  });
});
