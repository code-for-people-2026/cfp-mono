import { afterEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, unknown>();
const taro = vi.hoisted(() => ({
  setStorageSync: vi.fn((key: string, value: unknown) => {
    storage.set(key, value);
  }),
  getStorageSync: vi.fn((key: string) => storage.get(key)),
  removeStorageSync: vi.fn((key: string) => {
    storage.delete(key);
  }),
}));

vi.mock("@tarojs/taro", () => ({ default: taro }));

vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
const {
  clearSubmissionFailure,
  readSubmissionFailure,
  rememberSubmissionFailure,
} = await import("../src/chat/submission-failures");

afterEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
});

describe("submission failure recall", () => {
  it("persists only the safe public envelope for a coded error", () => {
    class CodedFailure extends Error {
      constructor(
        message: string,
        readonly code?: string,
        readonly retryable?: boolean,
        readonly definitive?: boolean,
      ) {
        super(message);
      }
    }
    const error = new CodedFailure(
      "服务暂时不可用。".repeat(40),
      "SERVICE_PROBLEM",
      true,
      true,
    );
    rememberSubmissionFailure(17, "request-1", error);
    expect(readSubmissionFailure(17)).toMatchObject({
      requestId: "request-1",
      message: "服务暂时不可用。".repeat(40).slice(0, 300),
      code: "SERVICE_PROBLEM",
      retryable: true,
      definitive: true,
    });
    clearSubmissionFailure(17);
    expect(readSubmissionFailure(17)).toBeUndefined();
  });

  it("does not persist an uncoded transport exception or unsafe machine code", () => {
    const key = "hello-submission-failure:https://example.test:17";
    rememberSubmissionFailure(17, "request-1", new Error("raw URL and key"));
    expect(storage.has(key)).toBe(false);
    rememberSubmissionFailure(17, "request-1", Object.assign(new Error("bad"), {
      code: "not a safe code",
    }));
    expect(storage.has(key)).toBe(false);
    rememberSubmissionFailure(17, "request-1", {
      message: "plain object",
      code: "SERVICE_PROBLEM",
    });
    expect(storage.has(key)).toBe(false);
  });
});
