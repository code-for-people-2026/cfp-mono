import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("next config", () => {
  it("keeps the development indicator from covering booth controls", () => {
    expect(nextConfig.devIndicators).toBe(false);
  });
});
