import type { CollectionBeforeChangeHook, Field } from "payload";
import { tenantScoped } from "../access/tenantScoped";
import { assertSameTenantRefs } from "../hooks/assertSameTenantRefs";
import { stampSeller } from "../hooks/stampSeller";

/**
 * Shared tenant-scoped collection building blocks (Tech Spec §3.1). Every
 * business collection carries the `seller` field + the same access/hooks, so the
 * common parts live here to keep the per-collection files focused on their domain
 * fields. The traversal assertion (PR2) verifies the behavior is uniform.
 */

/** The tenant-key relationship every business collection carries (PRD §7). */
export const sellerField: Field = {
  name: "seller",
  type: "relationship",
  relationTo: "sellers",
  required: true,
  index: true,
};

/** Shared tenant-scoped access: read/update/delete → seller `Where`; create → auth. */
export const tenantAccess = tenantScoped();

/** Write-side defense in depth: stamp own seller, then guard cross-tenant refs. */
export const tenantHooks = {
  beforeChange: [
    stampSeller as CollectionBeforeChangeHook,
    assertSameTenantRefs as CollectionBeforeChangeHook,
  ],
};
