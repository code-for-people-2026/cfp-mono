import { describe, expect, it } from "vitest";
import { stampSeller } from "./stampSeller";

const owner = { seller: 7, active: true, role: "owner" as const };
const inactive = { seller: 7, active: false, role: "owner" as const };

describe("stampSeller", () => {
  it("forces seller to the operator's tenant, ignoring the request body", () => {
    const result = stampSeller({
      data: { name: "番茄炒蛋", seller: "attacker-tenant" },
      req: { user: owner },
    });
    expect(result).toEqual({ name: "番茄炒蛋", seller: 7 });
  });

  it("stamps seller even when the body omits it", () => {
    const result = stampSeller({ data: { name: "番茄炒蛋" }, req: { user: owner } });
    expect(result).toEqual({ name: "番茄炒蛋", seller: 7 });
  });

  it("leaves the record untouched when there is no authorized operator", () => {
    expect(stampSeller({ data: { name: "x", seller: 99 }, req: { user: undefined } })).toEqual({
      name: "x",
      seller: 99,
    });
    expect(stampSeller({ data: { name: "x" }, req: { user: inactive } })).toEqual({
      name: "x",
    });
  });

  it("handles a missing/empty data payload", () => {
    expect(stampSeller({ data: undefined, req: { user: owner } })).toEqual({ seller: 7 });
    expect(stampSeller({ data: undefined, req: { user: undefined } })).toEqual({});
  });
});
