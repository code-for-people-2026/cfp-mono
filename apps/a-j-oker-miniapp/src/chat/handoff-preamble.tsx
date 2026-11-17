import { MessageText } from "./message-text";
import type { Turn } from "./model";
import type { RunProgress } from "@cfp/base-chat-protocol";

export function handoffPreambleId(turnId: number) {
  return `handoff_preamble_${turnId}`;
}

/**
 * A committed turn is authoritative. The transient event can disappear only
 * after its stable ID is present in refreshed history. Text is deliberately
 * not a key: two different turns may use the same valid introduction.
 */
export function interimHandoffPreamble(
  history: readonly Turn[],
  progress: RunProgress | undefined,
) {
  const message = progress?.interimMessage;
  if (!message?.text) return undefined;
  const persisted = history.some((row) =>
    row.handoffPreamble && message.id === handoffPreambleId(row.id)
  );
  return persisted ? undefined : message;
}

export function HandoffPreamble({ text }: { text: string }) {
  return <MessageText className="handoff-preamble" aiGenerated>{text}</MessageText>;
}
