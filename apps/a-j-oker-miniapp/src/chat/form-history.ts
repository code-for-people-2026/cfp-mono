import type { FormValues } from "@cfp/base-chat-protocol";
import type { Input, Turn } from "./model";

type FormResponse = NonNullable<Input["formResponse"]>;
type FormHistoryTurn = Pick<Turn, "id" | "status" | "input">;

export function formResponseKey(response: FormResponse) {
  return `turn_${response.turnId}_${response.artifactId}`;
}

export function isFormOnlyInput(input: Input) {
  return (
    !!input.formResponse &&
    input.mediaIds.length === 0 &&
    input.action === undefined
  );
}

export function formSubmissionStates(history: readonly FormHistoryTurn[]) {
  const accepted = new Map<string, FormValues>();
  const drafts = new Map<string, FormValues>();
  for (const turn of [...history].sort((left, right) => left.id - right.id)) {
    const response = turn.input.formResponse;
    if (!response) continue;
    const key = formResponseKey(response);
    if (turn.status === "completed") {
      accepted.set(key, response.values);
      drafts.delete(key);
    } else if (!accepted.has(key)) {
      drafts.set(key, response.values);
    }
  }
  return {
    responses: Object.fromEntries(accepted),
    draftResponses: Object.fromEntries(drafts),
  };
}
