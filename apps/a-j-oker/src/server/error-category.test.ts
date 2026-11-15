import { describe, it, expect, vi } from "vitest";
import { errorCategory } from "./error-category";
import { failure } from "./http";

describe("public failure diagnostics", () => {
  it("classifies nested driver errors without disclosing SQL or personal data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const error = new Error("query with private-chat and secret-key", { cause: Object.assign(new Error("private SQL params"), { code: "SQLITE_BUSY" }) });
      const response = failure(error);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "服务暂时不可用，请稍后重试" });
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "hello.request_failed", category: "sqlite_busy" }));
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|secret|params/);
    } finally { log.mockRestore(); }
  });
  it("handles cycles and arbitrary failures without returning exception text", () => {
    const cycle = new Error("secret-key"); cycle.cause = cycle;
    expect(errorCategory(cycle)).toBe("unclassified");
    expect(errorCategory({ message: "SQLITE_BUSY: private" })).toBe("unclassified");
    expect(errorCategory(new Error("Error: cannot begin transaction: SQLITE_BUSY: database is locked"))).toBe("sqlite_busy");
  });
});
