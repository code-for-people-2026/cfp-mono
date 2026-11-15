import { describe, expect, it } from "vitest";
import { ImageDecision } from "./image-decision";
describe("image request decision", () => {
  it("defaults closed and allows an explicit normal request", () => {
    const gate = new ImageDecision(); expect(gate.allowed).toBe(false);
    gate.record({ decision: "allow", reason: "normal request" }); expect(gate.allowed).toBe(true);
  });
  it("blocks uncertainty without allowing a later rewrite", () => {
    const gate = new ImageDecision();
    gate.record({ decision: "uncertain", reason: "ambiguous intent" });
    gate.record({ decision: "allow", reason: "guessed safe alternative" });
    expect(gate.allowed).toBe(false); expect(gate.refused).toBe(true);
  });
  it("cannot reopen a refusal for a rewritten alternative", () => {
    const gate = new ImageDecision(); gate.record({ decision: "refuse", reason: "harmful original" });
    gate.record({ decision: "allow", reason: "rewritten alternative" });
    expect(gate.allowed).toBe(false); expect(gate.refused).toBe(true);
  });
});
