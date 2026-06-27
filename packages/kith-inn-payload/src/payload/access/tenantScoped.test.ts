import { describe, expect, it } from "vitest";
import { isAuthorizedOperator, tenantScoped } from "./tenantScoped";

const owner = { seller: 7, active: true, role: "owner" as const };
const inactive = { seller: 7, active: false, role: "owner" as const };
const sellerWhere = { seller: { equals: 7 } };

describe("tenantScoped", () => {
  const access = tenantScoped();

  it.each(["read", "update", "delete"] as const)(
    "scopes %s to the operator's seller (Where) and denies otherwise",
    (op) => {
      const fn = access[op];
      // Active operator: scoped to own seller (NOT a blanket `true` — otherwise
      // update/delete would touch any doc across tenants).
      expect(fn({ req: { user: owner } })).toEqual(sellerWhere);
      // No usable tenant → deny.
      expect(fn({ req: { user: undefined } })).toBe(false);
      expect(fn({ req: { user: inactive } })).toBe(false);
      expect(fn({ req: {} })).toBe(false);
    },
  );

  it("allows create for an active operator and denies otherwise", () => {
    expect(access.create({ req: { user: owner } })).toBe(true);
    expect(access.create({ req: { user: undefined } })).toBe(false);
    expect(access.create({ req: { user: inactive } })).toBe(false);
  });
});

describe("isAuthorizedOperator", () => {
  it("narrows to an active operator with a seller", () => {
    expect(isAuthorizedOperator(owner)).toBe(true);
    expect(isAuthorizedOperator(inactive)).toBe(false);
    expect(isAuthorizedOperator(null)).toBe(false);
  });

  it("exposes the seller id after narrowing", () => {
    // Compile-time + runtime proof that narrowing yields a usable seller.
    const user = owner as unknown;
    if (isAuthorizedOperator(user)) {
      expect(user.seller).toBe(7);
    } else {
      throw new Error("should have narrowed");
    }
  });
});
