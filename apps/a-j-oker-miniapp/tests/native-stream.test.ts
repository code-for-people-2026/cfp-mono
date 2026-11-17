import { afterEach, describe, expect, it, vi } from "vitest";

const taro = vi.hoisted(() => ({
  request: vi.fn(),
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
}));

vi.mock("@tarojs/taro", () => ({ default: taro }));

type ChunkCallback = (result: { data: ArrayBuffer }) => void;

function createRequestTask() {
  const chunkCallbacks: ChunkCallback[] = [];
  const offCalls: ChunkCallback[] = [];
  let abortCount = 0;
  let settle!: (result: unknown) => void;
  const promise = new Promise<unknown>((resolve, reject) => {
    settle = (result) =>
      result instanceof Error ? reject(result) : resolve(result);
  });
  const task = Object.assign(promise, {
    onChunkReceived(callback: ChunkCallback) {
      chunkCallbacks.push(callback);
    },
    offChunkReceived(callback: ChunkCallback) {
      offCalls.push(callback);
    },
    abort() {
      abortCount++;
    },
  });
  return {
    task,
    chunkCallbacks,
    offCalls,
    get abortCount() {
      return abortCount;
    },
    complete(result: unknown) {
      settle(result);
    },
    fail(error: Error) {
      settle(error);
    },
    emit(chunk: ArrayBuffer) {
      for (const callback of [...chunkCallbacks]) callback({ data: chunk });
    },
  };
}

function sse(...events: unknown[]) {
  return events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}

function bytes(text: string) {
  return new TextEncoder().encode(text).buffer;
}

function wire(runId: string, withStage = false) {
  return sse(
    { type: "RUN_STARTED", runId },
    ...(withStage
      ? [
          {
            type: "STEP_STARTED",
            stepName: "中文阶段",
            metadata: { stageId: "thinking" },
          },
        ]
      : []),
    { type: "RUN_FINISHED", runId },
  );
}

async function importNativeApi() {
  vi.stubEnv("TARO_ENV", "weapp");
  vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
  taro.getStorageSync.mockReturnValue("native-token");
  const api = await import("../src/chat/api");
  await api.establishIdentity();
  return api;
}

afterEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("微信原生 SSE 传输", () => {
  it("STEP_STARTED 在请求成功前即时到达，并保留原生请求约定", async () => {
    const api = await importNativeApi();
    const task = createRequestTask();
    taro.request.mockReturnValue(task.task);
    const runId = crypto.randomUUID();
    const onProgress = vi.fn();
    const pending = api.resumeImage(17, runId, undefined, onProgress);
    await Promise.resolve();

    task.emit(
      bytes(
        sse(
          { type: "RUN_STARTED", runId },
          {
            type: "STEP_STARTED",
            stepName: "中文阶段",
            metadata: { stageId: "thinking" },
          },
          { type: "RUN_FINISHED", runId },
        ),
      ),
    );
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith({
      text: "",
      messages: [],
      step: "中文阶段",
      stageId: "thinking",
    });
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    task.complete({ statusCode: 200, data: "" });
    await expect(pending).resolves.toBeUndefined();
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(taro.request).toHaveBeenCalledTimes(1);
    const options = taro.request.mock.calls[0][0];
    expect(options).toMatchObject({
      url: "https://example.test/api/hello/image-resume",
      method: "POST",
      dataType: "text",
      timeout: 240_000,
      enableChunked: true,
      data: { turnId: 17, requestId: runId },
      header: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "x-aj-presentation-catalog": "urn:cfp:hello-agent:catalog:2",
        Authorization: "Bearer native-token",
      },
    });
  });

  it("跨 chunk 的中文 UTF-8 字节和 SSE 边界按原语义解码", async () => {
    const api = await importNativeApi();
    const task = createRequestTask();
    taro.request.mockReturnValue(task.task);
    const runId = crypto.randomUUID();
    const onProgress = vi.fn();
    const pending = api.resumeImage(17, runId, undefined, onProgress);
    await Promise.resolve();
    const encoded = new TextEncoder().encode(
      sse(
        { type: "RUN_STARTED", runId },
        {
          type: "TEXT_MESSAGE_START",
          messageId: "message-1",
        },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "message-1", delta: "中" },
        { type: "TEXT_MESSAGE_END", messageId: "message-1" },
        { type: "RUN_FINISHED", runId },
      ),
    );
    for (let index = 0; index < encoded.length; index += 5) {
      task.emit(encoded.slice(index, index + 5).buffer);
    }
    task.complete({ statusCode: 200, data: "" });
    await expect(pending).resolves.toBeUndefined();
    expect(onProgress).toHaveBeenLastCalledWith({
      text: "中",
      messages: [],
      step: "阿 J 先生正在想一想…",
    });
  });

  it("已处理的 chunk 响应体不会在成功回调后重复处理", async () => {
    const api = await importNativeApi();
    const task = createRequestTask();
    taro.request.mockReturnValue(task.task);
    const runId = crypto.randomUUID();
    const onProgress = vi.fn();
    const pending = api.resumeImage(17, runId, undefined, onProgress);
    await Promise.resolve();
    const body = wire(runId, true);
    task.emit(bytes(body));
    task.complete({ statusCode: 200, data: body });
    await expect(pending).resolves.toBeUndefined();
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("无 chunk 能力或没有 chunk 时回退为一次缓冲成功响应", async () => {
    const api = await importNativeApi();
    const runId = crypto.randomUUID();
    const onProgress = vi.fn();
    taro.request.mockResolvedValue({
      statusCode: 200,
      data: wire(runId, true),
    });
    await expect(
      api.resumeImage(17, runId, undefined, onProgress),
    ).resolves.toBeUndefined();
    expect(taro.request).toHaveBeenCalledTimes(1);
    expect(taro.request.mock.calls[0][0].enableChunked).toBe(true);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      statusCode: 401,
      data: { error: "凭证无效" },
      expected:
        "设备凭证无效或已过期。旧聊天记录不会删除，但新身份无法访问旧记录。请确认后重新开始。",
      expectedCode: undefined,
    },
    {
      statusCode: 503,
      data: {
        error: "服务暂时不可用",
        code: "SERVICE_PROBLEM",
        retryable: true,
        definitive: true,
      },
      expected: "服务暂时不可用",
      expectedCode: "SERVICE_PROBLEM",
    },
  ])("HTTP %s 错误响应保留安全错误和机器码", async ({
    statusCode,
    data,
    expected,
    expectedCode,
  }) => {
    const api = await importNativeApi();
    taro.request.mockResolvedValue({ statusCode, data });
    const failure = await api.resumeImage(17, crypto.randomUUID()).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty("message", expected);
    expect((failure as { code?: unknown }).code).toBe(expectedCode);
    if (statusCode === 503) {
      expect(failure).toMatchObject({
        retryable: true,
        definitive: true,
      });
    }
  });

  it("错误 payload 以 chunk 到达时不被误当成 SSE，仍按 HTTP 错误处理", async () => {
    const api = await importNativeApi();
    const task = createRequestTask();
    taro.request.mockReturnValue(task.task);
    const pending = api.resumeImage(17, crypto.randomUUID());
    await Promise.resolve();
    task.emit(bytes(JSON.stringify({ error: "服务暂时不可用" })));
    task.complete({
      statusCode: 503,
      data: { error: "服务暂时不可用" },
    });
    await expect(pending).rejects.toThrow("服务暂时不可用");
  });

  it("截断的 UTF-8 序列在完成阶段拒绝", async () => {
    const api = await importNativeApi();
    const task = createRequestTask();
    taro.request.mockReturnValue(task.task);
    const pending = api.resumeImage(17, crypto.randomUUID());
    await Promise.resolve();
    task.emit(new Uint8Array([0xe4, 0xb8]).buffer);
    task.complete({ statusCode: 200, data: "" });
    await expect(pending).rejects.toThrow("回复传输中断");
  });

  it("SSE RUN_ERROR 保留服务错误机器码", async () => {
    const api = await importNativeApi();
    const task = createRequestTask();
    taro.request.mockReturnValue(task.task);
    const runId = crypto.randomUUID();
    const pending = api.resumeImage(17, runId);
    await Promise.resolve();
    task.emit(bytes(sse(
      { type: "RUN_STARTED", runId },
      {
        type: "RUN_ERROR",
        message: "服务暂时不可用，本次尚未开始生成。",
        code: "SERVICE_PROBLEM",
        metadata: { retryable: true, definitive: true },
      },
    )));
    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toHaveProperty(
      "message",
      "服务暂时不可用，本次尚未开始生成。",
    );
    expect(failure).toMatchObject({
      code: "SERVICE_PROBLEM",
      retryable: true,
      definitive: true,
    });
  });

  it("超过传输字节上限时立即拒绝并中止请求", async () => {
    const api = await importNativeApi();
    const task = createRequestTask();
    taro.request.mockReturnValue(task.task);
    const pending = api.resumeImage(17, crypto.randomUUID());
    await Promise.resolve();
    task.emit(new ArrayBuffer(256_001));
    await expect(pending).rejects.toThrow("回复数据过大");
    expect(task.abortCount).toBe(1);
  });

  it("截断的 SSE 在 reader 完成阶段拒绝", async () => {
    const api = await importNativeApi();
    const task = createRequestTask();
    taro.request.mockReturnValue(task.task);
    const runId = crypto.randomUUID();
    const pending = api.resumeImage(17, runId);
    await Promise.resolve();
    task.emit(
      bytes(sse({ type: "RUN_STARTED", runId })),
    );
    task.complete({ statusCode: 200, data: "" });
    await expect(pending).rejects.toThrow("回复传输中断");
  });

  it("解析失败后移除监听、中止请求并忽略迟到 chunk", async () => {
    const api = await importNativeApi();
    const task = createRequestTask();
    taro.request.mockReturnValue(task.task);
    const runId = crypto.randomUUID();
    const onProgress = vi.fn();
    const pending = api.resumeImage(17, runId, undefined, onProgress);
    await Promise.resolve();
    task.emit(bytes(sse({ type: "RUN_STARTED", runId: "other" })));
    await expect(pending).rejects.toThrow("回复与本轮请求不匹配");
    expect(task.abortCount).toBe(1);
    expect(task.offCalls).toEqual(task.chunkCallbacks);
    const calls = onProgress.mock.calls.length;
    task.emit(bytes(wire(runId, true)));
    await Promise.resolve();
    expect(onProgress).toHaveBeenCalledTimes(calls);
    task.fail(new Error("late request failure"));
    await Promise.resolve();
  });
});
