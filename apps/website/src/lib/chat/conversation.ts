export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

export type EntryMode = "intro" | "doubt" | "continue" | "free";

export function compactMessagesForRequest(messages: ChatMessage[], maxMessages = 8) {
  return messages.slice(Math.max(0, messages.length - maxMessages));
}

export function shouldSummarize(messages: ChatMessage[], threshold = 10) {
  return messages.length >= threshold;
}

export function messagesForSummary(messages: ChatMessage[], keepRecent = 4) {
  return messages.slice(0, Math.max(0, messages.length - keepRecent));
}

export function recentMessagesAfterSummary(messages: ChatMessage[], keepRecent = 6) {
  return messages.slice(Math.max(0, messages.length - keepRecent));
}
