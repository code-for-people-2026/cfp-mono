import { describe, expect, it } from "vitest";
import {
  imageGenerationBlocksRetry,
  projectRetryLineage,
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

  it("keeps a delivered fallback when a retry failed before completion", () => {
    const lineage = projectRetryLineage([
      { id: 1, status: "failed" },
      { id: 2, status: "running", retryOfTurnId: 1 },
    ]);

    expect([...lineage.superseded]).toEqual([1]);
    expect([...lineage.repeatedFallbacks]).toEqual([]);
  });

  it("marks a completed failed handoff retry as a repeated fallback", () => {
    const lineage = projectRetryLineage([
      { id: 1, status: "completed" },
      {
        id: 2,
        status: "completed",
        retryOfTurnId: 1,
        specialist: { handoff: { status: "failed" } },
      },
    ]);

    expect([...lineage.superseded]).toEqual([]);
    expect([...lineage.repeatedFallbacks]).toEqual([2]);
  });

  it("propagates successful delivery through a retry chain", () => {
    const lineage = projectRetryLineage([
      { id: 1, status: "completed" },
      { id: 2, status: "failed", retryOfTurnId: 1 },
      { id: 3, status: "running", retryOfTurnId: 2 },
      { id: 4, status: "completed", retryOfTurnId: 3 },
    ]);

    expect([...lineage.superseded]).toEqual([1, 2, 3]);
    expect([...lineage.repeatedFallbacks]).toEqual([]);
  });

  it("propagates fallback ancestry through failed and running retries", () => {
    const lineage = projectRetryLineage([
      { id: 1, status: "completed" },
      { id: 2, status: "failed", retryOfTurnId: 1 },
      { id: 3, status: "running", retryOfTurnId: 2 },
      {
        id: 4,
        status: "completed",
        retryOfTurnId: 3,
        specialist: { handoff: { status: "failed" } },
      },
    ]);

    expect([...lineage.superseded]).toEqual([2, 3]);
    expect([...lineage.repeatedFallbacks]).toEqual([4]);
  });

  it("keeps a first completed fallback with no earlier delivered ancestor", () => {
    const lineage = projectRetryLineage([
      { id: 1, status: "failed" },
      {
        id: 2,
        status: "completed",
        retryOfTurnId: 1,
        specialist: { handoff: { status: "failed" } },
      },
      { id: 3, status: "failed", retryOfTurnId: 2 },
      { id: 4, status: "running", retryOfTurnId: 3 },
    ]);

    expect([...lineage.superseded]).toEqual([1, 3]);
    expect([...lineage.repeatedFallbacks]).toEqual([]);
  });

  it("rejects invalid lineage rows without adding specialist validation", () => {
    expect(() =>
      projectRetryLineage([{ id: 0, status: "failed" }]),
    ).toThrow(/positive integers/);
    expect(() =>
      projectRetryLineage([{ id: 1, status: "queued" as never }]),
    ).toThrow(/status is invalid/);
    expect(() =>
      projectRetryLineage([
        { id: 1, status: "failed", retryOfTurnId: 0 },
      ]),
    ).toThrow(/positive integers/);
    expect(() =>
      projectRetryLineage([
        {
          id: 1,
          status: "completed",
          specialist: { handoff: { status: 2 as unknown as string } },
        },
      ]),
    ).not.toThrow();
  });

  it("tolerates out-of-order replay and skips unsafe retry links", () => {
    const ordered = projectRetryLineage([
      { id: 1, status: "completed" },
      { id: 2, status: "failed", retryOfTurnId: 1 },
      { id: 3, status: "running", retryOfTurnId: 2 },
      {
        id: 4,
        status: "completed",
        retryOfTurnId: 3,
        specialist: { handoff: { status: "failed" } },
      },
    ]);
    const replayed = projectRetryLineage([
      {
        id: 4,
        status: "completed",
        retryOfTurnId: 3,
        specialist: { handoff: { status: "failed" } },
      },
      { id: 3, status: "running", retryOfTurnId: 2 },
      { id: 2, status: "failed", retryOfTurnId: 1 },
      { id: 1, status: "completed" },
      { id: 5, status: "running", retryOfTurnId: 9 },
      { id: 6, status: "failed", retryOfTurnId: 6 },
    ]);

    expect([...replayed.superseded]).toEqual([...ordered.superseded]);
    expect([...replayed.repeatedFallbacks]).toEqual([
      ...ordered.repeatedFallbacks,
    ]);
  });
});
