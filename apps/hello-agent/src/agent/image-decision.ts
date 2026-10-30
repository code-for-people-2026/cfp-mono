import { z } from "zod";

export const imageDecisionSchema = z.object({ decision: z.enum(["allow", "refuse"]), reason: z.string().trim().min(1).max(500) });
// A refusal is terminal for this turn; a rewritten prompt cannot reopen it.
export class ImageDecision {
  private decision: "pending" | "allow" | "refuse" = "pending";
  record(input: z.infer<typeof imageDecisionSchema>) {
    if (this.decision !== "refuse") this.decision = input.decision;
    return { decision: this.decision };
  }
  get refused() { return this.decision === "refuse"; }
  get allowed() { return this.decision === "allow"; }
}
