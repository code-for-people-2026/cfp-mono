import { describe, expect, it } from "vitest";
import { createRateLimiter, parsePositiveInteger } from "./rateLimit";

describe("createRateLimiter", () => {
  it("allows requests within limits and rejects later requests", () => {
    const limiter = createRateLimiter({ perMinute: 2, perHour: 3 });

    expect(limiter.check("1.2.3.4", 0).allowed).toBe(true);
    expect(limiter.check("1.2.3.4", 1).allowed).toBe(true);
    expect(limiter.check("1.2.3.4", 2).allowed).toBe(false);
  });

  it("separates clients by IP", () => {
    const limiter = createRateLimiter({ perMinute: 1, perHour: 1 });

    expect(limiter.check("1.2.3.4", 0).allowed).toBe(true);
    expect(limiter.check("5.6.7.8", 0).allowed).toBe(true);
  });

  it("allows requests again after the minute window resets", () => {
    const limiter = createRateLimiter({ perMinute: 1, perHour: 2 });

    expect(limiter.check("1.2.3.4", 0).allowed).toBe(true);
    expect(limiter.check("1.2.3.4", 1).allowed).toBe(false);
    expect(limiter.check("1.2.3.4", 60_001).allowed).toBe(true);
  });
});

describe("parsePositiveInteger", () => {
  it("returns fallback for invalid, zero, or negative values", () => {
    expect(parsePositiveInteger("abc", 10)).toBe(10);
    expect(parsePositiveInteger("0", 10)).toBe(10);
    expect(parsePositiveInteger("-5", 10)).toBe(10);
    expect(parsePositiveInteger(undefined, 10)).toBe(10);
  });

  it("accepts positive integer strings", () => {
    expect(parsePositiveInteger("25", 10)).toBe(25);
  });
});
