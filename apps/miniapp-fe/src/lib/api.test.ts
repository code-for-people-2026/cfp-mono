import { describe, expect, it } from "vitest";
import { createMiniappDemoUrl, resolveApiBaseUrl } from "./api";

describe("miniapp API helpers", () => {
  it("uses the default API base URL", () => {
    expect(createMiniappDemoUrl()).toBe(
      "http://localhost:3300/api/miniapp/demo"
    );
  });

  it("trims whitespace and trailing slashes", () => {
    expect(resolveApiBaseUrl(" https://www.codeforpeople.cn/// ")).toBe(
      "https://www.codeforpeople.cn"
    );
  });
});

