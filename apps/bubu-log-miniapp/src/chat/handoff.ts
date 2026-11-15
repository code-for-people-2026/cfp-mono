import type { ChatSelection } from "./Chat";

export interface ChatSelectionScope {
  identityId: string;
  babyId: string;
}

interface StagedChatSelection {
  selection: ChatSelection;
  scope: ChatSelectionScope;
}

// The URL carries only an opaque event hint. Authorization comes from the
// freshly validated identity/baby context, and a private record label never
// leaves the in-memory, identity-scoped handoff.
let stagedSelection: StagedChatSelection | undefined;

export function stageChatSelection(selection: ChatSelection, scope: ChatSelectionScope): object {
  stagedSelection = { selection, scope };
  return stagedSelection;
}

export function takeChatSelection(scope: ChatSelectionScope, eventId?: string): ChatSelection | undefined {
  const staged = stagedSelection;
  stagedSelection = undefined;
  if (!eventId || !staged) return undefined;
  if (
    staged.scope.identityId !== scope.identityId ||
    staged.scope.babyId !== scope.babyId ||
    staged.selection.eventId !== eventId
  ) return undefined;
  return staged.selection;
}

export function clearChatSelection(staged?: object): void {
  if (!staged || stagedSelection === staged) stagedSelection = undefined;
}

export function clearAllChatSelections(): void {
  stagedSelection = undefined;
}
