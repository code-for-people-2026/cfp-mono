import { describe, expect, it } from "vitest";
import {
  imageGenerationBlocksRetry,
  supersededRetryTurnIds,
} from "./retry-lineage";

describe("retry lineage contracts", () => {
  it("blocks generic retry while a paid image submission or result is retained", () => {
    for (const status of ["submitting", "pending", "stored"] as const)
      expect(imageGenerationBlocksRetry({ status })).toBe(true);
    for (const status of ["failed", "blocked"] as const)
      expect(imageGenerationBlocksRetry({ status })).toBe(false);
    expect(imageGenerationBlocksRetry(null)).toBe(false);
    expect(imageGenerationBlocksRetry(undefined)).toBe(false);
    expect(imageGenerationBlocksRetry({ status: "unknown" })).toBe(false);
  });

  it("supersedes noncompleted parents immediately but completed ancestors only after delivery", () => {
    expect(
      [...supersededRetryTurnIds([
        { id: 1, status: "failed" },
        { id: 2, status: "running", retryOfTurnId: 1 },
      ])],
    ).toEqual([1]);

    expect(
      [...supersededRetryTurnIds([
        { id: 1, status: "completed" },
        { id: 2, status: "failed", retryOfTurnId: 1 },
      ])],
    ).toEqual([]);

    expect(
      [...supersededRetryTurnIds([
        { id: 1, status: "completed" },
        { id: 2, status: "failed", retryOfTurnId: 1 },
        { id: 3, status: "completed", retryOfTurnId: 2 },
      ])],
    ).toEqual([1, 2]);
  });

  it("rejects unknown or nonmonotonic lineage input", () => {
    expect(() =>
      supersededRetryTurnIds([{ id: 0, status: "failed" }]),
    ).toThrow(/positive integers/);
    expect(() =>
      supersededRetryTurnIds([{ id: 1, status: "queued" as never }]),
    ).toThrow(/status is invalid/);
  });

  it("tolerates replay order and skips unsafe retry links", () => {
    expect(
      [
        ...supersededRetryTurnIds([
          { id: 4, status: "completed", retryOfTurnId: 2 },
          { id: 2, status: "failed", retryOfTurnId: 1 },
          { id: 5, status: "running", retryOfTurnId: 9 },
          { id: 1, status: "completed" },
          { id: 3, status: "failed", retryOfTurnId: 3 },
        ]),
      ],
    ).toEqual([1, 2]);
  });
});
