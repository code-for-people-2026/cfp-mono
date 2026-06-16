import { describe, expect, it } from "vitest";
import {
  CONVERSATION_STORAGE_TTL_MS,
  createStoredConversation,
  parseStoredConversation,
} from "@/lib/chat/localConversation";

describe("parseStoredConversation", () => {
  it("rejects records that are too old or from the future", () => {
    const now = Date.now();
    const conversation = {
      version: 1,
      mode: "intro",
      conversationSummary: "",
      messages: [{ id: "user-1", role: "user", content: "问题" }],
    };

    expect(parseStoredConversation(JSON.stringify({ ...conversation, lastActiveAt: now - CONVERSATION_STORAGE_TTL_MS - 1 }), now)).toBeNull();
    expect(parseStoredConversation(JSON.stringify({ ...conversation, lastActiveAt: now + 1 }), now)).toBeNull();
  });

  it("rejects records that do not match the API message limits", () => {
    const now = Date.now();
    const base = {
      version: 1,
      mode: "intro",
      conversationSummary: "",
      lastActiveAt: now,
    };

    expect(
      parseStoredConversation(
        JSON.stringify({
          ...base,
          messages: [{ id: "", role: "user", content: "问题" }],
        }),
        now,
      ),
    ).toBeNull();
    expect(
      parseStoredConversation(
        JSON.stringify({
          ...base,
          messages: [{ id: "x".repeat(81), role: "user", content: "问题" }],
        }),
        now,
      ),
    ).toBeNull();
    expect(
      parseStoredConversation(
        JSON.stringify({
          ...base,
          messages: [{ id: "user-1", role: "user", content: "x".repeat(2001) }],
        }),
        now,
      ),
    ).toBeNull();
    expect(
      parseStoredConversation(
        JSON.stringify({
          ...base,
          conversationSummary: "x".repeat(801),
          messages: [{ id: "user-1", role: "user", content: "问题" }],
        }),
        now,
      ),
    ).toBeNull();
  });
});

describe("createStoredConversation", () => {
  it("keeps only the latest twelve messages in local storage", () => {
    const raw = createStoredConversation(
      {
        mode: "doubt",
        conversationSummary: "摘要",
        messages: Array.from({ length: 14 }, (_, index) => ({
          id: `message-${index}`,
          role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
          content: `message ${index}`,
        })),
      },
      100,
    );

    const parsed = parseStoredConversation(raw, 100);

    expect(parsed?.messages).toHaveLength(12);
    expect(parsed?.messages[0].content).toBe("message 2");
    expect(parsed?.messages.at(-1)?.content).toBe("message 13");
  });
});
