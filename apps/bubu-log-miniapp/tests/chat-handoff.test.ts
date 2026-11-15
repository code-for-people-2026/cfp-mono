import { beforeEach, describe, expect, it } from "vitest";
import { clearAllChatSelections, clearChatSelection, stageChatSelection, takeChatSelection } from "../src/chat/handoff";

const identity = { identityId: "identity-a", babyId: "baby-a" };
const other = { identityId: "identity-b", babyId: "baby-a" };
const otherBaby = { identityId: "identity-a", babyId: "baby-b" };
const selection = { eventId: "event-a", label: "private label", nonce: 1 };

beforeEach(() => {
  clearAllChatSelections();
});

describe("chat handoff", () => {
  it("returns a matching selection only once for the exact identity and baby", () => {
    stageChatSelection(selection, identity);
    expect(takeChatSelection(other, "event-a")).toBeUndefined();
    stageChatSelection(selection, identity);
    expect(takeChatSelection(otherBaby, "event-a")).toBeUndefined();
    stageChatSelection(selection, identity);
    expect(takeChatSelection(identity, "event-b")).toBeUndefined();
    stageChatSelection(selection, identity);
    expect(takeChatSelection(identity, "event-a")).toEqual(selection);
    expect(takeChatSelection(identity, "event-a")).toBeUndefined();
  });

  it("clears a generic entry so an earlier detail selection cannot arrive later", () => {
    stageChatSelection(selection, identity);
    expect(takeChatSelection(identity)).toBeUndefined();
    expect(takeChatSelection(identity, "event-a")).toBeUndefined();
    stageChatSelection({ ...selection, nonce: 2 }, identity);
    expect(takeChatSelection(identity, "event-a")).toEqual({ ...selection, nonce: 2 });
  });

  it("clears only the exact failed navigation without erasing a newer selection", () => {
    const failed = stageChatSelection(selection, identity);
    const newer = stageChatSelection({ ...selection, nonce: 2 }, other);
    clearChatSelection(failed);
    expect(takeChatSelection(other, "event-a")).toEqual({ ...selection, nonce: 2 });
    expect(newer).toBeTruthy();
  });
});
