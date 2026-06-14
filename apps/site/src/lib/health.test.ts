import { describe, expect, it } from "vitest";
import { createHealthPayload } from "./health";

describe("createHealthPayload", () => {
  it("returns a stable health payload", () => {
    expect(createHealthPayload("site")).toEqual({
      ok: true,
      service: "site",
      timestamp: "1970-01-01T00:00:00.000Z"
    });
  });
});

