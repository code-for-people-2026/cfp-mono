import { describe, expect, it } from "vitest";
import { createRecipesUrl, defaultApiBaseUrl, resolveApiBaseUrl } from "./api";

describe("resolveApiBaseUrl", () => {
  it("falls back to the default when value is missing", () => {
    expect(resolveApiBaseUrl()).toBe(defaultApiBaseUrl);
  });

  it("falls back to the default when value is blank", () => {
    expect(resolveApiBaseUrl("   ")).toBe(defaultApiBaseUrl);
  });

  it("trims surrounding whitespace and strips trailing slashes", () => {
    expect(resolveApiBaseUrl("  https://api.example.com//  ")).toBe(
      "https://api.example.com"
    );
  });
});

describe("createRecipesUrl", () => {
  const query = "?where[active][equals]=true&limit=0";

  it("builds the recipes endpoint from the default base url", () => {
    expect(createRecipesUrl()).toBe(`${defaultApiBaseUrl}/api/recipes${query}`);
  });

  it("builds the recipes endpoint from a custom base url", () => {
    expect(createRecipesUrl("https://api.example.com/")).toBe(
      `https://api.example.com/api/recipes${query}`
    );
  });

  it("requests the full active pool (no default pagination, no disabled dishes)", () => {
    const url = createRecipesUrl();
    expect(url).toContain("where[active][equals]=true");
    expect(url).toContain("limit=0");
  });
});
