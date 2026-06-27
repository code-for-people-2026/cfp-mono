import { describe, expect, it } from "vitest";
import type { CollectionConfig } from "payload";
import { collections } from "./index";

/**
 * §3.1 collection-traversal assertion: every collection carrying a `seller`
 * field MUST route its access through the tenant-scoping factory. This turns
 * "someone forgot to tenant-scope the Nth table" from a runtime cross-tenant
 * leak into a CI failure.
 *
 * Checked BEHAVIORALLY (not by function identity): each collection calls
 * `tenantScoped()` itself, so the closure references differ per collection —
 * but the behavior must be identical (read/update/delete return the seller
 * `Where`; create denies an anonymous caller). `sellers` (the tenant root) has
 * no `seller` field and is exempt.
 */
type AccessArgs = { req: { user?: unknown } };

const hasSellerField = (col: CollectionConfig): boolean =>
  Boolean(col.fields?.some((f) => "name" in f && (f as { name: string }).name === "seller"));

const operator = { seller: 42, active: true, role: "owner" as const };
const sellerWhere = { seller: { equals: 42 } };

describe("§3.1 tenant-isolation traversal", () => {
  const sellerScoped = collections.filter(hasSellerField);
  const exempt = collections.filter((c) => !hasSellerField(c)).map((c) => c.slug);

  it("sellers (tenant root) is exempt — it has no seller field", () => {
    // Sanity: the exemption list is exactly the tenant-root collections, not a
    // forgotten business table.
    expect(exempt).toEqual(["sellers"]);
  });

  it("every seller-bearing collection scopes read/update/delete to the operator's seller", () => {
    const violating: string[] = [];
    for (const col of sellerScoped) {
      const access = (col.access ?? {}) as Record<string, ((a: AccessArgs) => unknown) | undefined>;
      for (const key of ["read", "update", "delete"] as const) {
        const fn = access[key];
        if (!fn) {
          violating.push(`${col.slug}.${key} (missing)`);
          continue;
        }
        const result = fn({ req: { user: operator } });
        // Must return the seller Where — a blanket `true` would leak across tenants.
        if (JSON.stringify(result) !== JSON.stringify(sellerWhere)) {
          violating.push(`${col.slug}.${key} → ${JSON.stringify(result)}`);
        }
      }
    }
    expect(violating, `expected no violations, got: ${violating.join(", ")}`).toEqual([]);
  });

  it("every seller-bearing collection denies create to an anonymous caller (bootstrap disabled)", () => {
    // CI sets ALLOW_ADMIN_BOOTSTRAP=true for seeding; the isolation invariant is
    // about the normal (non-bootstrap) path, so disable the hatch for this check.
    const savedBootstrap = process.env.ALLOW_ADMIN_BOOTSTRAP;
    delete process.env.ALLOW_ADMIN_BOOTSTRAP;
    try {
      const violating: string[] = [];
      for (const col of sellerScoped) {
        const access = (col.access ?? {}) as Record<string, ((a: AccessArgs) => unknown) | undefined>;
        const create = access.create;
        if (!create) {
          violating.push(`${col.slug}.create (missing)`);
          continue;
        }
        const result = create({ req: { user: undefined } });
        if (result !== false) violating.push(`${col.slug}.create → ${String(result)}`);
      }
      expect(violating).toEqual([]);
    } finally {
      if (savedBootstrap !== undefined) process.env.ALLOW_ADMIN_BOOTSTRAP = savedBootstrap;
      else delete process.env.ALLOW_ADMIN_BOOTSTRAP;
    }
  });
});
