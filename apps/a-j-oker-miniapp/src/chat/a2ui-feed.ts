import { useEffect, useRef, type ReactNode } from "react";
import type {
  A2uiMessage as CoreMessage,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";
import type { A2uiMessage } from "@cfp/base-chat-protocol";

export type HostProps = {
  messages: A2uiMessage[];
  renderSurface: (surface: SurfaceModel, content: ReactNode) => ReactNode;
};
// Current CopilotKit/web_core labels the compatible 0.9 family "v0.9".
// Keep the application's published v0.9.1 wire and saved history unchanged.
export function coreMessages(messages: A2uiMessage[]): CoreMessage[] {
  return messages.map((message) => ({ ...message, version: "v0.9" }));
}
export function surfaceIds(messages: A2uiMessage[]) {
  const ids = new Set<string>();
  for (const message of messages) {
    if ("createSurface" in message) ids.add(message.createSurface.surfaceId);
    if ("deleteSurface" in message) ids.delete(message.deleteSurface.surfaceId);
  }
  return [...ids];
}
export function useMessageFeed(
  messages: A2uiMessage[],
  process: (messages: CoreMessage[]) => void,
  clear: () => void,
) {
  const previous = useRef<string[]>([]);
  useEffect(() => {
    const next = messages.map((message) => JSON.stringify(message));
    // Same saved history may be refetched with fresh object identities. Never
    // recreate its surfaces or erase an in-progress form in that case.
    if (!previous.current.every((value, index) => next[index] === value)) {
      clear();
      previous.current = [];
    }
    if (next.length > previous.current.length)
      process(coreMessages(messages.slice(previous.current.length)));
    previous.current = next;
  }, [messages, process, clear]);
  useEffect(
    () => () => {
      clear();
      previous.current = [];
    },
    [clear],
  );
}
