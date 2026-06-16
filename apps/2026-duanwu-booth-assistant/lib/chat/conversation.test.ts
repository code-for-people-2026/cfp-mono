import { describe, expect, it } from "vitest";
import { compactMessagesForRequest, messagesForSummary, recentMessagesAfterSummary, shouldSummarize } from "./conversation";

describe("compactMessagesForRequest", () => {
  it("keeps the latest four turns and drops older messages", () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      id: String(index),
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${index}`,
    }));

    expect(compactMessagesForRequest(messages).map((item) => item.content)).toEqual([
      "message 4",
      "message 5",
      "message 6",
      "message 7",
      "message 8",
      "message 9",
      "message 10",
      "message 11",
    ]);
  });
});

describe("shouldSummarize", () => {
  it("starts summary generation after ten messages", () => {
    expect(
      shouldSummarize(Array.from({ length: 9 }, (_, index) => ({ id: String(index), role: "user" as const, content: "x" }))),
    ).toBe(false);
    expect(
      shouldSummarize(Array.from({ length: 10 }, (_, index) => ({ id: String(index), role: "user" as const, content: "x" }))),
    ).toBe(true);
  });
});

describe("summary slicing helpers", () => {
  it("returns earlier messages for summary and keeps recent messages for chat", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${index}`,
    }));

    expect(messagesForSummary(messages).map((item) => item.content)).toEqual([
      "message 0",
      "message 1",
      "message 2",
      "message 3",
      "message 4",
      "message 5",
    ]);
    expect(recentMessagesAfterSummary(messages).map((item) => item.content)).toEqual([
      "message 4",
      "message 5",
      "message 6",
      "message 7",
      "message 8",
      "message 9",
    ]);
  });
});
