import { describe, expect, it } from "vitest";
import { chatRequestSchema, summarizeRequestSchema } from "./validation";

describe("chatRequestSchema", () => {
  it("applies a default empty conversation summary", () => {
    const parsed = chatRequestSchema.parse({
      mode: "free",
      message: "数据平权是什么意思？",
      messages: [],
    });

    expect(parsed.conversationSummary).toBe("");
  });

  it("rejects invalid mode, overlong message, and too many history messages", () => {
    expect(() =>
      chatRequestSchema.parse({
        mode: "invalid",
        message: "hello",
        messages: [],
      }),
    ).toThrow();

    expect(() =>
      chatRequestSchema.parse({
        mode: "free",
        message: "x".repeat(1001),
        messages: [],
      }),
    ).toThrow();

    expect(() =>
      chatRequestSchema.parse({
        mode: "free",
        message: "hello",
        messages: Array.from({ length: 9 }, (_, index) => ({
          id: String(index),
          role: "user",
          content: "hello",
        })),
      }),
    ).toThrow();
  });

  it("rejects empty message content", () => {
    expect(() =>
      chatRequestSchema.parse({
        mode: "free",
        message: "",
        messages: [],
      }),
    ).toThrow();
  });
});

describe("summarizeRequestSchema", () => {
  it("applies a default empty previous summary", () => {
    const parsed = summarizeRequestSchema.parse({
      messages: [{ id: "1", role: "user", content: "hello" }],
    });

    expect(parsed.previousSummary).toBe("");
  });

  it("rejects empty and oversized summary batches", () => {
    expect(() => summarizeRequestSchema.parse({ messages: [] })).toThrow();
    expect(() =>
      summarizeRequestSchema.parse({
        messages: Array.from({ length: 13 }, (_, index) => ({
          id: String(index),
          role: "user",
          content: "hello",
        })),
      }),
    ).toThrow();
  });
});
