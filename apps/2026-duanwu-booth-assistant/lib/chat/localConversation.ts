import type { ChatMessage, EntryMode } from "@/lib/chat/conversation";

export const CONVERSATION_STORAGE_KEY = "2026-duanwu-booth-assistant:conversation:v1";
export const CONVERSATION_STORAGE_TTL_MS = 72 * 60 * 60 * 1000;
export const MAX_STORED_MESSAGES = 12;
export const MAX_STORED_MESSAGE_ID_LENGTH = 80;
export const MAX_STORED_MESSAGE_CONTENT_LENGTH = 2_000;
export const MAX_STORED_SUMMARY_LENGTH = 800;

const validModes = new Set<EntryMode>(["intro", "doubt", "continue", "free"]);

export type LocalConversation = {
  mode: EntryMode;
  messages: ChatMessage[];
  conversationSummary: string;
};

type StoredConversation = LocalConversation & {
  version: 1;
  lastActiveAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length <= MAX_STORED_MESSAGE_ID_LENGTH &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    value.content.length > 0 &&
    value.content.length <= MAX_STORED_MESSAGE_CONTENT_LENGTH
  );
}

export function getBrowserStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseStoredConversation(raw: string | null, now = Date.now()): LocalConversation | null {
  if (!raw) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.mode !== "string" ||
    !validModes.has(value.mode as EntryMode) ||
    typeof value.conversationSummary !== "string" ||
    value.conversationSummary.length > MAX_STORED_SUMMARY_LENGTH ||
    typeof value.lastActiveAt !== "number" ||
    !Number.isFinite(value.lastActiveAt) ||
    value.lastActiveAt > now ||
    now - value.lastActiveAt > CONVERSATION_STORAGE_TTL_MS ||
    !Array.isArray(value.messages) ||
    value.messages.length === 0 ||
    !value.messages.every(isChatMessage)
  ) {
    return null;
  }

  return {
    mode: value.mode as EntryMode,
    messages: value.messages.slice(-MAX_STORED_MESSAGES),
    conversationSummary: value.conversationSummary,
  };
}

export function createStoredConversation(conversation: LocalConversation, now = Date.now()) {
  const stored: StoredConversation = {
    version: 1,
    mode: conversation.mode,
    messages: conversation.messages.slice(-MAX_STORED_MESSAGES),
    conversationSummary: conversation.conversationSummary.slice(0, MAX_STORED_SUMMARY_LENGTH),
    lastActiveAt: now,
  };

  return JSON.stringify(stored);
}

export function loadStoredConversation(storage: Storage, now = Date.now()) {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CONVERSATION_STORAGE_KEY);
  } catch {
    return null;
  }

  const conversation = parseStoredConversation(raw, now);
  if (!conversation && raw) {
    clearStoredConversation(storage);
  }

  return conversation;
}

export function saveStoredConversation(storage: Storage, conversation: LocalConversation) {
  try {
    storage.setItem(CONVERSATION_STORAGE_KEY, createStoredConversation(conversation));
  } catch {
    // Storage can be unavailable in private browsing or constrained webviews.
  }
}

export function clearStoredConversation(storage: Storage) {
  try {
    storage.removeItem(CONVERSATION_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private browsing or constrained webviews.
  }
}
